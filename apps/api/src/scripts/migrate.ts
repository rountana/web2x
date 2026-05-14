import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { fileURLToPath } from 'url';
import path from 'path';
import { db } from '../db/client.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Resolves to dist/db/migrations at runtime (SQL files copied there by Dockerfile)
const migrationsFolder = path.join(__dirname, '../db/migrations');

await migrate(db, { migrationsFolder });
console.log('Migrations applied');
process.exit(0);
