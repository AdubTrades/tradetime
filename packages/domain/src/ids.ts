import { monotonicFactory } from 'ulid';

// Monotonic: ids created in the same millisecond still sort in creation order,
// which keeps audit history in order when two entries share a timestamp.
const ulid = monotonicFactory();

/** Time-sortable unique id used as the primary key on every table. */
export const newId = (): string => ulid();
