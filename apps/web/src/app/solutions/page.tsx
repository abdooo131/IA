import type { Metadata } from 'next';
import { SolutionsPage } from '@/components/site/SolutionsPage';
import { siteMetadata } from '@/components/site/metadata';

// A public website page, open to everyone (the middleware does not cover it).
export const dynamic = 'force-dynamic';

export function generateMetadata(): Promise<Metadata> {
  return siteMetadata('solutions');
}

export default function Page() {
  return <SolutionsPage />;
}
