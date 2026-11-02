import { redirect } from 'next/navigation';

/** Settings now live inside each app (its Configuration menu); old links open Operations'. */
export default function AdminSettingsPage() {
  redirect('/admin/settings/operations');
}
