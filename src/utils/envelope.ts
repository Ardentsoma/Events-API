// Response envelope helpers.
type Meta = { total: number; limit: number; offset: number; hasMore: boolean };

export function dataEnvelope(data: unknown, meta?: Meta) {
  return meta === undefined ? { data } : { data, meta };
}