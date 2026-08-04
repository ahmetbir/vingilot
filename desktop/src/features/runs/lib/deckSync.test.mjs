import assert from "node:assert/strict";
import http from "node:http";
import { test } from "node:test";
import { syncPins } from "./deckSync.ts";

function startServer(handler) {
  const server = http.createServer(handler);
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({ server, baseUrl: `http://127.0.0.1:${port}` });
    });
  });
}

function closeServer(server) {
  return new Promise((resolve) => server.close(resolve));
}

function readBody(req) {
  return new Promise((resolve) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
    });
    req.on("end", () => resolve(raw === "" ? undefined : JSON.parse(raw)));
  });
}

const PIN_A = { id: "run-a", kind: "run", pinnedAt: "2026-08-01T00:00:00Z" };
const PIN_B = { id: "run-b", kind: "run", pinnedAt: "2026-08-02T00:00:00Z" };

test("syncPins: a successful write returns the new revision and pins", async () => {
  const requests = [];
  const { server, baseUrl } = await startServer(async (req, res) => {
    requests.push({
      method: req.method,
      url: req.url,
      body: await readBody(req),
    });
    if (req.method === "GET") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          revision: 3,
          state_hash: "base-hash",
          state: { deck: { pins: [PIN_A] } },
        }),
      );
      return;
    }
    // POST mutations
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({ accepted: true, revision: 4, state_hash: "next-hash" }),
    );
  });
  try {
    const result = await syncPins("ws-1", (current) => [...current, PIN_B], {
      baseUrl,
    });
    assert.equal(result.kind, "ok");
    assert.equal(result.revision, 4);
    assert.deepEqual(result.pins, [PIN_A, PIN_B]);

    // request body carries expected_revision verbatim — the bug this plan
    // exists to prevent is a write that omits it.
    const postReq = requests.find((r) => r.method === "POST");
    assert.equal(postReq.body.expected_revision, 3);
    assert.deepEqual(postReq.body.mutations, [
      { deck: { pins: [PIN_A, PIN_B] } },
    ]);
  } finally {
    await closeServer(server);
  }
});

test("syncPins: a 409 returns a conflict result (via a follow-up GET) without throwing and without retrying", async () => {
  let getCount = 0;
  let postCount = 0;
  const PIN_C = { id: "run-c", kind: "run", pinnedAt: "2026-08-03T00:00:00Z" };
  const { server, baseUrl } = await startServer(async (req, res) => {
    if (req.method === "GET") {
      getCount += 1;
      if (getCount === 1) {
        // Initial read, before the write attempt.
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            revision: 3,
            state_hash: "base-hash",
            state: { deck: { pins: [PIN_A] } },
          }),
        );
        return;
      }
      // Follow-up read after the conflict — another device won the race.
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          revision: 5,
          state_hash: "their-hash",
          state: { deck: { pins: [PIN_A, PIN_C] } },
        }),
      );
      return;
    }
    // POST mutations — always rejected, and this handler asserts it is
    // called at most once (no blind retry).
    postCount += 1;
    const body = await readBody(req);
    // Even on the losing write, the request body must still carry
    // expected_revision verbatim — the bug this plan exists to prevent.
    assert.equal(body.expected_revision, 3);
    res.writeHead(409, { "content-type": "application/json" });
    res.end(
      JSON.stringify({ accepted: false, revision: 4, state_hash: "stale" }),
    );
  });
  try {
    const result = await syncPins("ws-1", (current) => [...current, PIN_B], {
      baseUrl,
    });
    assert.equal(result.kind, "conflict");
    assert.equal(result.revision, 5);
    assert.equal(result.stateHash, "their-hash");
    assert.deepEqual(result.theirs, [PIN_A, PIN_C]);
    assert.equal(postCount, 1);
    assert.equal(getCount, 2);
  } finally {
    await closeServer(server);
  }
});

test("syncPins: a network failure maps to unreachable", async () => {
  const result = await syncPins("ws-1", (current) => current, {
    baseUrl: "http://127.0.0.1:1",
  });
  assert.equal(result.kind, "unreachable");
});
