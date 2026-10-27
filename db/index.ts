import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema";
import * as relations from "./relations";

export const db = drizzle(neon(process.env.DATABASE_URL!), {
  schema: { ...schema, ...relations },
});