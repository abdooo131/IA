'use client';

import { useEffect, useRef, useState } from 'react';
import { apiSend } from '@/lib/api-client';

export type LocationState = 'off' | 'sharing' | 'denied' | 'unsupported';

/**
 * Shares the phone's position while the rider carries orders, at most once every
 * `pingSeconds`, so the customer can follow the rider on the tracking page. Stops as soon
 * as nothing is in hand.
 */
export function useRiderLocation(carrying: boolean, pingSeconds: number): LocationState {
  const [state, setState] = useState<LocationState>('off');
  const lastSent = useRef(0);

  useEffect(() => {
    if (!carrying) {
      setState('off');
      return;
    }
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setState('unsupported');
      return;
    }
    const watch = navigator.geolocation.watchPosition(
      (pos) => {
        setState('sharing');
        const now = Date.now();
        if (now - lastSent.current < pingSeconds * 1000) return;
        lastSent.current = now;
        void apiSend('POST', '/rider/location', {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
        });
      },
      (err) => setState(err.code === err.PERMISSION_DENIED ? 'denied' : 'sharing'),
      { enableHighAccuracy: true, maximumAge: 10_000, timeout: 30_000 },
    );
    return () => navigator.geolocation.clearWatch(watch);
  }, [carrying, pingSeconds]);

  return state;
}
