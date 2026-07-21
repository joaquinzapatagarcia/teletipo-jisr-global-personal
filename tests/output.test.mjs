import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { validatePublicOutput } from "../scripts/update-indices.mjs";

test("la salida publicada es completa y no contiene campos privados", async () => {
  const data = JSON.parse(await fs.readFile("public/data/latest.json", "utf8"));
  assert.deepEqual(validatePublicOutput(data), []);
});
