import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { buildGdeltUrl, isGroupedOrQuery } from "../scripts/update-indices.mjs";

const config = JSON.parse(await fs.readFile("config/indices.json", "utf8"));

test("todas las consultas OR están agrupadas", () => {
  for (const source of config.masterQueries) assert.equal(isGroupedOrQuery(source.query), true, source.id);
});

test("las consultas producen una URL GDELT válida", () => {
  for (const source of config.masterQueries) {
    const url = new URL(buildGdeltUrl(source.query, config.sourcePolicy));
    assert.equal(url.hostname, "api.gdeltproject.org");
    assert.equal(url.searchParams.get("format"), "json");
  }
});

test("una OR sin paréntesis se rechaza", () => {
  assert.equal(isGroupedOrQuery("war OR sanctions OR attack"), false);
});
