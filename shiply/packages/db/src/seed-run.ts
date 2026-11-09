import { createDb } from './client';
import { seed } from './seed';

const db = createDb();
seed(db)
  .then(() => console.log('Seed done'))
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
