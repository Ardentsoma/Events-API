// Zod schemas for Venue request bodies and query parameters.
import { z } from 'zod';
import { paginationSchema } from './pagination';

export const venueQuerySchema = paginationSchema(['name', 'createdAt'], 'createdAt').extend({
  area: z.string().trim().min(1, 'area must not be empty').optional(),
  minCapacity: z.coerce.number().int('minCapacity must be an integer').min(1).optional(),
  maxCapacity: z.coerce.number().int('maxCapacity must be an integer').min(1).optional(),
});

export type VenueQuery = z.infer<typeof venueQuerySchema>;