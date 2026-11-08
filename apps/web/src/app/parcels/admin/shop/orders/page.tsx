import { redirect } from 'next/navigation';

/** Since the merge (docs/MERGE.md step 3) this lives in Shiply Now's Accounting for both companies. */
export default function Moved() {
  redirect('/admin/packaging');
}
