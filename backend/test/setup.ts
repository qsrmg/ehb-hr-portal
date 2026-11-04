// Loaded before any test (node --import): points the app at a separate hr_ms_test database
// so tests never touch the development data, and applies the migrations to it.
import { execSync } from "node:child_process";
import dotenv from "dotenv";
import pg from "pg";

dotenv.config({ quiet: true });
const url = new URL(process.env.DATABASE_URL ?? "");
url.pathname = "/hr_ms_test";
process.env.DATABASE_URL = url.toString();
process.env.NODE_ENV = "test";
process.env.SMTP_HOST = ""; // tests capture emails in memory
process.env.APP_URL = "http://portal.test";

const admin = new URL(url);
admin.pathname = "/postgres";
admin.search = "";
const client = new pg.Client({ connectionString: admin.toString() });
await client.connect();
const exists = await client.query("select 1 from pg_database where datname = 'hr_ms_test'");
if (!exists.rowCount) await client.query("create database hr_ms_test");
await client.end();

execSync("npx prisma migrate deploy", { stdio: "pipe", env: process.env });
