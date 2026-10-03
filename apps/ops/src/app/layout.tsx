import type { Metadata } from 'next';
import './globals.css';
import { Frame } from './frame';

export const metadata: Metadata = { title: 'Shiply Operations', description: 'Shiply internal dashboard' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" dir="ltr">
      <body>
        <Frame>{children}</Frame>
      </body>
    </html>
  );
}
