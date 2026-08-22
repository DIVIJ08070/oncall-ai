/**
 * DAO layer barrel — the shared async DAO contract (`types.ts`) is the single
 * source of truth; the PostgreSQL implementations live in `../pg/dao/`.
 */
export * from './types.js';
