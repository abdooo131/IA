import type { PrismaClient } from '@prisma/client';
import { cleanUpAreas } from './cleanup';
import { applyAreaDictionary } from './dictionary';
import { forgetAreaNames } from './engine';
import { assignAreasFromOutlines } from './outlines';

/**
 * Everything the area map needs after deploys, in order: the clean up (docs/ZONES.md §4), the
 * dictionary names, then, once per database, zones from the drawn outlines (§1). Run by the
 * seed and at API start; a second run changes nothing.
 */
export async function prepareAreaMap(db: PrismaClient) {
  const cleanUp = await db.$transaction((tx) => cleanUpAreas(tx), {
    timeout: 300_000,
    maxWait: 20_000,
  });
  const dictionary = await applyAreaDictionary(db);
  const outlines = await assignAreasFromOutlines(db);
  forgetAreaNames();
  return { cleanUp, dictionary, outlines };
}
