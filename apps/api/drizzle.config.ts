import { readFileSync } from 'fs';
import type { Config } from 'drizzle-kit';

try {
  const lines = readFileSync('.env.local', 'utf-8').split('\n');
  for (const line of lines) {
    const match = line.match(/^([^#=\s][^=]*)=(.*)$/);
    if (match) process.env[match[1]] = match[2];
  }
} catch {}

export default {
  schema: './src/db/schema.ts',
  out: './src/db/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
} satisfies Config;
