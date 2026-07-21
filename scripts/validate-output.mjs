import fs from "node:fs/promises";
import { validatePublicOutput } from "./update-indices.mjs";

const file = process.argv[2] || "public/data/latest.json";
const data = JSON.parse(await fs.readFile(file, "utf8"));
const errors = validatePublicOutput(data);
if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}
console.log(`JSON válido: ${data.indices.length} índices; fuentes ${data.estado_fuentes.estado}.`);
