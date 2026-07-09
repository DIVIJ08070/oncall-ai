/**
 * SSE broker seam (SPEC §3 `sse/` — "per-topic subscriber registry").
 *
 * A minimal in-process pub/sub used as a *seam*: the ingest path publishes to
 * `logs/<service>` (SPEC §7.1 side effect) today, and C10 wires the read-side
 * SSE endpoints (`GET /logs/stream`, investigation feed, chat) onto the same
 * broker. Kept intentionally small and synchronous — a publish must never throw
 * into or block the caller (the ingest hot path).
 */

/** A published frame: `event` name + JSON-serializable `data` (SPEC §7 SSE frame). */
export interface BrokerMessage {
  event: string;
  data: unknown;
}

export type Subscriber = (message: BrokerMessage) => void;

export interface Broker {
  /** Fan a message out to all subscribers of `topic`. Never throws. */
  publish(topic: string, message: BrokerMessage): void;
  /** Register a subscriber; returns an idempotent unsubscribe function. */
  subscribe(topic: string, subscriber: Subscriber): () => void;
  /** Live subscriber count for a topic (0 if none). */
  subscriberCount(topic: string): number;
  /** Topics with at least one subscriber. */
  topics(): string[];
}

/** SSE topic for a service's log stream (SPEC §7.1 / §7.2b). */
export function logsTopic(service: string): string {
  return `logs/${service}`;
}

/** SSE topic for an incident's investigation feed (SPEC §7.3; used by C10). */
export function feedTopic(incidentId: string): string {
  return `feed/${incidentId}`;
}

/** Construct a fresh in-memory broker. */
export function createBroker(): Broker {
  const topics = new Map<string, Set<Subscriber>>();

  return {
    publish(topic, message) {
      const subs = topics.get(topic);
      if (!subs || subs.size === 0) return;
      for (const sub of subs) {
        try {
          sub(message);
        } catch {
          // A faulty subscriber must never break the publisher (ingest path).
        }
      }
    },

    subscribe(topic, subscriber) {
      let subs = topics.get(topic);
      if (!subs) {
        subs = new Set();
        topics.set(topic, subs);
      }
      subs.add(subscriber);
      let active = true;
      return () => {
        if (!active) return;
        active = false;
        const set = topics.get(topic);
        if (!set) return;
        set.delete(subscriber);
        if (set.size === 0) topics.delete(topic);
      };
    },

    subscriberCount(topic) {
      return topics.get(topic)?.size ?? 0;
    },

    topics() {
      return [...topics.keys()];
    },
  };
}
