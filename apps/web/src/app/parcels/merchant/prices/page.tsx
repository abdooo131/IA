import { redirect } from 'next/navigation';

/** Next day prices are part of the merchant's contract (one contract for both services). */
export default function Moved() {
  redirect('/merchant/contract');
}
