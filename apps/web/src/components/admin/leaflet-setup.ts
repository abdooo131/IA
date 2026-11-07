import L from 'leaflet';

// The Geoman plugin attaches itself to a global L when it loads, so Leaflet has to be
// global before the plugin is imported. Import this file before '@geoman-io/...'.
(window as unknown as { L: typeof L }).L = L;

export default L;
