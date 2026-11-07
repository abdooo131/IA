export { areaNames, linkParent, loadBaseAreas, upsertArea, type AreaInput } from './areas';
export {
  areaIndex,
  buildAreaIndex,
  forgetAreaNames,
  isGenericName,
  learnFromPoint,
  namesOtherGovernorate,
  readAddress,
  readAddressWith,
  type AddressReading,
  type AreaIndex,
  type AreaStep,
  type UnsureReason,
} from './engine';
export {
  addressKey,
  fullAddress,
  geocodeKey,
  learnedPoint,
  metresBetween,
  recordDeliveredPoint,
  resolveDelivery,
  type DeliveryDecision,
  type DeliveryPoint,
  type PointSource,
  type ResolveDeliveryInput,
} from './delivery';
export {
  areaOwners,
  assignArea,
  assignAreasInShape,
  excludeArea,
  hasOtherOwnersInside,
  listAreasForMap,
  listAreasToReview,
  recomputeZoneArea,
  searchServedAreas,
  unassignArea,
  type AreaOwner,
  type AssignAreaInput,
  type MapArea,
  type ServedArea,
} from './zone-areas';
export { cleanUpAreas, type CleanUpResult } from './cleanup';
export { assignAreasFromOutlines, type OutlineMove } from './outlines';
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
export { prepareAreaMap } from './prepare';
