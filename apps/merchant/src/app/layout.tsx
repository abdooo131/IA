import type { Metadata } from 'next';
import './globals.css';
import { Frame } from './frame';

export const metadata: Metadata = { title: 'Shiply Merchant', description: 'Shiply merchant portal' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" dir="ltr">
      <body>
        <Frame>{children}</Frame>
      </body>
    </html>
  );
}
