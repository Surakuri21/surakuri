import { describe, expect, it } from "vitest";
import {
  cancelReservation,
  createMemoryStore,
  heartbeat,
  reserve,
  sweep,
  ReservationError,
} from "./index.js";

const CUSTOMER = "0195a0b0-0000-7000-8000-000000000001";
const T0 = new Date("2026-10-06T12:00:00Z");

function hold(key: string, quantity = 1, slug = "daytona-116500ln") {
  return { customerId: CUSTOMER, slug, quantity, idempotencyKey: key };
}

describe("reservation holds", () => {
  it("accumulates holds and rejects oversell", () => {
    const store = createMemoryStore();
    reserve(store, hold("k1", 1), 2, T0);
    reserve(store, hold("k2", 1), 2, T0);
    try {
      reserve(store, hold("k3", 1), 2, T0);
      expect.unreachable("third unit must not hold against stock of 2");
    } catch (error) {
      expect(error).toBeInstanceOf(ReservationError);
      expect((error as ReservationError).code).toBe("insufficient-stock");
    }
  });

  it("replays idempotency keys without double-holding", () => {
    const store = createMemoryStore();
    const first = reserve(store, hold("k1", 2), 2, T0);
    const replay = reserve(store, hold("k1", 2), 2, T0);
    expect(replay.id).toBe(first.id);
    // Stock is now fully held by the single replayed hold.
    expect(() =>
      reserve(store, hold("k2", 1), 2, T0),
    ).toThrowError(ReservationError);
  });

  it("rejects key reuse with a different payload", () => {
    const store = createMemoryStore();
    reserve(store, hold("k1", 1), 5, T0);
    expect(() => reserve(store, hold("k1", 2), 5, T0)).toThrowError(
      expect.objectContaining({ code: "conflict" }),
    );
  });

  it("expires holds via the sweeper and frees the stock", () => {
    const store = createMemoryStore();
    reserve(store, hold("k1", 2), 2, T0, 15);
    const later = new Date(T0.getTime() + 16 * 60_000);
    expect(sweep(store, later)).toBe(1);
    // Expired hold no longer counts: full stock is reservable again.
    const fresh = reserve(store, hold("k2", 2), 2, later);
    expect(fresh.state).toBe("active");
  });

  it("extends heartbeats but never past 30 minutes from creation", () => {
    const store = createMemoryStore();
    const first = reserve(store, hold("k1", 1), 5, T0, 15);
    const atTen = new Date(T0.getTime() + 10 * 60_000);
    const extended = heartbeat(store, first.id, atTen);
    expect(Date.parse(extended.expiresAt)).toBe(
      Date.parse(first.createdAt) + 25 * 60_000,
    );
    // A later heartbeat hits the 30-minute-from-creation cap.
    const atTwenty = new Date(T0.getTime() + 20 * 60_000);
    const capped = heartbeat(store, first.id, atTwenty);
    expect(Date.parse(capped.expiresAt)).toBe(
      Date.parse(first.createdAt) + 30 * 60_000,
    );
    expect(() => heartbeat(store, first.id, new Date(T0.getTime() + 31 * 60_000))).toThrowError(
      expect.objectContaining({ code: "already-settled" }),
    );
  });

  it("cancels live holds and frees the stock", () => {
    const store = createMemoryStore();
    const first = reserve(store, hold("k1", 1), 1, T0);
    expect(cancelReservation(store, first.id, T0).state).toBe("cancelled");
    expect(reserve(store, hold("k2", 1), 1, T0).state).toBe("active");
  });
});
