import { redirect } from 'next/navigation';

/** HR phase 1: this page moved into one setup page; the old address opens the right tab. */
export default function MovedPage() {
  redirect('/admin/hr/organisation?tab=positions');
}
