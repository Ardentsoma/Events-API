import { createId } from '@paralleldrive/cuid2';

// Every primary key created at runtime uses cuid2 (non-sequential, collision
// resistant). Never auto-increment.
export function newId(): string {
  return createId();
}