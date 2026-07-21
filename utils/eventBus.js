/**
 * Event bus interface for emitting import lifecycle events.
 *
 * Replaces the old `#utils/outbox` and `#events/events` imports from
 * OfferBerries. The OfferBerries implementation uses an outbox pattern
 * (queueOutboxEvent + EVENT_TYPES); the generic engine just logs events.
 *
 * @typedef {Object} EventBus
 * @property {(eventType: string, payload: object) => Promise<void>} emit
 */

const EVENT_TYPES = {
  MIGRATION_IMPORT_COMPLETED: "MIGRATION_IMPORT_COMPLETED",
};

/**
 * Default no-op EventBus — logs events to console instead of emitting.
 *
 * @type {EventBus}
 */
export const consoleEventBus = {
  async emit(eventType, payload) {
    console.log(`[event] ${eventType}`, JSON.stringify(payload));
  },
};

export { EVENT_TYPES };
