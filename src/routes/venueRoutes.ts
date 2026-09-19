import { Router } from 'express';
import { asyncHandler } from '../middleware/asyncHandler';
import { validationFailure } from '../middleware/errorHandler';
import { venueQuerySchema } from '../schemas/venueSchemas';
import { nestedEventQuerySchema } from '../schemas/eventSchemas';
import * as venueService from '../services/venueService';
import * as eventService from '../services/eventService';
import { dataEnvelope } from '../utils/envelope';

const router = Router();

router.get('/', asyncHandler(async (req, res) => {
  const parsed = venueQuerySchema.safeParse(req.query);
  if (!parsed.success) throw validationFailure(400, 'INVALID_QUERY_PARAMS', parsed.error, 'query');

  const { rows, meta } = await venueService.listVenues(parsed.data);
  res.json(dataEnvelope(rows, meta));
}));

router.get('/:id', asyncHandler(async (req, res) => {
  const venue = await venueService.getVenue(req.params.id);
  res.json(dataEnvelope(venue));
}));

router.get('/:id/events', asyncHandler(async (req, res) => {
  const parsed = nestedEventQuerySchema.safeParse(req.query);
  if (!parsed.success) throw validationFailure(400, 'INVALID_QUERY_PARAMS', parsed.error, 'query');

  await venueService.getVenue(req.params.id); // 404 if the venue is unknown

  const { rows, meta } = await eventService.listEvents({
    ...parsed.data,
    venueId: req.params.id,
  });
  res.json(dataEnvelope(rows, meta));
}));

export default router;