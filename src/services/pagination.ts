// Shapes a validated pagination/query object, so routes stay thin.

export type Order = 'asc' | 'desc';

export interface PaginationInput {
  limit: number;
  offset: number;
  sort: string;
  order: Order;
}

export function orderBy(sort: string, order: Order): Record<string, Order> {
  return { [sort]: order };
}

export function meta(total: number, limit: number, offset: number) {
  return { total, limit, offset, hasMore: offset + limit < total };
}