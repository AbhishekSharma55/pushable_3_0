import { Pool } from "pg";

const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL ||
    "postgresql://postgres:abhishek0003@localhost:5432/pushable_ai",
});

export default pool;
