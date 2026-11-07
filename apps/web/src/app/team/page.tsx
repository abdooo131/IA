import type { Metadata } from 'next';
import { TeamPage } from '@/components/site/TeamPage';
import { siteMetadata } from '@/components/site/metadata';

// A public website page, open to everyone (the middleware does not cover it).
export const dynamic = 'force-dynamic';

export function generateMetadata(): Promise<Metadata> {
  return siteMetadata('team');
}

export default function Page() {
  return <TeamPage />;
}
