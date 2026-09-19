// Ticket business logic, including the event-capacity business rule.
import { prisma } from '../lib/db';
import { newId } from '../lib/id';
import { ApiError } from '../middleware/errorHandler';
import { TicketCreate } from '../schemas/ticketSchemas';

export async function createTicket(input: TicketCreate) {
  // The whole check + insert runs inside a transaction: an event can never
  // sell more tickets than its capacity, even under concurrent requests.
  return prisma.$transaction(async (tx) => {
    const event = await tx.event.findUnique({ where: { id: input.eventId } });
    if (!event) throw new ApiError(404, 'EVENT_NOT_FOUND', `Event '${input.eventId}' does not exist`);

    // Sum only non-cancelled tickets: cancelled tickets don't count towards
    // the sold total.
    const agg = await tx.ticket.aggregate({
      where: { eventId: input.eventId, status: { not: 'cancelled' } },
      _sum: { quantity: true },
    });
    const sold = agg._sum.quantity ?? 0;
    const remaining = event.capacity - sold;

    if (input.quantity > remaining) {
      throw new ApiError(
        422,
        'CAPACITY_EXCEEDED',
        `Event '${input.eventId}' has capacity ${event.capacity} and ${remaining} ticket(s) still available; ` +
          `cannot add ${input.quantity}`,
      );
    }

    return tx.ticket.create({
      data: {
        id: newId(),
        eventId: input.eventId,
        attendeeName: input.attendeeName,
        attendeeEmail: input.attendeeEmail,
        quantity: input.quantity,
        status: input.status,
      },
    });
  });
}

export async function getTicket(id: string) {
  const ticket = await prisma.ticket.findUnique({ where: { id } });
  if (!ticket) throw new ApiError(404, 'TICKET_NOT_FOUND', `Ticket '${id}' does not exist`);
  return ticket;
}

export async function updateTicketStatus(id: string, status: 'reserved' | 'confirmed' | 'cancelled') {
  await getTicket(id); // 404 if unknown
  return prisma.ticket.update({
    where: { id },
    data: { status },
  });
}