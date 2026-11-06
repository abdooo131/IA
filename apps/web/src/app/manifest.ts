import type { MetadataRoute } from 'next';

/**
 * Lets phones install Shiply Now from the browser (Add to Home Screen / Install app): it then
 * opens full screen with its own icon and name, starting at the person's home area.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Shiply Now',
    short_name: 'Shiply Now',
    description: '60 minute delivery from Shiply Now dark stores',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#FFFFFF',
    theme_color: '#0047BB',
    icons: [
      { src: '/brand/app-icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/brand/app-icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/brand/app-icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
