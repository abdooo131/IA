import type { Metadata } from 'next';
import './globals.css';
import { Frame } from './frame';

export const metadata: Metadata = { title: 'Shiply Merchant', description: 'Shiply merchant portal' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" dir="ltr">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans+Arabic:wght@400;500;600&family=IBM+Plex+Sans:wght@400;500;600&family=Readex+Pro:wght@400;500;600;700&display=swap"
        />
      </head>
      <body>
        <Frame>{children}</Frame>
      </body>
    </html>
  );
}
