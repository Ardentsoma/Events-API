// Central config. The rate limit number lives here so middleware never
// hardcodes it.
export const config = {
  port: Number(process.env.PORT ?? 3000),
  rateLimit: {
    windowMs: 60_000, // 1 minute
    max: Number(process.env.RATE_LIMIT_MAX ?? 100), // 100 requests per minute per IP
  },
} as const;