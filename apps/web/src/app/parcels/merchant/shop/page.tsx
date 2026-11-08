import { redirect } from 'next/navigation';

/** The packaging shop is joining Shiply Now's packaging (docs/MERGE.md step 8); until then it is closed. */
export default function Moved() {
  redirect('/parcels/merchant');
}
