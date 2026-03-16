import { migrate } from "drizzle-orm/postgres-js/migrator";
import { db } from "./client.ts";
import { logger } from "../lib/logger.ts";

await migrate(db, { migrationsFolder: "./src/db/migrations" });
logger.info("Migrations complete");
process.exit(0);
