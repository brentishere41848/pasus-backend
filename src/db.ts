import mysql, { type PoolOptions } from 'mysql2/promise';
import dotenv from 'dotenv';

console.debug("[PasusDebug:backend/src/db] Loaded");
dotenv.config();

const {
  DB_HOST,
  DB_USER,
  DB_PASSWORD,
  DB_NAME,
  DATABASE_URL,
} = process.env;

// Prefer discrete vars to avoid URL encoding issues with special chars.
if (!DB_HOST && !DATABASE_URL && !DB_NAME) {
  throw new Error('Database configuration missing: set DB_HOST/DB_USER/DB_NAME or DATABASE_URL');
}

const basePoolOptions: Partial<PoolOptions> = {
  waitForConnections: true,
  connectionLimit: 10,
};

let poolOptions: PoolOptions;

if (DB_HOST && DB_USER && DB_NAME) {
  poolOptions = {
    ...basePoolOptions,
    host: DB_HOST,
    user: DB_USER,
    password: DB_PASSWORD || '',
    database: DB_NAME,
  };
} else if (DATABASE_URL) {
  const url = new URL(DATABASE_URL);
  const pathname = url.pathname.startsWith('/') ? url.pathname.slice(1) : url.pathname;
  poolOptions = {
    ...basePoolOptions,
    host: url.hostname,
    port: url.port ? Number(url.port) : undefined,
    user: url.username ? decodeURIComponent(url.username) : undefined,
    password: url.password ? decodeURIComponent(url.password) : undefined,
    database: pathname || undefined,
  };
} else {
  // Should not be reachable because of guard above
  throw new Error('Database configuration missing');
}

export const pool = mysql.createPool(poolOptions);
