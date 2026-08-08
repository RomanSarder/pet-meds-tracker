// drizzle-kit migrate (v0.31.x) hangs indefinitely when applying migrations via
// the pg driver with no error output. Using drizzle-orm's built-in migrator with
// the same postgres-js driver the app uses avoids this and keeps driver config in one place.
import "dotenv/config";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
  const db = drizzle(sql);
  await migrate(db, { migrationsFolder: "./drizzle" });
  console.log("Migrations applied");
  await sql.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
