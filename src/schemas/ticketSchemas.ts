// Zod schemas for Ticket request bodies and nested list queries.
import { z } from 'zod';
import { paginationSchema } from './pagination';

export const ticketCreateSchema = z.object({
  eventId: z.string().trim().min(1, 'eventId is required'),
  attendeeName: z.string().trim().min(1, 'attendeeName is required'),
  attendeeEmail: z.string().email('attendeeEmail must be a valid email address'),
  quantity: z.number().int().min(1, 'quantity must be at least 1'),
  status: z.enum(['reserved', 'confirmed', 'cancelled']).default('reserved'),
});

export type TicketCreate = z.infer<typeof ticketCreateSchema>;

// PATCH /tickets/:id may only change the status (e.g. to cancel a ticket).
export const ticketUpdateSchema = z
  .object({
    status: z.enum(['reserved', 'confirmed', 'cancelled']),
  })
  .strict();

export type TicketUpdate = z.infer<typeof ticketUpdateSchema>;

// Nested endpoint (GET /events/:id/tickets) — pagination only.
export const eventTicketsQuerySchema = paginationSchema(['createdAt', 'purchasedAt'], 'purchasedAt');
export type EventTicketsQuery = z.infer<typeof eventTicketsQuerySchema>;