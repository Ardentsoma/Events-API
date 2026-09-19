// Event business logic (listing part — shared with GET /venues/:id/events).
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/db';
import { newId } from '../lib/id';
import { ApiError } from '../middleware/errorHandler';
import { EventCreate, EventQuery, EventUpdate } from '../schemas/eventSchemas';
import { EventTicketsQuery } from '../schemas/ticketSchemas';
import { meta, Order, orderBy } from './pagination';

export interface ListEventsParams {
  limit: number;
  offset: number;
  sort: string;
  order: Order;
  venueId?: string;
  category?: string;
  status?: EventQuery['status'];
  startDateFrom?: Date;
  startDateTo?: Date;
  minPrice?: number;
  maxPrice?: number;
}

export async function listEvents(p: ListEventsParams) {
  const where: Prisma.EventWhereInput = {};
  if (p.venueId) where.venueId = p.venueId;
  if (p.category) where.category = p.category;
  if (p.status) where.status = p.status;

  if (p.startDateFrom !== undefined || p.startDateTo !== undefined) {
    where.startTime = {
      ...(p.startDateFrom !== undefined ? { gte: p.startDateFrom } : {}),
      ...(p.startDateTo !== undefined ? { lte: p.startDateTo } : {}),
    };
  }
  if (p.minPrice !== undefined || p.maxPrice !== undefined) {
    where.ticketPriceMinor = {
      ...(p.minPrice !== undefined ? { gte: p.minPrice } : {}),
      ...(p.maxPrice !== undefined ? { lte: p.maxPrice } : {}),
    };
  }

  const [total, rows] = await Promise.all([
    prisma.event.count({ where }),
    prisma.event.findMany({
      where,
      orderBy: orderBy(p.sort, p.order),
      skip: p.offset,
      take: p.limit,
    }),
  ]);

  return { rows, meta: meta(total, p.limit, p.offset) };
}

export async function getEvent(id: string) {
  const event = await prisma.event.findUnique({ where: { id } });
  if (!event) throw new ApiError(404, 'EVENT_NOT_FOUND', `Event '${id}' does not exist`);
  return event;
}

export async function createEvent(input: EventCreate) {
  const venue = await prisma.venue.findUnique({ where: { id: input.venueId } });
  if (!venue) throw new ApiError(404, 'VENUE_NOT_FOUND', `Venue '${input.venueId}' does not exist`);

  return prisma.event.create({
    data: {
      id: newId(),
      title: input.title,
      description: input.description,
      category: input.category,
      venueId: input.venueId,
      startTime: input.startTime,
      endTime: input.endTime,
      ticketPriceMinor: input.ticketPriceMinor,
      currency: input.currency,
      capacity: input.capacity,
      status: input.status,
    },
  });
}

export async function updateEvent(id: string, input: EventUpdate) {
  await getEvent(id); // 404 if unknown
  return prisma.event.update({
    where: { id },
    data: input,
  });
}

export async function deleteEvent(id: string) {
  await getEvent(id); // 404 if unknown

  // Tickets reference their event; remove them first so the event itself can
  // be deleted. Runs in a transaction so a failure leaves nothing half-done.
  await prisma.$transaction([
    prisma.ticket.deleteMany({ where: { eventId: id } }),
    prisma.event.delete({ where: { id } }),
  ]);
}

export async function listEventTickets(eventId: string, q: EventTicketsQuery) {
  await getEvent(eventId); // 404 if unknown

  const where: Prisma.TicketWhereInput = { eventId };
  const [total, rows] = await Promise.all([
    prisma.ticket.count({ where }),
    prisma.ticket.findMany({
      where,
      orderBy: orderBy(q.sort, q.order),
      skip: q.offset,
      take: q.limit,
    }),
  ]);

  return { rows, meta: meta(total, q.limit, q.offset) };
}