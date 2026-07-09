import type BetterSqlite3 from 'better-sqlite3';
import { CustomersDao } from './customers.js';
import { UsersDao } from './users.js';
import { ServicesDao } from './services.js';
import { LogEventsDao } from './log-events.js';
import { MetricSamplesDao } from './metric-samples.js';
import { IncidentsDao } from './incidents.js';
import { InvestigationSessionsDao } from './investigation-sessions.js';
import { InvestigationStepsDao } from './investigation-steps.js';
import { DeploysDao } from './deploys.js';
import { PullRequestsDao } from './pull-requests.js';
import { ChatMessagesDao } from './chat-messages.js';
import { NotificationsDao } from './notifications.js';

export * from './customers.js';
export * from './users.js';
export * from './services.js';
export * from './log-events.js';
export * from './metric-samples.js';
export * from './incidents.js';
export * from './investigation-sessions.js';
export * from './investigation-steps.js';
export * from './deploys.js';
export * from './pull-requests.js';
export * from './chat-messages.js';
export * from './notifications.js';

/** All 12 typed DAOs, one per table (SPEC §8). */
export interface Daos {
  customers: CustomersDao;
  users: UsersDao;
  services: ServicesDao;
  logEvents: LogEventsDao;
  metricSamples: MetricSamplesDao;
  incidents: IncidentsDao;
  sessions: InvestigationSessionsDao;
  steps: InvestigationStepsDao;
  deploys: DeploysDao;
  pullRequests: PullRequestsDao;
  chatMessages: ChatMessagesDao;
  notifications: NotificationsDao;
}

/** Construct the DAO set bound to a single connection. */
export function createDaos(db: BetterSqlite3.Database): Daos {
  return {
    customers: new CustomersDao(db),
    users: new UsersDao(db),
    services: new ServicesDao(db),
    logEvents: new LogEventsDao(db),
    metricSamples: new MetricSamplesDao(db),
    incidents: new IncidentsDao(db),
    sessions: new InvestigationSessionsDao(db),
    steps: new InvestigationStepsDao(db),
    deploys: new DeploysDao(db),
    pullRequests: new PullRequestsDao(db),
    chatMessages: new ChatMessagesDao(db),
    notifications: new NotificationsDao(db),
  };
}
