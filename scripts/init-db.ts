import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { conn } from "../dbconnect";

async function initializeDatabase() {
  const schemaPath = resolve(__dirname, "../../sql/schema.sql");
  const schema = await readFile(schemaPath, "utf8");
  await conn.executeMultiple(schema);
  const result = await conn.execute("SELECT (SELECT COUNT(*) FROM customers) AS customers, (SELECT COUNT(*) FROM foods) AS foods");
  console.log("Turso schema initialized:", result.rows[0]);
  conn.close();
}

void initializeDatabase().catch(error => {
  console.error("Could not initialize the Turso schema.", error);
  conn.close();
  process.exitCode = 1;
});
