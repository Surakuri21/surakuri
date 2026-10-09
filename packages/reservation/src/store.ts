/**
 * Single-process dev store. Loses everything on restart and cannot
 * coordinate across instances — production uses Postgres (the guard
 * logic above is unchanged; only this class is replaced).
 */

import type {
  ReservationRecord,
  ReservationStore,
} from "./reservation.js";

export function createMemoryStore(): ReservationStore {
  const byId = new Map<string, ReservationRecord>();
  const byKey = new Map<string, ReservationRecord>();
  return {
    findByKey: (key) => Promise.resolve(byKey.get(key)),
    getById: (id) => Promise.resolve(byId.get(id)),
    listActive: (nowIso) =>
      Promise.resolve(
        [...byId.values()].filter(
          (record) => record.state === "active" && record.expiresAt > nowIso,
        ),
      ),
    listAged: (nowIso) =>
      Promise.resolve(
        [...byId.values()].filter(
          (record) => record.state === "active" && record.expiresAt <= nowIso,
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
