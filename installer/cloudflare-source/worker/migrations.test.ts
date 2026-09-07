/// <reference types="node" />
import { DatabaseSync } from 'node:sqlite'
import { expect, it, vi } from 'vitest'
import { applyD1Migrations } from './migrations'

it('preserves semicolons in comments and literals and skips applied ALTER migrations', async () => {
  const db = new DatabaseSync(':memory:')
  const calls: string[] = []
  const query = async (sql: string) => {
    calls.push(sql)
    if (sql.startsWith('SELECT')) return [{ success: true, results: db.prepare(sql).all() }]
    db.exec(sql)
    return [{ success: true, results: [] }]
  }
  const migrations = [
    { name: '0001', sql: "-- One record; all content stays intact.\nCREATE TABLE records (value TEXT); INSERT INTO records VALUES ('one;two');" },
    { name: '0002', sql: 'ALTER TABLE records ADD COLUMN version INTEGER DEFAULT 1;' },
  ]
  try {
    await applyD1Migrations(migrations, query)
    await applyD1Migrations(migrations, query)
    expect(db.prepare('SELECT * FROM records').get()).toMatchObject({ value: 'one;two', version: 1 })
    expect(calls.filter(sql => sql === migrations[1].sql)).toHaveLength(1)
    expect(db.prepare('SELECT COUNT(*) AS count FROM izumi_deploy_migrations').get()?.count).toBe(2)
  } finally { db.close() }
})

it('never records a migration whose D1 statement failed', async () => {
  const query = vi.fn(async (sql: string) => [{ success: !sql.startsWith('ALTER'), results: [] }])
  await expect(applyD1Migrations([{ name: 'broken', sql: 'ALTER TABLE missing ADD COLUMN value TEXT;' }], query)).rejects.toThrow('migration failed')
  expect(query.mock.calls.some(([sql]) => sql.startsWith('INSERT'))).toBe(false)
})
