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
    findByKey: (key) => byKey.get(key),
    getById: (id) => byId.get(id),
    listActive: (nowIso) =>
      [...byId.values()].filter(
        (record) => record.state === "active" && record.expiresAt > nowIso,
      ),
    listAged: (nowIso) =>
      [...byId.values()].filter(
        (record) => record.state === "active" && record.expiresAt <= nowIso,
      ),
    insert: (record) => {
      byId.set(record.id, record);
      byKey.set(record.idempotencyKey, record);
    },
    update: (record) => {
      byId.set(record.id, record);
      byKey.set(record.idempotencyKey, record);
    },
  };
}
