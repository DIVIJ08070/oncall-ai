import type pg from 'pg';
import type { Daos } from '../dao/types.js';
import { PgCustomersDao } from './dao/customers.js';
import { PgUsersDao } from './dao/users.js';
import { PgServicesDao } from './dao/services.js';
import { PgLogEventsDao } from './dao/log-events.js';
import { PgMetricSamplesDao } from './dao/metric-samples.js';
import { PgIncidentsDao } from './dao/incidents.js';
import { PgInvestigationSessionsDao } from './dao/investigation-sessions.js';
import { PgInvestigationStepsDao } from './dao/investigation-steps.js';
import { PgDeploysDao } from './dao/deploys.js';
import { PgPullRequestsDao } from './dao/pull-requests.js';
import { PgChatMessagesDao } from './dao/chat-messages.js';
import { PgNotificationsDao } from './dao/notifications.js';
import { PgRepoLearningsDao } from './dao/repo-learnings.js';

/**
 * PostgreSQL driver entry point (DB_DRIVER=postgres). Implements the same
 * async DAO contract as the sqlite driver (`dao/types.ts`) on one shared
 * `pg.Pool`.
 */

export * from './pool.js';
export * from './migrate.js';
export * from './dao/customers.js';
export * from './dao/users.js';
export * from './dao/services.js';
export * from './dao/log-events.js';
export * from './dao/metric-samples.js';
export * from './dao/incidents.js';
export * from './dao/investigation-sessions.js';
export * from './dao/investigation-steps.js';
export * from './dao/deploys.js';
export * from './dao/pull-requests.js';
export * from './dao/chat-messages.js';
export * from './dao/notifications.js';
export * from './dao/repo-learnings.js';

/** Construct the postgres DAO set bound to the single shared pool. */
export function createPgDaos(pool: pg.Pool): Daos {
  return {
    customers: new PgCustomersDao(pool),
    users: new PgUsersDao(pool),
    services: new PgServicesDao(pool),
    logEvents: new PgLogEventsDao(pool),
    metricSamples: new PgMetricSamplesDao(pool),
    incidents: new PgIncidentsDao(pool),
    sessions: new PgInvestigationSessionsDao(pool),
    steps: new PgInvestigationStepsDao(pool),
    deploys: new PgDeploysDao(pool),
    pullRequests: new PgPullRequestsDao(pool),
    chatMessages: new PgChatMessagesDao(pool),
    notifications: new PgNotificationsDao(pool),
    repoLearnings: new PgRepoLearningsDao(pool),
  };
}
