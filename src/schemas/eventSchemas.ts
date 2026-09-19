// Zod schemas for Event queries and request bodies.
import { z } from 'zod';
import { paginationSchema } from './pagination';

const eventSorts = ['startTime', 'ticketPriceMinor', 'createdAt'] as const;

export const eventQuerySchema = paginationSchema(eventSorts, 'startTime').extend({
  category: z.string().trim().min(1, 'category must not be empty').optional(),
  venueId: z.string().min(1, 'venueId must not be empty').optional(),
  status: z.enum(['upcoming', 'ongoing', 'completed', 'cancelled']).optional(),
  startDateFrom: z.coerce.date().optional(),
  startDateTo: z.coerce.date().optional(),
  minPrice: z.coerce.number().int('minPrice must be an integer').min(0).optional(),
  maxPrice: z.coerce.number().int('maxPrice must be an integer').min(0).optional(),
});

export type EventQuery = z.infer<typeof eventQuerySchema>;

// Nested endpoint (GET /venues/:id/events) supports pagination only.
export const nestedEventQuerySchema = paginationSchema(eventSorts, 'startTime');
export type NestedEventQuery = z.infer<typeof nestedEventQuerySchema>;

export const eventStatusSchema = z.enum(['upcoming', 'ongoing', 'completed', 'cancelled']);

const eventFields = {
  title: z.string().trim().min(1, 'title is required'),
  description: z.string().trim().min(1).optional(),
  category: z.string().trim().min(1, 'category is required'),
  venueId: z.string().trim().min(1, 'venueId is required'),
  startTime: z.coerce.date(),
  endTime: z.coerce.date(),
  ticketPriceMinor: z.number().int().min(0, 'ticketPriceMinor must be zero or positive'),
  currency: z.string().trim().min(1).default('NGN'),
  capacity: z.number().int().min(1, 'capacity must be at least 1'),
  status: eventStatusSchema.default('upcoming'),
};

const durationValid = (body: { startTime?: Date; endTime?: Date }) =>
  !body.startTime || !body.endTime || body.endTime > body.startTime;

export const eventCreateSchema = z
  .object(eventFields)
  .refine(durationValid, { message: 'endTime must be after startTime', path: ['endTime'] });

export type EventCreate = z.infer<typeof eventCreateSchema>;

export const eventUpdateSchema = z
  .object({
    title: z.string().trim().min(1).optional(),
    description: z.string().trim().min(1).nullable().optional(),
    category: z.string().trim().min(1).optional(),
    venueId: z.string().trim().min(1).optional(),
    startTime: z.coerce.date().optional(),
    endTime: z.coerce.date().optional(),
    ticketPriceMinor: z.number().int().min(0).optional(),
    currency: z.string().trim().min(1).optional(),
    capacity: z.number().int().min(1).optional(),
    status: eventStatusSchema.optional(),
  })
  .refine(durationValid, { message: 'endTime must be after startTime', path: ['endTime'] });

export type EventUpdate = z.infer<typeof eventUpdateSchema>;