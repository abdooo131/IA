import type { Metadata } from 'next';
import { HowItWorksPage } from '@/components/site/HowItWorksPage';
import { siteMetadata } from '@/components/site/metadata';

// A public website page, open to everyone (the middleware does not cover it).
export const dynamic = 'force-dynamic';

export function generateMetadata(): Promise<Metadata> {
  return siteMetadata('how');
}

export default function Page() {
  return <HowItWorksPage />;
}
