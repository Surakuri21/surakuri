import { describe, expect, it } from "vitest";
import { createEnvelope } from "./outbox.js";
import { createSupabaseOutboxSink } from "./supabase.js";

interface Call {
  op: string;
  arg?: unknown;
}

function fakeDb(result: { data: unknown; error: { message: string } | null }) {
  const calls: Call[] = [];
  const chain: Record<string, unknown> = {};
  for (const op of [
    "from",
    "select",
    "eq",
    "lte",
    "is",
    "order",
    "limit",
    "insert",
    "update",
    "delete",
  ]) {
    chain[op] = (...args: unknown[]) => {
      calls.push({ op, arg: args.length === 1 ? args[0] : args });
      return chain;
    };
  }
  chain["then"] = (resolve: (value: unknown) => unknown) =>
    resolve(result);
  return { calls, client: chain };
}

const AGGREGATE = "0195a0b0-0000-7000-8000-000000000001";

describe("supabase outbox sink", () => {
  it("publishes envelopes as snake_case rows", async () => {
    const db = fakeDb({ data: null, error: null });
    const sink = createSupabaseOutboxSink(db.client as never);
    const event = createEnvelope({
      type: "order.placed",
      aggregateId: AGGREGATE,
      correlationId: "req-1",
      payload: { totalMinor: 1_250_000 },
    });
    await sink.publish(event);
    expect(db.calls.find((call) => call.op === "insert")?.arg).toMatchObject({
      event_id: event.eventId,
      type: "order.placed",
      causation_id: null,
    });
  });

  it("lists due events unclaimed-first and maps envelopes", async () => {
    const row = {
      event_id: "0195a0b0-0000-7000-8000-000000000009",
      type: "order.placed",
      aggregate_id: AGGREGATE,
      correlation_id: "req-1",
      causation_id: null,
      occurred_at: "2026-10-07T12:00:00Z",
      payload: {},
      claimed_at: null,
      attempts: 0,
    };
    const db = fakeDb({ data: [row], error: null });
    const due = await createSupabaseOutboxSink(db.client as never).listDue(
      "2026-10-07T13:00:00Z",
      10,
    );
    expect(db.calls).toContainEqual({ op: "is", arg: ["claimed_at", null] });
    expect(due).toHaveLength(1);
    expect(due[0]?.envelope.type).toBe("order.placed");
  });

  it("claims and completes events, surfacing failures", async () => {
    const db = fakeDb({ data: null, error: null });
    const sink = createSupabaseOutboxSink(db.client as never);
    await sink.markClaimed("e1", 1, "2026-10-07T13:00:00Z");
    expect(db.calls.find((call) => call.op === "update")?.arg).toMatchObject({
      claimed_at: "2026-10-07T13:00:00Z",
      attempts: 1,
    });
    await sink.markDone("e1");
    expect(db.calls.some((call) => call.op === "delete")).toBe(true);

    const failing = fakeDb({ data: null, error: { message: "db down" } });
    await expect(
      createSupabaseOutboxSink(failing.client as never).publish(
        createEnvelope({
          type: "order.placed",
          aggregateId: AGGREGATE,
          correlationId: "req-1",
        }),
      ),
    ).rejects.toThrowError(/outbox publish failed/);
  });
});
