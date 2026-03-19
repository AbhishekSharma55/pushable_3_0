import "dotenv/config";
import postgres from "postgres";
import { readdir, readFile } from "fs/promises";
import { join } from "path";
import { logger } from "../lib/logger.ts";

const connectionString = process.env.DATABASE_URL!;
const sql = postgres(connectionString);

const MIGRATIONS_DIR = join(import.meta.dirname, "migrations");

async function runMigrations() {
    // Create migrations tracking table if it doesn't exist
    await sql`
        CREATE TABLE IF NOT EXISTS "_migrations" (
            id SERIAL PRIMARY KEY,
            name TEXT NOT NULL UNIQUE,
            applied_at TIMESTAMP DEFAULT NOW() NOT NULL
        )
    `;

    // Get already applied migrations
    const applied = await sql`SELECT name FROM "_migrations" ORDER BY id`;
    const appliedSet = new Set(applied.map((r) => r.name));

    // Read migration files
    let files: string[];
    try {
        files = (await readdir(MIGRATIONS_DIR))
            .filter((f) => f.endsWith(".sql"))
            .sort();
    } catch {
        logger.info("No migrations directory found, skipping");
        return;
    }

    let count = 0;
    for (const file of files) {
        if (appliedSet.has(file)) {
            logger.info({ migration: file }, "Already applied, skipping");
            continue;
        }

        const filePath = join(MIGRATIONS_DIR, file);
        const content = await readFile(filePath, "utf-8");

        logger.info({ migration: file }, "Applying migration");

        try {
            await sql.unsafe(content);
            await sql`INSERT INTO "_migrations" (name) VALUES (${file})`;
            count++;
            logger.info({ migration: file }, "Migration applied successfully");
        } catch (error: any) {
            // Check if this is a "already exists" or "does not exist" type error
            // that indicates the migration was already partially applied
            const pgCode = error?.cause?.code || error?.code || "";
            const isAlreadyApplied = [
                "42P07", // relation already exists
                "42710", // type already exists
                "42701", // column already exists
            ].includes(pgCode);

            if (isAlreadyApplied) {
                logger.info({ migration: file, code: pgCode }, "Migration already applied (detected from DB state), marking as done");
                try {
                    await sql`INSERT INTO "_migrations" (name) VALUES (${file}) ON CONFLICT DO NOTHING`;
                } catch {
                    // ignore
                }
            } else {
                // Real failure — do NOT mark as applied so it retries next deploy
                logger.error({ migration: file, error }, "Migration failed — will retry on next startup");
                throw error;
            }
        }
    }

    if (count === 0) {
        logger.info("No new migrations to apply");
    } else {
        logger.info({ count }, "Migrations complete");
    }
}

// Can be imported and called, or run directly
export { runMigrations };

// Run if executed directly
const isDirectRun = process.argv[1]?.includes("migrate");
if (isDirectRun) {
    await runMigrations();
    process.exit(0);
}
