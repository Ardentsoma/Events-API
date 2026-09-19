import path from 'path';
import express from 'express';
import { errorHandler, notFound } from './middleware/errorHandler';
import { rateLimiter } from './middleware/rateLimiter';
import venueRoutes from './routes/venueRoutes';
import eventRoutes from './routes/eventRoutes';
import ticketRoutes from './routes/ticketRoutes';

export function createApp() {
  const app = express();

  app.use(express.json());
  app.use(express.static(path.join(process.cwd(), 'public')));
  app.use('/api/v1', rateLimiter);

  app.use('/api/v1/venues', venueRoutes);
  app.use('/api/v1/events', eventRoutes);
  app.use('/api/v1/tickets', ticketRoutes);

  app.use(notFound);
  app.use(errorHandler);
  return app;
}