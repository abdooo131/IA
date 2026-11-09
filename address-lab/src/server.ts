// The tester's web page and its two calls: one address, and many addresses.
//   node src/server.ts            (PORT to change the port, 4300 by default)

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseAddress, reloadGazetteer } from './engine.ts';
import { forget, loadLearned, teach } from './learned.ts';
import { PLACES } from './places.ts';
import { extractAddresses, resultsToCsv, runBulk } from './bulk.ts';

const PAGE = fileURLToPath(new URL('../public/index.html', import.meta.url));
const MAX_BODY = 20 * 1024 * 1024;

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new Error('The file is too big (20 MB at most)'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function send(res: ServerResponse, status: number, body: string, type = 'application/json; charset=utf-8') {
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' });
  res.end(body);
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
      return send(res, 200, readFileSync(PAGE, 'utf8'), 'text/html; charset=utf-8');
    }
    if (req.method === 'POST' && url.pathname === '/api/parse') {
      const { address } = JSON.parse(await readBody(req)) as { address?: string };
      if (typeof address !== 'string') return send(res, 400, JSON.stringify({ error: 'address is required' }));
      return send(res, 200, JSON.stringify(parseAddress(address.slice(0, 2000))));
    }
    if (req.method === 'POST' && url.pathname === '/api/bulk') {
      const { text } = JSON.parse(await readBody(req)) as { text?: string };
      if (typeof text !== 'string') return send(res, 400, JSON.stringify({ error: 'text is required' }));
      const { addresses, note } = extractAddresses(text);
      const { results, summary } = runBulk(addresses);
      return send(res, 200, JSON.stringify({ note, summary, results, csv: resultsToCsv(results) }));
    }
    if (req.method === 'GET' && url.pathname === '/api/places') {
      const byId = new Map(PLACES.map((p) => [p.id, p]));
      const label = (id: string): string => {
        const parts: string[] = [];
        for (let p = byId.get(id); p; p = p.parent ? byId.get(p.parent) : undefined) parts.push(p.en);
        return parts.join(', ');
      };
      const places = PLACES.filter((p) => p.served !== false).map((p) => ({ id: p.id, kind: p.kind, label: label(p.id), ar: p.ar }));
      return send(res, 200, JSON.stringify({ places, learned: loadLearned() }));
    }
    if (req.method === 'POST' && (url.pathname === '/api/teach' || url.pathname === '/api/forget')) {
      const { name, placeId } = JSON.parse(await readBody(req)) as { name?: string; placeId?: string };
      if (!name || !placeId) return send(res, 400, JSON.stringify({ error: 'name and placeId are required' }));
      if (url.pathname === '/api/teach') teach(name, placeId);
      else forget(name, placeId);
      reloadGazetteer();
      return send(res, 200, JSON.stringify({ learned: loadLearned() }));
    }
    send(res, 404, JSON.stringify({ error: 'Not found' }));
  } catch (err) {
    send(res, 400, JSON.stringify({ error: err instanceof Error ? err.message : 'Bad request' }));
  }
});

const port = Number(process.env.PORT ?? 4300);
server.listen(port, () => console.log(`Address tester on http://localhost:${port}`));
