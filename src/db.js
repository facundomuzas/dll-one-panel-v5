import pg from "pg";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error("Falta DATABASE_URL.");
}

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl:
    process.env.NODE_ENV === "production"
      ? { rejectUnauthorized: false }
      : false,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000
});

export async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS panel_companies (
      company_id TEXT PRIMARY KEY,
      company_name TEXT NOT NULL,
      phone_number_id TEXT NOT NULL DEFAULT '',
      modules JSONB NOT NULL DEFAULT '{}'::jsonb,
      config JSONB NOT NULL DEFAULT '{}'::jsonb,
      snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
      source_version TEXT NOT NULL DEFAULT '',
      synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_panel_companies_synced_at
      ON panel_companies (synced_at DESC)
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS panel_sync_log (
      id BIGSERIAL PRIMARY KEY,
      company_id TEXT NOT NULL,
      ok BOOLEAN NOT NULL,
      detail TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_panel_sync_log_company_created
      ON panel_sync_log (company_id, created_at DESC)
  `);
}

export async function upsertCompanySnapshot(payload) {
  const company = payload?.company || {};
  const companyId = String(company.idEmpresa || "").trim();

  if (!companyId) {
    throw new Error("Snapshot sin idEmpresa.");
  }

  const companyName = String(
    company.nombreEmpresa ||
    company.nombre ||
    companyId
  ).trim();

  const phoneNumberId = String(
    company.phoneNumberId || ""
  ).trim();

  const modules = payload?.modules || {};
  const config = payload?.config || {};
  const sourceVersion = String(
    payload?.sourceVersion || ""
  ).trim();

  await pool.query(
    `
      INSERT INTO panel_companies (
        company_id,
        company_name,
        phone_number_id,
        modules,
        config,
        snapshot,
        source_version,
        synced_at
      )
      VALUES ($1,$2,$3,$4::jsonb,$5::jsonb,$6::jsonb,$7,NOW())
      ON CONFLICT (company_id)
      DO UPDATE SET
        company_name = EXCLUDED.company_name,
        phone_number_id = EXCLUDED.phone_number_id,
        modules = EXCLUDED.modules,
        config = EXCLUDED.config,
        snapshot = EXCLUDED.snapshot,
        source_version = EXCLUDED.source_version,
        synced_at = NOW()
    `,
    [
      companyId,
      companyName,
      phoneNumberId,
      JSON.stringify(modules),
      JSON.stringify(config),
      JSON.stringify(payload),
      sourceVersion
    ]
  );

  await pool.query(
    `
      INSERT INTO panel_sync_log (
        company_id,
        ok,
        detail
      )
      VALUES ($1,TRUE,$2)
    `,
    [
      companyId,
      `Snapshot ${sourceVersion || "sin versión"}`
    ]
  );

  return { companyId, companyName };
}

export async function listCompanies() {
  const { rows } = await pool.query(`
    SELECT
      company_id,
      company_name,
      phone_number_id,
      modules,
      source_version,
      synced_at
    FROM panel_companies
    ORDER BY company_name ASC
  `);

  return rows;
}

export async function getCompany(companyId) {
  const { rows } = await pool.query(
    `
      SELECT *
      FROM panel_companies
      WHERE company_id=$1
      LIMIT 1
    `,
    [companyId]
  );

  return rows[0] || null;
}

export async function dbHealth() {
  const start = Date.now();
  const { rows } = await pool.query(
    `SELECT NOW() AS now, COUNT(*)::int AS companies FROM panel_companies`
  );

  return {
    ok: true,
    ms: Date.now() - start,
    now: rows[0]?.now,
    companies: rows[0]?.companies || 0
  };
}
