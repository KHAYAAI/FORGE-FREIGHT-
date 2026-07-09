import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.js";

export function createDb(url = process.env.DATABASE_URL) {
  const connectionString =
    url ?? "postgres://forge:forge@localhost:5432/forge_freight";
  const client = postgres(connectionString, { max: 10 });
  return drizzle(client, { schema });
}

export type Db = ReturnType<typeof createDb>;
