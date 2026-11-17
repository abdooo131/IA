import { AppHeader } from '@/components/AppHeader';
import { ClockCard } from '@/components/hr/ClockCard';
import { type RiderDelivery, RiderHome, type RiderMe } from '@/components/rider/RiderHome';
import { apiGet } from '@/lib/api-server';

export const dynamic = 'force-dynamic';

export default async function RiderPage() {
  const [me, deliveries] = await Promise.all([
    apiGet<RiderMe>('/rider/me'),
    apiGet<RiderDelivery[]>('/rider/deliveries'),
  ]);
  return (
    <div className="flex min-h-dvh flex-col">
      <AppHeader />
      <main className="mx-auto w-full max-w-xl flex-1 px-4 py-5">
        <div className="mb-4">
          <ClockCard compact />
        </div>
        <RiderHome me={me} initial={deliveries} />
      </main>
    </div>
  );
}
