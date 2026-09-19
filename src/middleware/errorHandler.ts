// Error envelope + centralized error handling.
import { NextFunction, Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import { ZodError } from 'zod';

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

// Captures validation failures as a 400 (bad query input) or a 422 (bad
// request body), always naming the offending field.
export function validationFailure(
  status: 400 | 422,
  code: string,
  error: ZodError,
  label: string,
): ApiError {
  const issues = error.issues;
  let field = issues[0]?.path.join('.') || '(root)';
  // z.strict() reports unknown keys with an empty path; surface the actual key.
  const unrecognised = issues[0]?.message.match(/Unrecognized key\(s\) in object: '([^']+)'/);
  if (unrecognised && field === '(root)') field = unrecognised[1];
  const message = issues[0]
    ? `Invalid ${label} field '${field}': ${issues[0].message}`
    : `Invalid ${label}`;
  return new ApiError(status, code, message);
}

function prismaErrorMessage(e: Prisma.PrismaClientKnownRequestError): ApiError {
  switch (e.code) {
    case 'P2025':
      return new ApiError(404, 'NOT_FOUND', 'Record not found');
    case 'P2003':
      return new ApiError(
        422,
        'RELATED_RECORD_MISSING',
        'A related record does not exist (e.g. venueId or eventId)',
      );
    case 'P2002':
      return new ApiError(422, 'CONFLICT', 'A record with the same stable identifier already exists');
    default:
      return new ApiError(500, 'INTERNAL_ERROR', 'Something went wrong');
  }
}

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof ApiError) {
    res.status(err.status).json({ error: { code: err.code, message: err.message } });
    return;
  }
  if (err instanceof ZodError) {
    const api = validationFailure(422, 'VALIDATION_ERROR', err, 'body');
    res.status(api.status).json({ error: { code: api.code, message: api.message } });
    return;
  }
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    const api = prismaErrorMessage(err);
    res.status(api.status).json({ error: { code: api.code, message: api.message } });
    return;
  }
  if (err instanceof SyntaxError && 'body' in err) {
    res.status(400).json({ error: { code: 'INVALID_JSON', message: 'Malformed JSON body' } });
    return;
  }
  console.error('Unhandled error:', err);
  res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Something went wrong' } });
}

// Catch-all for unmatched routes so errors keep the envelope shape.
export function notFound(_req: Request, res: Response): void {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: 'No such endpoint' } });
}