import { createClient as createLibSqlClient } from "@libsql/client";
import { createClient as createTursoClient } from "@tursodatabase/serverless/compat";

const url = process.env.TURSO_DATABASE_URL;
const authToken = process.env.TURSO_AUTH_TOKEN;

if (!url || !authToken) {
  throw new Error("Set TURSO_DATABASE_URL and TURSO_AUTH_TOKEN in your environment");
}

export const conn = url.startsWith("libsql://")
  ? createLibSqlClient({ url, authToken })
  : url.startsWith("turso://")
    ? createTursoClient({ url, authToken })
    : (() => { throw new Error("TURSO_DATABASE_URL must start with libsql:// or turso://"); })();

export type DbRow = Record<string, unknown>;

export async function queryRows<T extends object = DbRow>(sql: string, args: any[] = []): Promise<T[]> {
  const result = await conn.execute({ sql, args });
  return result.rows as unknown as T[];
}

export function execute(sql: string, args: any[] = []) {
  return conn.execute({ sql, args });
}
