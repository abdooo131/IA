import net from 'node:net';
import type { ConfigService } from '@nestjs/config';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Env } from '../src/config/env';
import { SmtpMailer } from '../src/email/mailer';

/**
 * Sends through the real nodemailer SMTP transport to a tiny local SMTP server, so a
 * nodemailer upgrade that changes how we build or send a message fails here.
 */
type Received = { from: string; to: string[]; data: string };

function smtpServer(answerRcpt = '250 OK') {
  const received: Received[] = [];
  const server = net.createServer((socket) => {
    let buffer = '';
    let inData = false;
    let current: Received = { from: '', to: [], data: '' };
    socket.write('220 test.local ESMTP\r\n');
    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      for (;;) {
        if (inData) {
          const end = buffer.indexOf('\r\n.\r\n');
          if (end < 0) return;
          current.data = buffer.slice(0, end);
          buffer = buffer.slice(end + 5);
          inData = false;
          received.push(current);
          current = { from: '', to: [], data: '' };
          socket.write('250 queued\r\n');
          continue;
        }
        const nl = buffer.indexOf('\r\n');
        if (nl < 0) return;
        const line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 2);
        const verb = line.slice(0, 4).toUpperCase();
        if (verb === 'EHLO' || verb === 'HELO') socket.write('250 test.local\r\n');
        else if (verb === 'MAIL') {
          current.from = line;
          socket.write('250 OK\r\n');
        } else if (verb === 'RCPT') {
          current.to.push(line);
          socket.write(`${answerRcpt}\r\n`);
        } else if (verb === 'DATA') {
          inData = true;
          socket.write('354 go ahead\r\n');
        } else if (verb === 'QUIT') {
          socket.end('221 bye\r\n');
        } else socket.write('250 OK\r\n');
      }
    });
  });
  return { server, received };
}

function listen(server: net.Server) {
  return new Promise<number>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve((server.address() as net.AddressInfo).port));
  });
}

function mailerFor(port: number) {
  const values: Partial<Env> = {
    SMTP_HOST: '127.0.0.1',
    SMTP_PORT: port,
    SMTP_FROM: 'Shiply Now <billing@example.test>',
  };
  const config = { get: (key: keyof Env) => values[key] } as unknown as ConfigService<Env, true>;
  return new SmtpMailer(config);
}

describe('SmtpMailer (nodemailer)', () => {
  const ok = smtpServer();
  const refusing = smtpServer('550 no such user');
  let okPort = 0;
  let refusingPort = 0;

  beforeAll(async () => {
    okPort = await listen(ok.server);
    refusingPort = await listen(refusing.server);
  });
  afterAll(() => {
    ok.server.close();
    refusing.server.close();
  });

  it('is off without SMTP_HOST and SMTP_FROM', () => {
    const config = { get: () => undefined } as unknown as ConfigService<Env, true>;
    expect(new SmtpMailer(config).enabled).toBe(false);
  });

  it('sends the message with its attachment to the SMTP server', async () => {
    const mailer = mailerFor(okPort);
    expect(mailer.enabled).toBe(true);
    await mailer.send({
      to: 'merchant@example.test',
      subject: 'Statement مارس',
      html: '<p>Hello</p>',
      text: 'Hello',
      attachments: [
        { filename: 'statement.csv', contentType: 'text/csv', content: Buffer.from('a,b\n1,2\n') },
      ],
    });
    expect(ok.received).toHaveLength(1);
    const mail = ok.received[0]!;
    expect(mail.from).toContain('<billing@example.test>');
    expect(mail.to).toEqual(['RCPT TO:<merchant@example.test>']);
    expect(mail.data).toContain('statement.csv');
    expect(mail.data).toContain('text/csv');
    expect(mail.data).toContain(Buffer.from('a,b\n1,2\n').toString('base64'));
    expect(mail.data).toMatch(/Subject: =\?UTF-8\?/);
  });

  it('reports only the server answer code when the server refuses', async () => {
    const mailer = mailerFor(refusingPort);
    const error = await mailer
      .send({ to: 'nobody@example.test', subject: 'x', html: '<p>x</p>', text: 'x' })
      .then(
        () => null,
        (e: Error) => e,
      );
    expect(error?.message).toBe('email server answered 550');
    expect(error?.message).not.toContain('nobody@example.test');
  });
});
