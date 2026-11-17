import type { Metadata } from 'next';
import { ContactPage } from '@/components/site/ContactPage';
import { siteMetadata } from '@/components/site/metadata';

// A public website page, open to everyone (the middleware does not cover it).
export const dynamic = 'force-dynamic';

export function generateMetadata(): Promise<Metadata> {
  return siteMetadata('contact');
}

export default function Page() {
  return <ContactPage />;
}
