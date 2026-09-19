// In-memory rate limiting: 100 requests / minute / IP (values from config).
// No Redis — express-rate-limit's default MemoryStore is used.
import { rateLimit } from 'express-rate-limit';
import { config } from '../config';

export const rateLimiter = rateLimit({
  windowMs: config.rateLimit.windowMs,
  limit: config.rateLimit.max,
  standardHeaders: 'draft-7', // sends RateLimit + Retry-After headers
  legacyHeaders: false,
  handler: (_req, res) => {
    res.status(429).json({
      error: {
        code: 'RATE_LIMITED',
        message: 'Too many requests, please try again later',
      },
    });
  },
});