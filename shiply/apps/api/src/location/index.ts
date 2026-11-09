// The location module's public interface. Other modules import only from here.
export { LocationModule } from './location.module';
export type { Geocoder, GeoAnswer } from './geocoder/geocoder';
export { LocationService, type ResolveInput, type ResolveResult } from './location.service';
export type { AreaServiceAnswer } from './service-chain';
