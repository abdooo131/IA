'use client';

import L from './leaflet-setup';
import '@geoman-io/leaflet-geoman-free';
import '@geoman-io/leaflet-geoman-free/dist/leaflet-geoman.css';
import type { ZonePolygon } from '@shiplynow/shared';
import 'leaflet/dist/leaflet.css';
import { type Ref, useEffect, useImperativeHandle, useRef } from 'react';
import type { AdminStore, AdminZone } from '@/lib/admin-types';
import { boundsOf, MAP_COLORS, type MapArea } from '@/lib/zone-areas';

export interface AreaZoneMapHandle {
  /** "Select areas in a shape": the next polygon drawn is handed to onShape */
  startShape(): void;
  stopShape(): void;
  showArea(geometry: MapArea['geometry']): void;
  showZone(zoneId: string): void;
}

interface Props {
  areas: MapArea[];
  zones: AdminZone[];
  stores: AdminStore[];
  colors: Record<string, string>;
  locale: string;
  selectedZoneId: string | null;
  focusAreaId: string | null;
  /** Neighbourhoods are on show (districts become outlines) */
  detailed: boolean;
  onView(bbox: [number, number, number, number], zoom: number): void;
  onAreaClick(area: MapArea): void;
  onShape(polygon: ZonePolygon | 'multi'): void;
  ref?: Ref<AreaZoneMapHandle>;
}

function toPolygon(layer: L.Polygon): ZonePolygon | 'multi' {
  const geometry = layer.toGeoJSON(6).geometry;
  if (geometry.type === 'Polygon') return geometry as ZonePolygon;
  if (geometry.type === 'MultiPolygon' && geometry.coordinates.length === 1) {
    return { type: 'Polygon', coordinates: geometry.coordinates[0] } as ZonePolygon;
  }
  return 'multi';
}

function areaStyle(
  area: MapArea,
  props: Pick<Props, 'colors' | 'selectedZoneId' | 'focusAreaId' | 'detailed'>,
): L.PathOptions {
  const o = area.owner;
  const outlineOnly = props.detailed && area.level === 2;
  const style: L.PathOptions = {
    color: MAP_COLORS.nobody,
    weight: outlineOnly ? 2 : 1,
    fillColor: MAP_COLORS.nobody,
    fillOpacity: 0.03,
    opacity: 0.8,
    dashArray: undefined,
  };
  if (o?.excluded) {
    Object.assign(style, {
      color: MAP_COLORS.excluded,
      fillColor: MAP_COLORS.excluded,
      fillOpacity: outlineOnly ? 0.05 : 0.3,
      dashArray: '4 4',
    });
  } else if (o?.darkStoreId) {
    const c = props.colors[o.darkStoreId] ?? MAP_COLORS.nobody;
    const fill = o.inherited ? 0.16 : 0.38;
    Object.assign(style, {
      color: c,
      fillColor: c,
      fillOpacity: outlineOnly ? 0.06 : fill,
      weight: o.zoneId && o.zoneId === props.selectedZoneId ? 3 : style.weight,
    });
  }
  if (o?.needsReview)
    Object.assign(style, { color: MAP_COLORS.review, weight: 3, dashArray: '6 4' });
  if (area.id === props.focusAreaId)
    Object.assign(style, { color: MAP_COLORS.focus, weight: 4, dashArray: undefined, opacity: 1 });
  return style;
}

/**
 * The zone map: areas coloured by the store that serves them (districts far out,
 * neighbourhoods and compounds closer in), zone outlines dashed, store pins, and Geoman
 * only for "select the areas inside this shape".
 */
export default function AreaZoneMap(props: Props) {
  const { areas, zones, stores, colors, locale, selectedZoneId, focusAreaId, detailed, ref } =
    props;
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const areaGroup = useRef<L.FeatureGroup | null>(null);
  const zoneLayers = useRef(new Map<string, L.GeoJSON>());
  const callbacks = useRef(props);
  callbacks.current = props;

  // Create the map once.
  useEffect(() => {
    if (!container.current || map.current) return;
    const m = L.map(container.current, { zoomControl: true, preferCanvas: true }).setView(
      [30.03, 31.33],
      11,
    );
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(m);
    m.pm.setGlobalOptions({ allowSelfIntersection: false, snappable: false });
    m.on('pm:create', (e) => {
      const layer = e.layer as L.Polygon;
      const polygon = toPolygon(layer);
      layer.remove();
      callbacks.current.onShape(polygon);
    });
    const report = () => {
      const b = m.getBounds();
      callbacks.current.onView(
        [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()].map((n) => Number(n.toFixed(5))) as [
          number,
          number,
          number,
          number,
        ],
        m.getZoom(),
      );
    };
    m.on('moveend', report);
    areaGroup.current = L.featureGroup().addTo(m);
    map.current = m;
    report();
    return () => {
      m.remove();
      map.current = null;
    };
  }, []);

  // Zone outlines (the union of each zone's areas, or an old drawn outline) and store pins.
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    zoneLayers.current.forEach((layer) => layer.remove());
    zoneLayers.current.clear();
    for (const zone of zones) {
      if (!zone.area) continue;
      const layer = L.geoJSON(zone.area as GeoJSON.MultiPolygon, {
        interactive: false,
        // Far out the zone's shape shows what it serves (its neighbourhoods are not loaded);
        // closer in the areas carry the colour and the zone is only an outline.
        style: {
          color: colors[zone.darkStoreId] ?? MAP_COLORS.nobody,
          weight: zone.id === selectedZoneId ? 3 : 1.5,
          fill: !detailed,
          fillOpacity: zone.isActive ? 0.3 : 0.08,
          dashArray: zone.isActive ? '2 6' : '1 8',
        },
      }).addTo(m);
      zoneLayers.current.set(zone.id, layer);
    }
    const pins = stores.map((s) =>
      L.circleMarker([s.latitude, s.longitude], {
        radius: 8,
        color: '#FFFFFF',
        weight: 3,
        fillColor: colors[s.id] ?? MAP_COLORS.nobody,
        fillOpacity: 1,
      })
        .bindTooltip(s.code, { permanent: false })
        .addTo(m),
    );
    return () => pins.forEach((p) => p.remove());
  }, [zones, stores, colors, selectedZoneId, detailed]);

  // The areas, districts first so neighbourhoods and compounds sit on top.
  useEffect(() => {
    const group = areaGroup.current;
    if (!group) return;
    group.clearLayers();
    const sorted = [...areas].sort((a, b) => a.level - b.level);
    for (const area of sorted) {
      const layer = L.geoJSON(area.geometry, {
        style: areaStyle(area, { colors, selectedZoneId, focusAreaId, detailed }),
      });
      const name = (locale === 'ar' ? area.nameAr : area.nameEn) || area.nameEn || area.nameAr;
      layer.bindTooltip(name, { sticky: true, direction: 'top' });
      layer.on('click', (e) => {
        L.DomEvent.stopPropagation(e);
        callbacks.current.onAreaClick(area);
      });
      group.addLayer(layer);
    }
  }, [areas, colors, selectedZoneId, focusAreaId, detailed, locale]);

  useImperativeHandle(ref, () => ({
    startShape() {
      map.current?.pm.enableDraw('Polygon');
    },
    stopShape() {
      map.current?.pm.disableDraw();
    },
    showArea(geometry) {
      const [w, s, e, n] = boundsOf(geometry);
      map.current?.fitBounds(
        [
          [s, w],
          [n, e],
        ],
        { padding: [40, 40], maxZoom: 16 },
      );
    },
    showZone(zoneId) {
      const layer = zoneLayers.current.get(zoneId);
      if (layer && map.current)
        map.current.fitBounds(layer.getBounds(), { padding: [40, 40], maxZoom: 15 });
    },
  }));

  // Leaflet assumes left to right; keep the map LTR inside Arabic pages.
  return (
    <div
      dir="ltr"
      ref={container}
      className="h-[420px] w-full rounded-lg border border-line md:h-[580px]"
    />
  );
}
