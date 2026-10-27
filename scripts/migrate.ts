// Applies new migrations in drizzle/ to the database in DATABASE_URL.
//
// Runs locally with `npm run db:migrate` (against .env.local) and on every
// Vercel production deploy after the build, against the production database.
// Each run applies only the migrations that database hasn't had yet, all in
// one transaction: if any statement fails, nothing is applied and the deploy
// stops before the new code goes live.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { Pool, neonConfig } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import { migrate } from "drizzle-orm/neon-serverless/migrator";

const FOLDER = "drizzle";

// 0000 and 0001 were applied by hand before migrations were tracked. When a
// database has no tracking rows yet, these checks detect which of them it
// already has so they're recorded as applied instead of re-run. Must be in
// journal order; add nothing here for new migrations.
const HAND_APPLIED: Record<string, string> = {
  "0000_worried_speedball": "select to_regclass('public.customers') is not null as ok",
  "0001_inactive_status": `select exists (select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'customers' and column_name = 'end_reasons') as ok`,
  "0002_auth": "select to_regclass('public.users') is not null as ok",
};

type Journal = { entries: { tag: string; when: number }[] };

async function baseline(pool: Pool) {
  await pool.query("create schema if not exists drizzle");
  await pool.query(`create table if not exists drizzle.__drizzle_migrations (
    id serial primary key, hash text not null, created_at bigint)`);
  const { rows } = await pool.query("select count(*)::int as n from drizzle.__drizzle_migrations");
  if (rows[0].n > 0) return;

  const journal: Journal = JSON.parse(readFileSync(`${FOLDER}/meta/_journal.json`, "utf8"));
  for (const { tag, when } of journal.entries) {
    const check = HAND_APPLIED[tag];
    if (!check || !(await pool.query(check)).rows[0].ok) break;
    // same hash drizzle records, so the row is indistinguishable from a real run
    const hash = createHash("sha256").update(readFileSync(`${FOLDER}/${tag}.sql`)).digest("hex");
    await pool.query("insert into drizzle.__drizzle_migrations (hash, created_at) values ($1, $2)", [hash, when]);
    console.log(`Recorded ${tag} as already applied.`);
  }
}

async function main() {
  // Preview deploys share the dev database; only production deploys migrate.
  if (process.env.VERCEL && process.env.VERCEL_ENV !== "production") {
    console.log(`Skipping migrations on a ${process.env.VERCEL_ENV} deploy.`);
    return;
  }

  const url = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set.");

  neonConfig.webSocketConstructor = WebSocket;
  const pool = new Pool({ connectionString: url });
  try {
    await baseline(pool);
    const before = (await pool.query("select count(*)::int as n from drizzle.__drizzle_migrations")).rows[0].n;
    await migrate(drizzle(pool), { migrationsFolder: FOLDER });
    const after = (await pool.query("select count(*)::int as n from drizzle.__drizzle_migrations")).rows[0].n;
    console.log(after > before ? `Applied ${after - before} migration(s).` : "Database is up to date.");
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error("Migration failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
