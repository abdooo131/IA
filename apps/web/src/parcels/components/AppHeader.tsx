'use client';
import { AccountMenu } from './AccountMenu';
import { Logo } from './Logo';

/** The top bar of the phone screens (couriers), as in Shiply Now: the logo and the gear menu. */
export function AppHeader() {
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-surface print:hidden">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-3 px-4">
        <Logo />
        <AccountMenu compact />
      </div>
    </header>
  );
}
