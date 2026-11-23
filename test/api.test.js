const assert = require("node:assert/strict");
const { after, before, test } = require("node:test");

const app = require("../src/app");
const { buildConditionSearchFilter, normalizeSearchQuery } = require("../src/utils/search");

let server;
let baseUrl;

before(async () => {
  await new Promise((resolve) => {
    server = app.listen(0, "127.0.0.1", () => {
      const address = server.address();
      baseUrl = `http://127.0.0.1:${address.port}`;
      resolve();
    });
  });
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

test("health endpoint reports a disconnected database", async () => {
  const response = await fetch(`${baseUrl}/api/v1/health`);
  const body = await response.json();

  assert.equal(response.status, 503);
  assert.equal(body.status, "degraded");
  assert.equal(body.service, "DOCA API");
  assert.equal(body.database, "disconnected");
});

test("search validates a missing query before using the database", async () => {
  const response = await fetch(`${baseUrl}/api/v1/conditions/search`);
  const body = await response.json();

  assert.equal(response.status, 400);
  assert.match(body.message, /at least 2 characters/i);
});

test("catalog returns a clear 503 while MongoDB is unavailable", async () => {
  const response = await fetch(`${baseUrl}/api/v1/conditions`);
  const body = await response.json();

  assert.equal(response.status, 503);
  assert.match(body.message, /database unavailable/i);
});

test("unknown API routes return a JSON 404", async () => {
  const response = await fetch(`${baseUrl}/api/v1/not-a-route`);
  const body = await response.json();

  assert.equal(response.status, 404);
  assert.equal(body.status, "error");
});

test("search input is normalized and limited", () => {
  const query = normalizeSearchQuery(`  itchy     red ${"x".repeat(120)}  `);

  assert.equal(query.length, 100);
  assert.match(query, /^itchy red /);
});

test("search treats regular-expression characters as literal text", () => {
  const filter = buildConditionSearchFilter("rash (red)");
  const firstPattern = filter.$and[1].$or[0].name;

  assert.equal(firstPattern.test("condition (red)"), true);
  assert.equal(firstPattern.test("condition red"), false);
});
