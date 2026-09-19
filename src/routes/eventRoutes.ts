import { Router } from 'express';
import { asyncHandler } from '../middleware/asyncHandler';
import { validationFailure } from '../middleware/errorHandler';
import { eventCreateSchema, eventQuerySchema, eventUpdateSchema } from '../schemas/eventSchemas';
import { eventTicketsQuerySchema } from '../schemas/ticketSchemas';
import { dataEnvelope } from '../utils/envelope';
import * as eventService from '../services/eventService';

const router = Router();

router.get('/', asyncHandler(async (req, res) => {
  const parsed = eventQuerySchema.safeParse(req.query);
  if (!parsed.success) throw validationFailure(400, 'INVALID_QUERY_PARAMS', parsed.error, 'query');

  const { rows, meta } = await eventService.listEvents(parsed.data);
  res.json(dataEnvelope(rows, meta));
}));

router.get('/:id', asyncHandler(async (req, res) => {
  const event = await eventService.getEvent(req.params.id);
  res.json(dataEnvelope(event));
}));

router.get('/:id/tickets', asyncHandler(async (req, res) => {
  const parsed = eventTicketsQuerySchema.safeParse(req.query);
  if (!parsed.success) throw validationFailure(400, 'INVALID_QUERY_PARAMS', parsed.error, 'query');

  const { rows, meta } = await eventService.listEventTickets(req.params.id, parsed.data);
  res.json(dataEnvelope(rows, meta));
}));

router.post('/', asyncHandler(async (req, res) => {
  const parsed = eventCreateSchema.safeParse(req.body);
  if (!parsed.success) throw validationFailure(422, 'VALIDATION_ERROR', parsed.error, 'body');

  const event = await eventService.createEvent(parsed.data);
  res.status(201).json(dataEnvelope(event));
}));

router.patch('/:id', asyncHandler(async (req, res) => {
  const parsed = eventUpdateSchema.safeParse(req.body);
  if (!parsed.success) throw validationFailure(422, 'VALIDATION_ERROR', parsed.error, 'body');

  const event = await eventService.updateEvent(req.params.id, parsed.data);
  res.json(dataEnvelope(event));
}));

router.delete('/:id', asyncHandler(async (req, res) => {
  await eventService.deleteEvent(req.params.id);
  res.json(dataEnvelope(null));
}));

export default router;