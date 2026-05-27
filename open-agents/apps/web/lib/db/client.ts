import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

type DrizzleClient = ReturnType<typeof drizzle<typeof schema>>;

const globalForDb = globalThis as typeof globalThis & {
  __openAgentsDb?: DrizzleClient;
  __openAgentsPostgresClient?: postgres.Sql;
};

function getPostgresMaxConnections() {
  const rawValue = process.env.POSTGRES_MAX_CONNECTIONS;
  if (!rawValue) {
    return 1;
  }

  const parsedValue = Number.parseInt(rawValue, 10);
  if (!Number.isInteger(parsedValue) || parsedValue < 1) {
    return 3;
  }

  return parsedValue;
}

export const db = new Proxy({} as DrizzleClient, {
  get(_, prop) {
    if (!globalForDb.__openAgentsDb) {
      if (!process.env.POSTGRES_URL) {
        throw new Error("POSTGRES_URL environment variable is required");
      }
      globalForDb.__openAgentsPostgresClient ??= postgres(
        process.env.POSTGRES_URL,
        {
          max: getPostgresMaxConnections(),
        },
      );
      globalForDb.__openAgentsDb = drizzle(
        globalForDb.__openAgentsPostgresClient,
        {
          schema,
        },
      );
    }

    return Reflect.get(globalForDb.__openAgentsDb, prop);
  },
});
