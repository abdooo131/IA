import { redirect } from 'next/navigation';

/** One team for both services: Shiply Now's team page sets every member's rights. */
export default function Moved() {
  redirect('/merchant/team');
}
