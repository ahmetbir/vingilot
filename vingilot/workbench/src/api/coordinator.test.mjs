import assert from "node:assert/strict";
import http from "node:http";
import { test } from "node:test";
import { getRun, listRuns, transitionRun } from "./coordinator.ts";

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

test("listRuns parses a 200 body into ok:true", async () => {
  const { server, baseUrl } = await startServer((req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ runs: [] }));
  });
  try {
    const result = await listRuns("ws-1", { baseUrl });
    assert.deepEqual(result, { ok: true, value: [] });
  } finally {
    await closeServer(server);
  }
});

test("client parses a 409 body into kind:conflict", async () => {
  const { server, baseUrl } = await startServer((req, res) => {
    res.writeHead(409, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "illegal_transition", detail: "cannot go there" }));
  });
  try {
    const result = await transitionRun("run-1", "running", "start it", { baseUrl });
    assert.equal(result.ok, false);
    assert.equal(result.kind, "conflict");
    assert.equal(result.error, "illegal_transition");
    assert.equal(result.detail, "cannot go there");
  } finally {
    await closeServer(server);
  }
});

test("client parses a non-409 error status into kind:api", async () => {
  const { server, baseUrl } = await startServer((req, res) => {
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "run_not_found", detail: "no such run" }));
  });
  try {
    const result = await getRun("run-missing", { baseUrl });
    assert.equal(result.ok, false);
    assert.equal(result.kind, "api");
    assert.equal(result.status, 404);
    assert.equal(result.error, "run_not_found");
  } finally {
    await closeServer(server);
  }
});

test("a network failure (unreachable server) maps to kind:unreachable", async () => {
  // Nothing listens on this port — fetch throws a TypeError.
  const result = await listRuns("ws-1", { baseUrl: "http://127.0.0.1:1" });
  assert.equal(result.ok, false);
  assert.equal(result.kind, "unreachable");
});
