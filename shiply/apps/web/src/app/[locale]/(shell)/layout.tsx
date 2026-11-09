import type { ReactNode } from 'react';
import { MeProvider } from '@/shell/me';

export default function ShellLayout({ children }: { children: ReactNode }) {
  return <MeProvider>{children}</MeProvider>;
}
