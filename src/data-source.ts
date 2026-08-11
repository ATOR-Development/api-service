import { Pool } from 'pg'

import { logger } from './util/logger'

/**
 * Read-only connection to the Postgres database owned by the `uns-record-indexer`
 * microservice.
 *
 * This used to be a TypeORM DataSource with a mirrored UnsTokenEntity. That mirror
 * declared eleven columns to read three, and had to be kept in step with a schema owned
 * by another repository — while every feature that justifies an ORM was switched off:
 * `synchronize: false`, `migrationsRun: false`, migrations authoritative in the indexer,
 * and a read-only role here. The one query is a full-table select of three columns, so
 * it is plain `pg` now. That also drops the typeorm -> glob -> minimatch ->
 * brace-expansion advisory chain, which had no non-breaking fix.
 */
const DB_HOST = process.env.DB_HOST || ''
const DB_PORT = parseInt(process.env.DB_PORT || '5432')
const DB_USER = process.env.DB_USER || ''
const DB_PASS = process.env.DB_PASS || ''
const DB_NAME = process.env.DB_NAME || ''

let pool: Pool | null = null
let initializePromise: Promise<Pool> | null = null

export function unsIndexerPool(): Pool {
  if (!pool) {
    throw new Error('UNS indexer pool used before initUnsIndexerDb()')
  }
  return pool
}

export async function initUnsIndexerDb(): Promise<Pool> {
  if (pool) { return pool }

  const missing = [
    ['DB_HOST', DB_HOST],
    ['DB_USER', DB_USER],
    ['DB_NAME', DB_NAME]
  ]
    .filter(([, value]) => !value)
    .map(([name]) => name)
  if (missing.length > 0) {
    throw new Error(
      `Missing UNS indexer DB env vars: ${missing.join(', ')}`
    )
  }
  if (isNaN(DB_PORT)) {
    throw new Error(`Invalid DB_PORT [${process.env.DB_PORT}]`)
  }

  if (!initializePromise) {
    logger.info(
      `Initializing UNS indexer Postgres pool at ` +
        `[${DB_HOST}:${DB_PORT}/${DB_NAME}]...`
    )
    const candidate = new Pool({
      host: DB_HOST,
      port: DB_PORT,
      user: DB_USER,
      password: DB_PASS,
      database: DB_NAME
    })
    // TypeORM's initialize() opened a connection, so failures surfaced at boot rather
    // than on the first request. Keep that: a pg Pool is lazy on its own.
    initializePromise = candidate
      .query('SELECT 1')
      .then(() => {
        pool = candidate
        logger.info('UNS indexer Postgres pool initialized.')
        return candidate
      })
      .catch(error => {
        initializePromise = null
        return candidate.end().catch(() => {}).then(() => { throw error })
      })
  }

  return initializePromise
}
