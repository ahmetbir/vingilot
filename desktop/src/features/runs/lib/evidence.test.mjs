import assert from "node:assert/strict";
import http from "node:http";
import { test } from "node:test";
import { listEvidence } from "./coordinatorClient.ts";
import { EVIDENCE_DISPLAY_CAP, evidenceView } from "./runModel.ts";

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

function row(overrides) {
  return {
    seq: 1,
    kind: "note",
    content: "hi",
    created_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

test("evidenceView orders rows by seq ascending (oldest first, newest last)", () => {
  const rows = [row({ seq: 3 }), row({ seq: 1 }), row({ seq: 2 })];
  const { rows: ordered, truncatedCount } = evidenceView(rows);
  assert.deepEqual(
    ordered.map((r) => r.seq),
    [1, 2, 3],
  );
  assert.equal(truncatedCount, 0);
});

test("evidenceView tags every kind through untouched", () => {
  const rows = [
    row({ seq: 1, kind: "command" }),
    row({ seq: 2, kind: "output" }),
    row({ seq: 3, kind: "error" }),
    row({ seq: 4, kind: "note" }),
  ];
  const { rows: ordered } = evidenceView(rows);
  assert.deepEqual(
    ordered.map((r) => r.kind),
    ["command", "output", "error", "note"],
  );
});

test("evidenceView caps display at 200 rows and reports the truncated count", () => {
  const rows = Array.from({ length: EVIDENCE_DISPLAY_CAP + 7 }, (_, i) =>
    row({ seq: i + 1 }),
  );
  const { rows: ordered, truncatedCount } = evidenceView(rows);
  assert.equal(ordered.length, EVIDENCE_DISPLAY_CAP);
  assert.equal(truncatedCount, 7);
  // Kept rows are the newest ones (highest seq), newest-last within them.
  assert.equal(ordered[0].seq, 8);
  assert.equal(ordered[ordered.length - 1].seq, EVIDENCE_DISPLAY_CAP + 7);
});

test("evidenceView reports zero truncation exactly at the cap", () => {
  const rows = Array.from({ length: EVIDENCE_DISPLAY_CAP }, (_, i) =>
    row({ seq: i + 1 }),
  );
  const { truncatedCount } = evidenceView(rows);
  assert.equal(truncatedCount, 0);
});

test("listEvidence parses a 200 body into ok:true, sorted-or-not (client is a passthrough)", async () => {
  const { server, baseUrl } = await startServer((req, res) => {
    assert.equal(req.url, "/v1/runs/run-1/evidence?after=0");
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        evidence: [
          {
            seq: 1,
            kind: "command",
            content: "git worktree add ...",
            created_at: "2026-01-01T00:00:00Z",
          },
        ],
      }),
    );
  });
  try {
    const result = await listEvidence("run-1", 0, { baseUrl });
    assert.equal(result.ok, true);
    assert.equal(result.value.length, 1);
    assert.equal(result.value[0].kind, "command");
  } finally {
    await closeServer(server);
  }
});

test("listEvidence forwards the after= cursor", async () => {
  const { server, baseUrl } = await startServer((req, res) => {
    assert.equal(req.url, "/v1/runs/run-1/evidence?after=5");
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ evidence: [] }));
  });
  try {
    const result = await listEvidence("run-1", 5, { baseUrl });
    assert.deepEqual(result, { ok: true, value: [] });
  } finally {
    await closeServer(server);
  }
});

test("listEvidence maps a network failure to kind:unreachable", async () => {
  const result = await listEvidence("run-1", 0, {
    baseUrl: "http://127.0.0.1:1",
  });
  assert.equal(result.ok, false);
  assert.equal(result.kind, "unreachable");
});
