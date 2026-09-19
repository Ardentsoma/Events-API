import { Router } from 'express';
import { asyncHandler } from '../middleware/asyncHandler';
import { validationFailure } from '../middleware/errorHandler';
import { ticketCreateSchema, ticketUpdateSchema } from '../schemas/ticketSchemas';
import { dataEnvelope } from '../utils/envelope';
import * as ticketService from '../services/ticketService';

const router = Router();

router.post('/', asyncHandler(async (req, res) => {
  const parsed = ticketCreateSchema.safeParse(req.body);
  if (!parsed.success) throw validationFailure(422, 'VALIDATION_ERROR', parsed.error, 'body');

  const ticket = await ticketService.createTicket(parsed.data);
  res.status(201).json(dataEnvelope(ticket));
}));

router.get('/:id', asyncHandler(async (req, res) => {
  const ticket = await ticketService.getTicket(req.params.id);
  res.json(dataEnvelope(ticket));
}));

router.patch('/:id', asyncHandler(async (req, res) => {
  const parsed = ticketUpdateSchema.safeParse(req.body);
  if (!parsed.success) throw validationFailure(422, 'VALIDATION_ERROR', parsed.error, 'body');

  const ticket = await ticketService.updateTicketStatus(req.params.id, parsed.data.status);
  res.json(dataEnvelope(ticket));
}));

export default router;