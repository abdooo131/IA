import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { TEAM_PAGE_LIVE } from '@/components/site/site-nav';
import { TeamPage } from '@/components/site/TeamPage';
import { siteMetadata } from '@/components/site/metadata';

// A public website page, open to everyone (the middleware does not cover it).
export const dynamic = 'force-dynamic';

export function generateMetadata(): Promise<Metadata> {
  return siteMetadata('team');
}

export default function Page() {
  if (!TEAM_PAGE_LIVE) notFound();
  return <TeamPage />;
}
