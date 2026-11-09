import { createDb } from '@shiply/db';
import { createApp } from './app';

async function main() {
  const app = await createApp(createDb());
  const port = Number(process.env.API_PORT ?? 4100);
  await app.listen(port);
  console.log(`Shiply API on http://localhost:${port} (docs at /docs)`);
}
void main();
