import { describe, expect, it } from "vitest";
import {
  cancelReservation,
  commitReservation,
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
  it("accumulates holds and rejects oversell", async () => {
    const store = createMemoryStore();
    await reserve(store, hold("k1", 1), 2, T0);
    await reserve(store, hold("k2", 1), 2, T0);
    try {
      await reserve(store, hold("k3", 1), 2, T0);
      expect.unreachable("third unit must not hold against stock of 2");
    } catch (error) {
      expect(error).toBeInstanceOf(ReservationError);
      expect((error as ReservationError).code).toBe("insufficient-stock");
    }
  });

  it("replays idempotency keys without double-holding", async () => {
    const store = createMemoryStore();
    const first = await reserve(store, hold("k1", 2), 2, T0);
    const replay = await reserve(store, hold("k1", 2), 2, T0);
    expect(replay.id).toBe(first.id);
    // Stock is now fully held by the single replayed hold.
    await expect(reserve(store, hold("k2", 1), 2, T0)).rejects.toThrowError(
      ReservationError,
    );
  });

  it("rejects key reuse with a different payload", async () => {
    const store = createMemoryStore();
    await reserve(store, hold("k1", 1), 5, T0);
    await expect(reserve(store, hold("k1", 2), 5, T0)).rejects.toThrowError(
      expect.objectContaining({ code: "conflict" }),
    );
  });

  it("expires holds via the sweeper and frees the stock", async () => {
    const store = createMemoryStore();
    await reserve(store, hold("k1", 2), 2, T0, 15);
    const later = new Date(T0.getTime() + 16 * 60_000);
    expect(await sweep(store, later)).toBe(1);
    // Expired hold no longer counts: full stock is reservable again.
    const fresh = await reserve(store, hold("k2", 2), 2, later);
    expect(fresh.state).toBe("active");
  });

  it("extends heartbeats but never past 30 minutes from creation", async () => {
    const store = createMemoryStore();
    const first = await reserve(store, hold("k1", 1), 5, T0, 15);
    const atTen = new Date(T0.getTime() + 10 * 60_000);
    const extended = await heartbeat(store, first.id, atTen);
    expect(Date.parse(extended.expiresAt)).toBe(
      Date.parse(first.createdAt) + 25 * 60_000,
    );
    // A later heartbeat hits the 30-minute-from-creation cap.
    const atTwenty = new Date(T0.getTime() + 20 * 60_000);
    const capped = await heartbeat(store, first.id, atTwenty);
    expect(Date.parse(capped.expiresAt)).toBe(
      Date.parse(first.createdAt) + 30 * 60_000,
    );
    await expect(
      heartbeat(store, first.id, new Date(T0.getTime() + 31 * 60_000)),
    ).rejects.toThrowError(
      expect.objectContaining({ code: "already-settled" }),
    );
  });

  it("cancels live holds and frees the stock", async () => {
    const store = createMemoryStore();
    const first = await reserve(store, hold("k1", 1), 1, T0);
    expect((await cancelReservation(store, first.id, T0)).state).toBe(
      "cancelled",
    );
    expect((await reserve(store, hold("k2", 1), 1, T0)).state).toBe("active");
  });

  it("commits live holds permanently out of the pool", async () => {
    const store = createMemoryStore();
    const first = await reserve(store, hold("k1", 1), 1, T0);
    expect((await commitReservation(store, first.id, T0)).state).toBe(
      "committed",
    );
    // The committed hold is settled: heartbeat, cancel, and re-commit
    // all refuse it, and the sweeper leaves it alone.
    await expect(heartbeat(store, first.id, T0)).rejects.toThrowError(
      expect.objectContaining({ code: "already-settled" }),
    );
    await expect(cancelReservation(store, first.id, T0)).rejects.toThrowError(
      expect.objectContaining({ code: "already-settled" }),
    );
    await expect(commitReservation(store, first.id, T0)).rejects.toThrowError(
      expect.objectContaining({ code: "already-settled" }),
    );
    expect(await sweep(store, new Date(T0.getTime() + 60 * 60_000))).toBe(0);
    // Once the IMS reflects the sale, no fresh hold can take the unit.
    await expect(reserve(store, hold("k2", 1), 0, T0)).rejects.toThrowError(
      expect.objectContaining({ code: "insufficient-stock" }),
    );
  });
});
