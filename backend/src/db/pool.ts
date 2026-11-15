import { Pool } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const pool = new Pool({
  host:     process.env.POSTGRES_HOST     || 'localhost',
  port:     Number(process.env.POSTGRES_PORT) || 5432,
  user:     process.env.POSTGRES_USER     || 'crewwatch',
  password: process.env.POSTGRES_PASSWORD || 'crewwatch',
  database: process.env.POSTGRES_DB       || 'crewwatch',
});

pool.on('error', (err) => {
  console.error('Postgres pool error:', err);
});

export async function query<T = unknown>(
  sql: string,
  params?: unknown[]
): Promise<T[]> {
  const result = await pool.query(sql, params);
  return result.rows as T[];
}

export default pool;
