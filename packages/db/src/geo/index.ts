export { areaNames, linkParent, loadBaseAreas, upsertArea, type AreaInput } from './areas';
export {
  forgetAreaNames,
  learnFromPoint,
  namesOtherGovernorate,
  resolveByAreas,
  type AreaStep,
  type EngineResult,
} from './engine';
export { applyAreaDictionary, AREA_DICTIONARY } from './dictionary';
export { addAreaName, decideSuggestion, geoStats, listSuggestions, searchAreas } from './admin';
export {
  districtBoxes,
  GREATER_CAIRO_BBOX,
  osmNames,
  placeAreas,
  placesQuery,
  relinkAll,
  saveDistrictStreets,
  saveOsmAreas,
  streetAreas,
  streetsQuery,
  type OsmElement,
} from './osm';
