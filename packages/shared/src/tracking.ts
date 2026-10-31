import { z } from 'zod';

/** The rider phone's position, sent while an order is out for delivery. */
export const riderLocationSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});

/** The customer's rating from the tracking page. */
export const orderRatingSchema = z.object({
  stars: z.number().int().min(1).max(5),
  comment: z.string().trim().max(500).optional(),
});
