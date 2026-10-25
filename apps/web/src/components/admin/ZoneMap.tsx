'use client';

import L from './leaflet-setup';
import '@geoman-io/leaflet-geoman-free';
import '@geoman-io/leaflet-geoman-free/dist/leaflet-geoman.css';
import type { ZonePolygon } from '@shiplynow/shared';
import 'leaflet/dist/leaflet.css';
import { type Ref, useEffect, useImperativeHandle, useRef } from 'react';
import type { AdminStore, AdminZone } from '@/lib/admin-types';

export interface ZoneMapHandle {
  startEdit(zoneId: string): void;
  /** The edited shape, 'multi' if it has several parts, or null when nothing is being edited */
  finishEdit(): ZonePolygon | 'multi' | null;
  cancelEdit(): void;
  startDraw(): void;
  stopDraw(): void;
}

interface Props {
  zones: AdminZone[];
  stores: AdminStore[];
  colors: Record<string, string>;
  selectedZoneId: string | null;
  onSelect(zoneId: string): void;
  onDrawn(polygon: ZonePolygon | 'multi'): void;
  ref?: Ref<ZoneMapHandle>;
}

function toPolygon(layer: L.Polygon): ZonePolygon | 'multi' {
  const geometry = layer.toGeoJSON(6).geometry;
  if (geometry.type === 'Polygon') return geometry as ZonePolygon;
  if (geometry.type === 'MultiPolygon' && geometry.coordinates.length === 1) {
    return { type: 'Polygon', coordinates: geometry.coordinates[0] } as ZonePolygon;
  }
  return 'multi';
}

/** Leaflet map of all zones on OpenStreetMap tiles, with Geoman for editing and drawing. */
export default function ZoneMap({
  zones,
  stores,
  colors,
  selectedZoneId,
  onSelect,
  onDrawn,
  ref,
}: Props) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layers = useRef(new Map<string, L.Polygon>());
  const editing = useRef<{ id: string; layer: L.Polygon; original: L.LatLngExpression[][] } | null>(
    null,
  );
  const callbacks = useRef({ onSelect, onDrawn });
  callbacks.current = { onSelect, onDrawn };

  // Create the map once.
  useEffect(() => {
    if (!container.current || map.current) return;
    const m = L.map(container.current, { zoomControl: true }).setView([30.03, 31.33], 11);
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
      callbacks.current.onDrawn(polygon);
    });
    map.current = m;
    return () => {
      m.remove();
      map.current = null;
    };
  }, []);

  // Draw zones and store pins whenever the data changes.
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    layers.current.forEach((layer) => layer.remove());
    layers.current.clear();
    const group = L.featureGroup();
    for (const zone of zones) {
      if (!zone.area) continue;
      const color = colors[zone.darkStoreId] ?? '#0047BB';
      const layer = L.geoJSON(zone.area as GeoJSON.MultiPolygon, {
        style: {
          color,
          weight: 2,
          fillOpacity: zone.isActive ? 0.18 : 0.04,
          dashArray: zone.isActive ? undefined : '6 6',
        },
      }).getLayers()[0] as L.Polygon;
      layer.bindTooltip(`${zone.code}`, { sticky: true });
      layer.on('click', () => callbacks.current.onSelect(zone.id));
      layer.addTo(m);
      group.addLayer(layer);
      layers.current.set(zone.id, layer);
    }
    const pins = stores.map((s) =>
      L.circleMarker([s.latitude, s.longitude], {
        radius: 7,
        color: '#FFFFFF',
        weight: 2,
        fillColor: colors[s.id] ?? '#0047BB',
        fillOpacity: 1,
      })
        .bindTooltip(s.code)
        .addTo(m),
    );
    if (group.getLayers().length > 0) m.fitBounds(group.getBounds(), { padding: [24, 24] });
    return () => {
      pins.forEach((p) => p.remove());
    };
  }, [zones, stores, colors]);

  // Highlight the selected zone.
  useEffect(() => {
    layers.current.forEach((layer, id) =>
      layer.setStyle({ weight: id === selectedZoneId ? 4 : 2 }),
    );
    const selected = selectedZoneId ? layers.current.get(selectedZoneId) : undefined;
    if (selected && map.current)
      map.current.fitBounds(selected.getBounds(), { padding: [40, 40], maxZoom: 15 });
  }, [selectedZoneId, zones]);

  useImperativeHandle(ref, () => ({
    startEdit(zoneId) {
      const layer = layers.current.get(zoneId);
      if (!layer) return;
      editing.current = {
        id: zoneId,
        layer,
        original: JSON.parse(JSON.stringify(layer.getLatLngs())) as L.LatLngExpression[][],
      };
      layer.pm.enable({ allowSelfIntersection: false });
    },
    finishEdit() {
      const current = editing.current;
      if (!current) return null;
      current.layer.pm.disable();
      editing.current = null;
      return toPolygon(current.layer);
    },
    cancelEdit() {
      const current = editing.current;
      if (!current) return;
      current.layer.pm.disable();
      current.layer.setLatLngs(current.original);
      editing.current = null;
    },
    startDraw() {
      map.current?.pm.enableDraw('Polygon');
    },
    stopDraw() {
      map.current?.pm.disableDraw();
    },
  }));

  // Leaflet assumes left to right; keep the map LTR inside Arabic pages.
  return (
    <div
      dir="ltr"
      ref={container}
      className="h-[420px] w-full rounded-lg border border-line md:h-[540px]"
    />
  );
}
