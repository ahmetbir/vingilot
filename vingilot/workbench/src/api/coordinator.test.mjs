import assert from "node:assert/strict";
import http from "node:http";
import { test } from "node:test";
import { applyMutations, getRun, getWorkspace, listRuns, provisionRun, transitionRun } from "./coordinator.ts";

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

test("a bare 502 with no coordinator-shaped body maps to kind:unreachable (dev-proxy dead-upstream case)", async () => {
  // The vite dev proxy answers with a plain 502 and no JSON body when its
  // target (the coordinator process) is down — a real HTTP response, not a
  // fetch-level throw, but the same "control plane unreachable" fact. The
  // coordinator itself never returns a bodyless error; every one of its
  // error paths is {error, detail} JSON.
  const { server, baseUrl } = await startServer((req, res) => {
    res.writeHead(502, { "content-type": "text/plain" });
    res.end("Bad Gateway");
  });
  try {
    const result = await listRuns("ws-1", { baseUrl });
    assert.equal(result.ok, false);
    assert.equal(result.kind, "unreachable");
  } finally {
    await closeServer(server);
  }
});

test("a 502 that DOES carry a coordinator-shaped error body stays kind:api (a real app-level 502)", async () => {
  const { server, baseUrl } = await startServer((req, res) => {
    res.writeHead(502, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "upstream_error", detail: "something the coordinator itself reported" }));
  });
  try {
    const result = await listRuns("ws-1", { baseUrl });
    assert.equal(result.ok, false);
    assert.equal(result.kind, "api");
    assert.equal(result.status, 502);
  } finally {
    await closeServer(server);
  }
});

test("a 200 with an empty body (provision/transition's real shape) parses as ok:true, value:undefined", async () => {
  const { server, baseUrl } = await startServer((req, res) => {
    res.writeHead(200);
    res.end();
  });
  try {
    const result = await provisionRun("run-1", { worktrees: [] }, { baseUrl });
    assert.deepEqual(result, { ok: true, value: undefined });
  } finally {
    await closeServer(server);
  }
});

test("getWorkspace parses a missing workspace as kind:api status:404", async () => {
  const { server, baseUrl } = await startServer((req, res) => {
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "workspace_not_found", detail: "no such workspace" }));
  });
  try {
    const result = await getWorkspace("ws-missing", { baseUrl });
    assert.equal(result.ok, false);
    assert.equal(result.kind, "api");
    assert.equal(result.status, 404);
  } finally {
    await closeServer(server);
  }
});

test("applyMutations posts expected_revision and mutations, parses the outcome", async () => {
  let receivedBody = null;
  const { server, baseUrl } = await startServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
    });
    req.on("end", () => {
      receivedBody = JSON.parse(raw);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ accepted: true, revision: 1, state_hash: "abc" }));
    });
  });
  try {
    const result = await applyMutations("ws-1", 0, [], { baseUrl });
    assert.deepEqual(result, { ok: true, value: { accepted: true, revision: 1, state_hash: "abc" } });
    assert.deepEqual(receivedBody, { expected_revision: 0, mutations: [] });
  } finally {
    await closeServer(server);
  }
});
