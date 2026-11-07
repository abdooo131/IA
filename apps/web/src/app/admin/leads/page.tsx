import { redirect } from 'next/navigation';

/** Website leads moved to the Sales app (docs/SALES.md); old links land on its Leads page. */
export default function AdminLeadsPage() {
  redirect('/admin/sales/leads');
}
