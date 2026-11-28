const assert = require("node:assert/strict");
const { after, before, test } = require("node:test");

const app = require("../src/app");
const { parseHost, parsePort } = require("../src/config/env");
const conditions = require("../src/data/conditions");
const { validateConditionCatalog } = require("../src/utils/catalog");
const { parsePagination, parseResultLimit } = require("../src/utils/query");
const { buildConditionSearchFilter, normalizeSearchQuery } = require("../src/utils/search");
const { isValidConditionSlug, normalizeConditionSlug } = require("../src/utils/slug");

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
  assert.equal(Number.isInteger(body.uptimeSeconds), true);
});

test("API information endpoint lists the shared routes", async () => {
  const response = await fetch(`${baseUrl}/api/v1`);
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.service, "DOCA API");
  assert.equal(body.version, "v1");
  assert.equal(body.endpoints.health, "/api/v1/health");
  assert.equal(body.endpoints.conditions, "/api/v1/conditions");
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

test("catalog validates pagination before using the database", async () => {
  const response = await fetch(`${baseUrl}/api/v1/conditions?page=0`);
  const body = await response.json();

  assert.equal(response.status, 400);
  assert.match(body.message, /page must be a positive integer/i);
});

test("search validates the result limit before using the database", async () => {
  const response = await fetch(`${baseUrl}/api/v1/conditions/search?q=rash&limit=51`);
  const body = await response.json();

  assert.equal(response.status, 400);
  assert.match(body.message, /cannot be greater than 50/i);
});

test("condition details reject an invalid slug before using the database", async () => {
  const response = await fetch(`${baseUrl}/api/v1/conditions/invalid%20slug`);
  const body = await response.json();

  assert.equal(response.status, 400);
  assert.match(body.message, /slug is invalid/i);
});

test("malformed JSON returns a clear 400 response", async () => {
  const response = await fetch(`${baseUrl}/api/v1/conditions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: '{"invalid":',
  });
  const body = await response.json();

  assert.equal(response.status, 400);
  assert.equal(body.message, "Request body contains invalid JSON.");
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

test("pagination uses safe defaults and calculates the offset", () => {
  assert.deepEqual(parsePagination({}), { page: 1, limit: 20, skip: 0 });
  assert.deepEqual(parsePagination({ page: "3", limit: "10" }), {
    page: 3,
    limit: 10,
    skip: 20,
  });
});

test("pagination rejects invalid values", () => {
  assert.throws(() => parsePagination({ page: "0" }), /page must be a positive integer/i);
  assert.throws(() => parseResultLimit("51"), /cannot be greater than 50/i);
  assert.throws(() => parseResultLimit("10items"), /limit must be a positive integer/i);
});

test("condition slugs are normalized and validated", () => {
  const slug = normalizeConditionSlug("  Atopic-Dermatitis  ");

  assert.equal(slug, "atopic-dermatitis");
  assert.equal(isValidConditionSlug(slug), true);
  assert.equal(isValidConditionSlug("invalid slug"), false);
});

test("starter condition catalog is complete and has unique slugs", () => {
  assert.equal(validateConditionCatalog(conditions), true);
  assert.equal(new Set(conditions.map((condition) => condition.slug)).size, conditions.length);
});

test("catalog validation rejects duplicate entries", () => {
  assert.throws(
    () => validateConditionCatalog([conditions[0], conditions[0]]),
    /duplicate condition name/i,
  );
});

test("server settings are validated", () => {
  assert.equal(parsePort(undefined), 5000);
  assert.equal(parsePort("8080"), 8080);
  assert.equal(parseHost(undefined), "0.0.0.0");
  assert.equal(parseHost(" 127.0.0.1 "), "127.0.0.1");
  assert.throws(() => parsePort("0"), /between 1 and 65535/i);
  assert.throws(() => parsePort("not-a-port"), /between 1 and 65535/i);
  assert.throws(() => parseHost("   "), /cannot be empty/i);
});
