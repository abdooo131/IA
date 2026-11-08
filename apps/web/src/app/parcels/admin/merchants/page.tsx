import { redirect } from 'next/navigation';

/**
 * One merchant list for both services (docs/MERGE.md "One structure"): a merchant's next day
 * setup is the Next day tab of its page in Merchants, its prices are in the contract and its
 * logins are on its Users tab.
 */
export default function Moved() {
  redirect('/admin/merchants');
}
