import { createDb } from '@shiply/db';
import { createApp } from '../app';
import { DEMO_PASSWORD, loadDemo } from './load';

/** pnpm demo: fills an empty, seeded database with demo data (made up people and addresses). */
async function main() {
  const db = createDb();
  const app = await createApp(db);
  await app.init();
  const r = await loadDemo(app, db);
  console.log(r.message);
  if (r.loaded) console.log(`Logins (password ${DEMO_PASSWORD}): hany@shiply.local (supervisor), mariam@shiply.local (accountant), samir@shiply.local (viewer); couriers 01100000001 to 01100000008.`);
  await app.close();
  await db.$disconnect();
}
void main();
