#!/usr/bin/env node

import assert from "node:assert/strict";
import {
  createProtocolResponse,
  normalizeProtocolRequest,
  PROTOCOL_VERSION,
} from "../src/core/protocol.mjs";

const legacy = normalizeProtocolRequest({ id: "legacy", type: "meeting.start", payload: {} });
assert.equal(legacy.protocolVersion, PROTOCOL_VERSION);
assert.equal(legacy.requestId, "legacy");
assert.equal(legacy.type, "session.start");
assert.equal(
  normalizeProtocolRequest({ id: "legacy-mic", type: "meet.mic.toggle" }).type,
  "participant.mic.toggle",
);

const current = normalizeProtocolRequest({
  protocolVersion: PROTOCOL_VERSION,
  requestId: "current",
  type: "session.status.get",
  extra: "ignored",
});
assert.equal(current.type, "session.status.get");
assert.deepEqual(
  createProtocolResponse(current, { data: { ready: true } }),
  {
    protocolVersion: 1,
    requestId: "current",
    id: "current",
    ok: true,
    data: { ready: true },
  },
);

assert.throws(
  () => normalizeProtocolRequest({ protocolVersion: 2, requestId: "future", type: "ping" }),
  (error) => error.code === "PROTOCOL_VERSION_UNSUPPORTED",
);
assert.throws(
  () => normalizeProtocolRequest({ protocolVersion: 1, requestId: 42, type: "ping" }),
  (error) => error.code === "INVALID_REQUEST_ID",
);

process.stdout.write("Versioned protocol compatibility passed.\n");
