// Shared pagination query parameter schema. Every list endpoint accepts these
// and clamps/rejects per the API contract:
//  - limit:  default 20, clamped to a max of 100 (values above 100 clamp;
//    values below 1 are rejected)
//  - offset: default 0, negative values rejected with 400
//  - sort:   must be one of the allowed fields for the resource
//  - order:  asc | desc, default asc
import { z } from 'zod';

const limit = z.coerce
  .number()
  .int('limit must be an integer')
  .min(1, 'limit must be a positive integer')
  .default(20)
  .transform((value) => Math.min(value, 100));

const offset = z.coerce
  .number()
  .int('offset must be an integer')
  .min(0, 'offset must be zero or a positive integer')
  .default(0);

const order = z.enum(['asc', 'desc']).default('asc');

export function sortField(allowed: readonly string[], defaultField: string) {
  return z
    .enum(allowed as [string, ...string[]], {
      errorMap: () => ({ message: `sort must be one of: ${allowed.join(', ')}` }),
    })
    .default(defaultField);
}

export function paginationSchema(allowedSorts: readonly string[], defaultSort: string) {
  return z.object({
    limit,
    offset,
    sort: sortField(allowedSorts, defaultSort),
    order,
  });
}