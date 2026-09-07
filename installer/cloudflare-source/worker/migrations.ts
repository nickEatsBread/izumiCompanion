type Migration = { name: string; sql: string }
type Query = (sql: string) => Promise<unknown>

/** Send SQL intact: semicolons can occur in comments, literals and triggers. */
export async function applyD1Migrations(migrations: readonly Migration[], query: Query): Promise<void> {
  const checked = async (sql: string) => {
    const result = await query(sql)
    if (!Array.isArray(result) || result.some(entry => entry?.success === false)) throw new Error('Cloudflare database migration failed.')
    return result as Array<{ results?: Array<{ name?: string }> }>
  }
  await checked('CREATE TABLE IF NOT EXISTS izumi_deploy_migrations (name TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)')
  const result = await checked('SELECT name FROM izumi_deploy_migrations')
  const applied = new Set(result.flatMap(entry => entry.results || []).map(row => row.name))
  for (const migration of migrations) {
    if (applied.has(migration.name)) continue
    await checked(migration.sql)
    await checked(`INSERT INTO izumi_deploy_migrations (name, applied_at) VALUES ('${migration.name.replace(/'/g, "''")}', unixepoch())`)
    applied.add(migration.name)
  }
}
