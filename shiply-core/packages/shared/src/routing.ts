// Hub and spoke routing. Every parcel that is not already at its target hub goes through
// the sorting hub, then straight to the target hub.
import type { Direction } from './statuses';

export interface RouteInput {
  direction: Direction;
  currentHubId: string;
  originHubId: string;
  destinationHubId: string;
  sortingHubId: string;
}

/** The hub the parcel heads to next: forward to the customer's hub, back to the merchant's hub. */
export function targetHub(input: Pick<RouteInput, 'direction' | 'originHubId' | 'destinationHubId'>): string {
  return input.direction === 'FORWARD' ? input.destinationHubId : input.originHubId;
}

/** Next hub to send the parcel to, or null when it is at its target and ready to go out. */
export function nextHop(input: RouteInput): string | null {
  const target = targetHub(input);
  if (input.currentHubId === target) return null;
  if (input.currentHubId === input.sortingHubId) return target;
  return input.sortingHubId;
}
