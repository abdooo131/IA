'use client';

import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useEffect, useRef } from 'react';

type Point = { lat: number; lng: number };

/** OpenStreetMap with the rider (blue) and the drop point (teal); follows the rider as it moves. */
export default function RiderMap({
  rider,
  destination,
}: {
  rider: Point;
  destination: Point | null;
}) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const riderDot = useRef<L.CircleMarker | null>(null);
  const dropDot = useRef<L.CircleMarker | null>(null);

  useEffect(() => {
    if (!container.current || map.current) return;
    const m = L.map(container.current, { zoomControl: true, attributionControl: true });
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(m);
    map.current = m;
    return () => {
      m.remove();
      map.current = null;
      riderDot.current = null;
      dropDot.current = null;
    };
  }, []);

  useEffect(() => {
    const m = map.current;
    if (!m) return;
    if (!riderDot.current) {
      riderDot.current = L.circleMarker([rider.lat, rider.lng], {
        radius: 9,
        color: '#ffffff',
        weight: 3,
        fillColor: '#0047BB',
        fillOpacity: 1,
      }).addTo(m);
    } else riderDot.current.setLatLng([rider.lat, rider.lng]);
    if (destination && !dropDot.current) {
      dropDot.current = L.circleMarker([destination.lat, destination.lng], {
        radius: 8,
        color: '#ffffff',
        weight: 3,
        fillColor: '#0E9384',
        fillOpacity: 1,
      }).addTo(m);
    }
    const points: L.LatLngExpression[] = [[rider.lat, rider.lng]];
    if (destination) points.push([destination.lat, destination.lng]);
    if (points.length > 1) m.fitBounds(L.latLngBounds(points), { padding: [40, 40], maxZoom: 16 });
    else m.setView(points[0]!, 15);
  }, [rider.lat, rider.lng, destination]);

  return (
    <div ref={container} className="h-64 w-full overflow-hidden rounded-lg border border-line" />
  );
}
