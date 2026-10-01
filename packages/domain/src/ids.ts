import { ulid } from 'ulid';

/** Time-sortable unique id used as the primary key on every table. */
export const newId = (): string => ulid();
