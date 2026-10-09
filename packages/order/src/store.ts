/**
 * Single-process dev store. Same warning as the reservation dev
 * store: lost on restart, uncoordinated across instances.
 */

import type { OrderRecord, OrderStore } from "./order.js";

export function createMemoryOrderStore(): OrderStore {
  const byId = new Map<string, OrderRecord>();
  const byKey = new Map<string, OrderRecord>();
  return {
    findByKey: (key) => Promise.resolve(byKey.get(key)),
    getById: (id) => Promise.resolve(byId.get(id)),
    listStalePending: (cutoffIso) =>
      Promise.resolve(
        [...byId.values()].filter(
          (record) =>
            record.state === "pending_payment" && record.createdAt <= cutoffIso,
        ),
      ),
    insert: (record) => {
      byId.set(record.id, record);
      byKey.set(record.idempotencyKey, record);
      return Promise.resolve();
    },
    update: (record) => {
      byId.set(record.id, record);
      byKey.set(record.idempotencyKey, record);
      return Promise.resolve();
    },
  };
}
