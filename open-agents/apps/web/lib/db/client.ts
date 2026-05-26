import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

type DrizzleClient = ReturnType<typeof drizzle<typeof schema>>;

let _db: DrizzleClient | null = null;

function getPostgresMaxConnections() {
  const rawValue = process.env.POSTGRES_MAX_CONNECTIONS;
  if (!rawValue) {
    return 3;
  }

  const parsedValue = Number.parseInt(rawValue, 10);
  if (!Number.isInteger(parsedValue) || parsedValue < 1) {
    return 3;
  }

  return parsedValue;
}

export const db = new Proxy({} as DrizzleClient, {
  get(_, prop) {
    if (!_db) {
      if (!process.env.POSTGRES_URL) {
        throw new Error("POSTGRES_URL environment variable is required");
      }
      const client = postgres(process.env.POSTGRES_URL, {
        max: getPostgresMaxConnections(),
      });
      _db = drizzle(client, { schema });
    }
    return Reflect.get(_db, prop);
  },
});
