import { describe, expect, it } from "vitest";
import {
  claimDue,
  createEnvelope,
  OutboxEnvelopeSchema,
} from "./index.js";
import type { OutboxRecord } from "./index.js";

const AGGREGATE = "0195a0b0-0000-7000-8000-000000000001";

function record(occurredAt: string, claimedAt: string | null): OutboxRecord {
  return {
    envelope: {
      ...createEnvelope({
        type: "order.placed",
        aggregateId: AGGREGATE,
        correlationId: "req-1",
      }),
      occurredAt,
    },
    claimedAt,
    attempts: 0,
  };
}

describe("worker outbox", () => {
  it("creates schema-valid envelopes with causation chains", () => {
    const envelope = createEnvelope({
      type: "order.placed",
      aggregateId: AGGREGATE,
      correlationId: "req-1",
      causationId: AGGREGATE,
      payload: { total_minor: 1_250_000 },
    });
    expect(OutboxEnvelopeSchema.safeParse(envelope).success).toBe(true);
    expect(OutboxEnvelopeSchema.safeParse({ ...envelope, extra: 1 }).success).toBe(
      false,
    );
  });

  it("claims due rows oldest-first, skipping claimed ones", () => {
    const now = new Date("2026-10-06T12:00:00Z");
    const rows = [
      record("2026-10-06T11:00:00Z", null),
      record("2026-10-06T10:00:00Z", null),
      record("2026-10-06T09:00:00Z", "2026-10-06T09:30:00Z"),
      record("2026-10-06T13:00:00Z", null),
    ];
    const claimed = claimDue(rows, now, 10);
    expect(claimed).toHaveLength(2);
    expect(claimed[0]?.envelope.occurredAt).toBe("2026-10-06T10:00:00Z");
    expect(claimDue(rows, now, 1)).toHaveLength(1);
  });
});
