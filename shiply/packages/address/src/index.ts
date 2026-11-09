export { buildGazetteer, chainOf, areaOf, LEVEL, type Gazetteer, type Taught } from './gazetteer';
export { parseAddress, defaultGazetteer, type Result, type Status, type Parts, type AreaRef, type Method } from './engine';
export { extractAddresses, summarize, resultsToCsv, parseCsv, type Summary } from './bulk';
export { normalizeText, foldText } from './normalize';
export { SEED_PLACES, type Place, type Kind } from './seed-places';
