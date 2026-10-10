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

  await pool.query(`
    CREATE TABLE IF NOT EXISTS panel_users (
      user_id BIGSERIAL PRIMARY KEY,
      login_key TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'ADMIN_EMPRESA',
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS panel_user_companies (
      user_id BIGINT NOT NULL REFERENCES panel_users(user_id) ON DELETE CASCADE,
      company_id TEXT NOT NULL,
      permissions JSONB NOT NULL DEFAULT '{"view":true,"operate":true,"editBusiness":true,"editCatalog":true}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (user_id, company_id)
    )
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_panel_user_companies_company
      ON panel_user_companies (company_id)
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS panel_chat_state (
      company_id TEXT NOT NULL,
      client_id TEXT NOT NULL,
      phone_number_id TEXT NOT NULL DEFAULT '',
      wa_id TEXT NOT NULL DEFAULT '',
      customer_name TEXT NOT NULL DEFAULT '',
      mode TEXT NOT NULL DEFAULT 'BOT',
      assigned_to TEXT NOT NULL DEFAULT '',
      last_inbound_at TIMESTAMPTZ,
      last_message_at TIMESTAMPTZ,
      last_message_type TEXT NOT NULL DEFAULT '',
      last_message TEXT NOT NULL DEFAULT '',
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (company_id, client_id)
    )
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_panel_chat_state_company_updated
      ON panel_chat_state (company_id, updated_at DESC)
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS panel_conversation_messages (
      id BIGSERIAL PRIMARY KEY,
      company_id TEXT NOT NULL,
      client_id TEXT NOT NULL,
      phone_number_id TEXT NOT NULL DEFAULT '',
      wa_id TEXT NOT NULL DEFAULT '',
      customer_name TEXT NOT NULL DEFAULT '',
      sender_type TEXT NOT NULL,
      message TEXT NOT NULL DEFAULT '',
      wamid TEXT NOT NULL DEFAULT '',
      source TEXT NOT NULL DEFAULT 'MOTOR',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_panel_conversation_messages_thread
      ON panel_conversation_messages (company_id, client_id, created_at ASC)
  `);

  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_panel_conversation_messages_wamid
      ON panel_conversation_messages (wamid)
      WHERE wamid <> ''
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

export async function listCompaniesForUser(userId, role) {
  if (String(role || "").toUpperCase() === "SUPERADMIN" || !Number(userId)) {
    return listCompanies();
  }

  const { rows } = await pool.query(
    `
      SELECT
        c.company_id,
        c.company_name,
        c.phone_number_id,
        c.modules,
        c.source_version,
        c.synced_at
      FROM panel_companies c
      INNER JOIN panel_user_companies uc
        ON uc.company_id = c.company_id
      WHERE uc.user_id = $1
      ORDER BY c.company_name ASC
    `,
    [Number(userId)]
  );

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

export async function userCanAccessCompany(userId, role, companyId) {
  if (String(role || "").toUpperCase() === "SUPERADMIN" || !Number(userId)) {
    return true;
  }

  const { rows } = await pool.query(
    `
      SELECT 1
      FROM panel_user_companies
      WHERE user_id=$1 AND company_id=$2
      LIMIT 1
    `,
    [Number(userId), String(companyId || "")]
  );

  return !!rows[0];
}

export async function getPanelUserByLogin(loginKey) {
  const { rows } = await pool.query(
    `
      SELECT
        user_id,
        login_key,
        display_name,
        password_hash,
        role,
        active,
        created_at,
        updated_at
      FROM panel_users
      WHERE LOWER(login_key)=LOWER($1)
      LIMIT 1
    `,
    [String(loginKey || "").trim()]
  );

  return rows[0] || null;
}

export async function listPanelUsers() {
  const { rows } = await pool.query(`
    SELECT
      u.user_id,
      u.login_key,
      u.display_name,
      u.role,
      u.active,
      u.created_at,
      COALESCE(
        json_agg(
          json_build_object(
            'companyId', uc.company_id,
            'permissions', uc.permissions
          )
        ) FILTER (WHERE uc.company_id IS NOT NULL),
        '[]'::json
      ) AS companies
    FROM panel_users u
    LEFT JOIN panel_user_companies uc
      ON uc.user_id=u.user_id
    GROUP BY u.user_id
    ORDER BY u.created_at DESC, u.user_id DESC
  `);

  return rows;
}

export async function createPanelUser({
  loginKey,
  displayName,
  passwordHash,
  role = "ADMIN_EMPRESA",
  companyIds = []
}) {
  const normalizedRole = String(role || "ADMIN_EMPRESA").trim().toUpperCase();
  const allowedRoles = new Set(["SUPERADMIN", "ADMIN_EMPRESA", "OPERADOR"]);

  if (!allowedRoles.has(normalizedRole)) {
    throw new Error("Rol de usuario no válido.");
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const existing = await client.query(
      `SELECT user_id FROM panel_users WHERE LOWER(login_key)=LOWER($1) LIMIT 1`,
      [String(loginKey || "").trim()]
    );

    if (existing.rows[0]) {
      throw new Error("Ya existe un usuario con ese acceso.");
    }

    const inserted = await client.query(
      `
        INSERT INTO panel_users (
          login_key,
          display_name,
          password_hash,
          role,
          active,
          created_at,
          updated_at
        )
        VALUES ($1,$2,$3,$4,TRUE,NOW(),NOW())
        RETURNING user_id, login_key, display_name, role, active
      `,
      [
        String(loginKey || "").trim(),
        String(displayName || loginKey || "Usuario").trim(),
        String(passwordHash || ""),
        normalizedRole
      ]
    );

    const user = inserted.rows[0];

    if (normalizedRole !== "SUPERADMIN") {
      const uniqueCompanyIds = [...new Set(
        (Array.isArray(companyIds) ? companyIds : [])
          .map(x => String(x || "").trim())
          .filter(Boolean)
      )];

      for (const companyId of uniqueCompanyIds) {
        await client.query(
          `
            INSERT INTO panel_user_companies (user_id, company_id)
            VALUES ($1,$2)
            ON CONFLICT (user_id,company_id) DO NOTHING
          `,
          [user.user_id, companyId]
        );
      }
    }

    await client.query("COMMIT");
    return user;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function updatePanelUserCompanies(userId, companyIds = []) {
  const id = Number(userId);
  if (!id) throw new Error("Usuario no válido.");

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`DELETE FROM panel_user_companies WHERE user_id=$1`, [id]);

    const uniqueCompanyIds = [...new Set(
      (Array.isArray(companyIds) ? companyIds : [])
        .map(x => String(x || "").trim())
        .filter(Boolean)
    )];

    for (const companyId of uniqueCompanyIds) {
      await client.query(
        `
          INSERT INTO panel_user_companies (user_id, company_id)
          VALUES ($1,$2)
          ON CONFLICT (user_id,company_id) DO NOTHING
        `,
        [id, companyId]
      );
    }

    await client.query("COMMIT");
    return { ok: true };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function setPanelUserActive(userId, active) {
  const { rows } = await pool.query(
    `
      UPDATE panel_users
      SET active=$2, updated_at=NOW()
      WHERE user_id=$1
      RETURNING user_id, login_key, display_name, role, active
    `,
    [Number(userId), !!active]
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


export async function upsertConversationEvent({
  companyId,
  clientId,
  phoneNumberId = "",
  waId = "",
  customerName = "",
  senderType,
  message = "",
  wamid = "",
  source = "MOTOR",
  createdAt = null
}) {
  const company = String(companyId || "").trim();
  const client = String(clientId || "").trim();
  const sender = String(senderType || "").trim().toUpperCase();

  if (!company || !client || !sender) {
    throw new Error("Evento de conversación incompleto.");
  }

  const ts = createdAt ? new Date(createdAt) : new Date();
  const safeTs = Number.isFinite(ts.getTime()) ? ts : new Date();

  const sqlInsert = `
    INSERT INTO panel_conversation_messages (
      company_id,
      client_id,
      phone_number_id,
      wa_id,
      customer_name,
      sender_type,
      message,
      wamid,
      source,
      created_at
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
    ON CONFLICT (wamid) WHERE wamid <> ''
    DO NOTHING
  `;

  await pool.query(
    sqlInsert,
    [
      company,
      client,
      String(phoneNumberId || ""),
      String(waId || ""),
      String(customerName || ""),
      sender,
      String(message || ""),
      String(wamid || ""),
      String(source || "MOTOR"),
      safeTs
    ]
  );

  const inbound =
    sender === "CLIENTE"
      ? safeTs
      : null;

  await pool.query(
    `
      INSERT INTO panel_chat_state (
        company_id,
        client_id,
        phone_number_id,
        wa_id,
        customer_name,
        mode,
        assigned_to,
        last_inbound_at,
        last_message_at,
        last_message_type,
        last_message,
        updated_at
      )
      VALUES (
        $1,$2,$3,$4,$5,'BOT','',$6,$7,$8,$9,NOW()
      )
      ON CONFLICT (company_id, client_id)
      DO UPDATE SET
        phone_number_id =
          CASE
            WHEN EXCLUDED.phone_number_id <> '' THEN EXCLUDED.phone_number_id
            ELSE panel_chat_state.phone_number_id
          END,
        wa_id =
          CASE
            WHEN EXCLUDED.wa_id <> '' THEN EXCLUDED.wa_id
            ELSE panel_chat_state.wa_id
          END,
        customer_name =
          CASE
            WHEN EXCLUDED.customer_name <> '' THEN EXCLUDED.customer_name
            ELSE panel_chat_state.customer_name
          END,
        last_inbound_at =
          COALESCE(EXCLUDED.last_inbound_at, panel_chat_state.last_inbound_at),
        last_message_at = EXCLUDED.last_message_at,
        last_message_type = EXCLUDED.last_message_type,
        last_message = EXCLUDED.last_message,
        updated_at = NOW()
    `,
    [
      company,
      client,
      String(phoneNumberId || ""),
      String(waId || ""),
      String(customerName || ""),
      inbound,
      safeTs,
      sender,
      String(message || "")
    ]
  );

  return {
    ok: true,
    companyId: company,
    clientId: client
  };
}

export async function setConversationMode(
  companyId,
  clientId,
  mode,
  assignedTo = ""
) {
  const company = String(companyId || "").trim();
  const client = String(clientId || "").trim();
  const normalizedMode =
    String(mode || "").trim().toUpperCase() === "HUMANO"
      ? "HUMANO"
      : "BOT";

  if (!company || !client) {
    throw new Error("Falta empresa o cliente para cambiar modo.");
  }

  await pool.query(
    `
      INSERT INTO panel_chat_state (
        company_id,
        client_id,
        mode,
        assigned_to,
        updated_at
      )
      VALUES ($1,$2,$3,$4,NOW())
      ON CONFLICT (company_id, client_id)
      DO UPDATE SET
        mode = EXCLUDED.mode,
        assigned_to = EXCLUDED.assigned_to,
        updated_at = NOW()
    `,
    [
      company,
      client,
      normalizedMode,
      normalizedMode === "HUMANO"
        ? String(assignedTo || "")
        : ""
    ]
  );

  return {
    ok: true,
    companyId: company,
    clientId: client,
    mode: normalizedMode
  };
}

export async function getConversationState(companyId, clientId) {
  const { rows } = await pool.query(
    `
      SELECT *
      FROM panel_chat_state
      WHERE company_id=$1 AND client_id=$2
      LIMIT 1
    `,
    [
      String(companyId || ""),
      String(clientId || "")
    ]
  );

  return rows[0] || null;
}

export async function listConversationStates(companyId) {
  const { rows } = await pool.query(
    `
      SELECT *
      FROM panel_chat_state
      WHERE company_id=$1
      ORDER BY updated_at DESC
      LIMIT 500
    `,
    [String(companyId || "")]
  );

  return rows;
}

export async function listConversationRuntimeMessages(
  companyId,
  clientId,
  limit = 100
) {
  const max = Math.max(10, Math.min(200, Number(limit || 100)));

  const { rows } = await pool.query(
    `
      SELECT
        id,
        company_id,
        client_id,
        phone_number_id,
        wa_id,
        customer_name,
        sender_type,
        message,
        wamid,
        source,
        created_at
      FROM panel_conversation_messages
      WHERE company_id=$1 AND client_id=$2
      ORDER BY created_at DESC, id DESC
      LIMIT $3
    `,
    [
      String(companyId || ""),
      String(clientId || ""),
      max
    ]
  );

  return rows.reverse();
}
