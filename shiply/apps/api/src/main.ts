import { createDb } from '@shiply/db';
import { createApp } from './app';
import { startEventWorker } from './platform';

async function main() {
  const db = createDb();
  const app = await createApp(db);
  startEventWorker(db);
  const port = Number(process.env.API_PORT ?? 4100);
  await app.listen(port);
  console.log(`Shiply API on http://localhost:${port} (docs at /docs)`);
}
void main();
