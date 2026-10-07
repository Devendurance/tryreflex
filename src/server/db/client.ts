import { Pool } from "pg";
import { getDatabaseUrls } from "./config";

export interface Queryable {
  query<T = Record<string, unknown>>(
    text: string,
    values?: readonly unknown[],
  ): Promise<{ rows: T[] }>;
}

export interface DbSession extends Queryable {
  transaction<T>(fn: (q: Queryable) => Promise<T>): Promise<T>;
}

let pool: Pool | undefined;

export function getPool(): Pool {
  if (!pool) {
    pool = new Pool({
      connectionString: getDatabaseUrls().pooled,
      ssl: { rejectUnauthorized: true },
    });
  }
  return pool;
}

export function createSession(connectable: Pool = getPool()): DbSession {
  return {
    query: async <T = Record<string, unknown>>(text: string, values?: readonly unknown[]) => {
      const result = await connectable.query(text, values as unknown[]);
      return { rows: result.rows as T[] };
    },
    transaction: async (fn) => {
      const client = await connectable.connect();
      try {
        await client.query("BEGIN");
        const result = await fn(client);
        await client.query("COMMIT");
        return result;
      } catch (error) {
        await client.query("ROLLBACK").catch(() => {});
        throw error;
      } finally {
        client.release();
      }
    },
  };
}

export async function closePool(): Promise<void> {
  const current = pool;
  pool = undefined;
  if (current) await current.end();
}
