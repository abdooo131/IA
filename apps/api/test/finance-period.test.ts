import { deflateRawSync } from 'node:zlib';
import type { INestApplication } from '@nestjs/common';
import { addDays, cairoDay } from '@shiplynow/shared';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readSpreadsheet } from '../src/finance/spreadsheet';
import type { PrismaService } from '../src/prisma/prisma.service';
import { zip } from '../src/shopify/widget-kit';
import { createTestApp, resetAndSeed } from './helpers';

const DEMO = 'demo-password-1';
let n = 0;
const key = () => `fper-${++n}-${Date.now()}`;

/** A real .xlsx: shared strings, an inline string, numbers and a skipped column. */
function xlsx(deflate: boolean) {
  const files = [
    {
      path: 'xl/workbook.xml',
      data: '<workbook><sheets><sheet name="Statement" sheetId="1" r:id="rId1"/></sheets></workbook>',
    },
    {
      path: 'xl/_rels/workbook.xml.rels',
      data: '<Relationships><Relationship Id="rId1" Type="x" Target="worksheets/sheet1.xml"/></Relationships>',
    },
    {
      path: 'xl/sharedStrings.xml',
      data: '<sst><si><t>Date</t></si><si><t>Description</t></si><si><r><t>Fees &amp; </t></r><r><t>charges</t></r></si></sst>',
    },
    {
      path: 'xl/worksheets/sheet1.xml',
      data:
        '<worksheet><sheetData>' +
        '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="D1" t="inlineStr"><is><t>Amount</t></is></c></row>' +
        '<row r="2"><c r="A2"><v>46327</v></c><c r="B2" t="s"><v>2</v></c><c r="D2"><v>-15.5</v></c></row>' +
        '</sheetData></worksheet>',
    },
  ];
  if (!deflate) return zip(files.map((f) => ({ path: f.path, data: Buffer.from(f.data) })));
  // Same zip with deflated parts, the way Excel writes them.
  const out: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const f of files) {
    const name = Buffer.from(f.path);
    const body = deflateRawSync(Buffer.from(f.data));
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(8, 8);
    header.writeUInt32LE(body.length, 18);
    header.writeUInt32LE(f.data.length, 22);
    header.writeUInt16LE(name.length, 26);
    out.push(header, name, body);
    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50, 0);
    dir.writeUInt16LE(8, 10);
    dir.writeUInt32LE(body.length, 20);
    dir.writeUInt32LE(f.data.length, 24);
    dir.writeUInt16LE(name.length, 28);
    dir.writeUInt32LE(offset, 42);
    central.push(dir, name);
    offset += 30 + name.length + body.length;
  }
  const size = central.reduce((s, b) => s + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(size, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...out, ...central, end]);
}

describe('statement files', () => {
  it('reads Excel files, stored or compressed, and CSV with quotes', () => {
    for (const deflate of [false, true])
      expect(readSpreadsheet(xlsx(deflate))).toEqual([
        ['Date', 'Description', '', 'Amount'],
        ['46327', 'Fees & charges', '', '-15.5'],
      ]);
    expect(
      readSpreadsheet(
        Buffer.from('﻿Date;Details;Amount\r\n01/11/2026;"Rent; Nov";"-1,000.00"\r\n'),
      ),
    ).toEqual([
      ['Date', 'Details', 'Amount'],
      ['01/11/2026', 'Rent; Nov', '-1,000.00'],
    ]);
    expect(() => readSpreadsheet(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 1, 2]))).toThrow(
      'old_excel_format',
    );
  });
});

describe('bank, reports and exports end to end', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const agent = async (email: string, password = DEMO) => {
    const a = request.agent(app.getHttpServer());
    await a.post('/auth/login').send({ email, password }).expect(200);
    return a;
  };
  const account = (k: string) => prisma.ledgerAccount.findUniqueOrThrow({ where: { key: k } });

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(async () => {
    await resetAndSeed(prisma);
  });

  it('reads a statement, matches it, and exports the books', async () => {
    const admin = await agent('admin@test.eg', 'admin-password-1');
    const finance = await agent('finance@shiplynow.local');
    const cib = await account('bank');
    const capital = await finance
      .post('/finance/capital')
      .send({
        direction: 'in',
        moneyAccountId: cib.id,
        amountPiastres: 500_000,
        reference: 'Owner',
        idempotencyKey: key(),
      })
      .expect(201);
    await admin
      .post(`/finance/requests/${capital.body.requestId}/decide`)
      .send({ approve: true })
      .expect(201);

    const read = await finance
      .post('/finance/bank-statements/read')
      .set('content-type', 'text/csv')
      .send(Buffer.from('Date,Description,Amount\n01/01/2026,Opening,0\n'))
      .expect(201);
    expect(read.body.rows[0]).toEqual(['Date', 'Description', 'Amount']);

    const today = cairoDay(new Date());
    const imported = await finance
      .post('/finance/bank-statements')
      .send({
        accountId: cib.id,
        fileName: 'cib.csv',
        lines: [
          {
            day: today,
            description: 'Owner transfer',
            amountPiastres: 500_000,
            balancePiastres: 500_000,
          },
          { day: today, description: 'SMS fees', amountPiastres: -500, balancePiastres: 499_500 },
        ],
      })
      .expect(201);
    expect(imported.body).toMatchObject({ number: 'BS-000001', imported: 2, matched: 1 });
    const rec = await finance.get(`/finance/bank-reconciliation/${cib.id}`).expect(200);
    expect(rec.body.bankOnly).toHaveLength(1);
    const charge = await finance
      .post(`/finance/bank-lines/${rec.body.bankOnly[0].id}/bank-charge`)
      .expect(201);
    expect(charge.body.status).toBe('posted');
    const after = await finance.get(`/finance/bank-reconciliation/${cib.id}`).expect(200);
    expect(after.body).toMatchObject({ differencePiastres: 0, matched: 2 });

    const month = today.slice(0, 7);
    await finance
      .put('/finance/budgets')
      .send({ month, accountId: (await account('expense:bank_charges')).id, amountPiastres: 1_000 })
      .expect(200);
    const budget = await finance.get(`/finance/budgets?month=${month}`).expect(200);
    expect(budget.body.rows.find((r: { code: string }) => r.code === '5501')).toMatchObject({
      budgetPiastres: 1_000,
      actualPiastres: 500,
      variancePiastres: 500,
    });
    await finance.get('/finance/vat-report').expect(200);
    const flow = await finance.get('/finance/cash-flow').expect(200);
    expect(flow.body.closingPiastres).toBe(499_500);
    expect((await finance.get('/finance/cash-forecast').expect(200)).body.weeks).toHaveLength(4);

    const journal = await finance.get('/finance/export/journal.csv').expect(200);
    expect(journal.text).toContain('Journal number');
    expect(journal.text).toContain('JV-000001');
    const pack = await finance
      .get(`/finance/export/audit-pack.zip?from=${addDays(today, -30)}&to=${today}`)
      .buffer(true)
      .parse((res, done) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => done(null, Buffer.concat(chunks)));
      })
      .expect(200);
    const files = (pack.body as Buffer).toString('latin1');
    expect(files).toContain('journal.csv');
    expect(files).toContain('trial-balance.csv');

    // Closing a year needs an approver; this year is not over.
    const me = await prisma.user.findUniqueOrThrow({ where: { email: 'finance@shiplynow.local' } });
    await admin.patch(`/admin/users/${me.id}`).send({ financeLevel: 'prepare' }).expect(200);
    await finance.post('/finance/year-close').send({ year: 2025 }).expect(403);
    const notOver = await admin
      .post('/finance/year-close')
      .send({ year: Number(today.slice(0, 4)) })
      .expect(400);
    expect(notOver.body.error).toBe('year_not_over');
    expect((await finance.get('/finance/year-close').expect(200)).body[0]).toMatchObject({
      closed: false,
    });
  });
});
