require('dotenv').config();

const fs = require('node:fs/promises');
const path = require('node:path');
const { pool } = require('./pool');

const migrationsDirectory = path.join(__dirname, '..', 'database', 'migrations');

async function runMigrations(database = pool) {
  await database.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version VARCHAR(255) PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  const files = (await fs.readdir(migrationsDirectory))
    .filter((file) => /^\d+_[a-z0-9_-]+\.sql$/.test(file))
    .sort();

  for (const file of files) {
    const { rows } = await database.query(
      'SELECT 1 FROM schema_migrations WHERE version = $1',
      [file],
    );
    if (rows.length) continue;

    const sql = await fs.readFile(path.join(migrationsDirectory, file), 'utf8');
    const client = await database.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [file]);
      await client.query('COMMIT');
      console.log(`Applied migration ${file}`);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}

if (require.main === module) {
  runMigrations()
    .then(() => pool.end())
    .catch(async (error) => {
      console.error('Database migration failed:', error);
      await pool.end();
      process.exitCode = 1;
    });
}

module.exports = { runMigrations };
