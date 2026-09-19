// Venue business logic.
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/db';
import { ApiError } from '../middleware/errorHandler';
import { VenueQuery } from '../schemas/venueSchemas';
import { meta, Order, orderBy } from './pagination';

export async function listVenues(q: VenueQuery) {
  const where: Prisma.VenueWhereInput = {};
  if (q.area) where.area = q.area;
  if (q.minCapacity !== undefined || q.maxCapacity !== undefined) {
    where.capacity = {
      ...(q.minCapacity !== undefined ? { gte: q.minCapacity } : {}),
      ...(q.maxCapacity !== undefined ? { lte: q.maxCapacity } : {}),
    };
  }

  const [total, rows] = await Promise.all([
    prisma.venue.count({ where }),
    prisma.venue.findMany({
      where,
      orderBy: orderBy(q.sort, q.order as Order),
      skip: q.offset,
      take: q.limit,
    }),
  ]);

  return { rows, meta: meta(total, q.limit, q.offset) };
}

export async function getVenue(id: string) {
  const venue = await prisma.venue.findUnique({ where: { id } });
  if (!venue) throw new ApiError(404, 'VENUE_NOT_FOUND', `Venue '${id}' does not exist`);
  return venue;
}