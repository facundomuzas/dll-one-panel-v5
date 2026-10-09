import express from "express";
import helmet from "helmet";
import compression from "compression";
import cookieParser from "cookie-parser";
import crypto from "crypto";
import path from "path";
import bcrypt from "bcryptjs";
import * as XLSX from "xlsx";
import { fileURLToPath } from "url";

import {
  initDb,
  upsertCompanySnapshot,
  listCompanies,
  listCompaniesForUser,
  getCompany,
  userCanAccessCompany,
  listPanelUsers,
  createPanelUser,
  updatePanelUserCompanies,
  setPanelUserActive,
  dbHealth
} from "./db.js";

import {
  validLogin,
  issueSession,
  clearSession,
  authRequired
} from "./auth.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = Number(process.env.PORT || 8080);

// Protección corta contra doble click / reintento del mismo mensaje.
const recentHumanSends = new Map();
const HUMAN_SEND_DEDUPE_MS = 10000;

function cleanupRecentHumanSends() {
  const cutoff = Date.now() - (HUMAN_SEND_DEDUPE_MS * 2);
  for (const [key, value] of recentHumanSends.entries()) {
    if (!value || value.at < cutoff) {
      recentHumanSends.delete(key);
    }
  }
}

app.disable("x-powered-by");

app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false
  })
);
app.use(compression());
app.use(express.json({ limit: "15mb" }));
app.use(cookieParser());

function safeEqual(a, b) {
  const aa = Buffer.from(String(a || ""));
  const bb = Buffer.from(String(b || ""));

  if (aa.length !== bb.length) return false;
  return crypto.timingSafeEqual(aa, bb);
}

function rows(snapshot, key) {
  const value = snapshot?.data?.[key];
  return Array.isArray(value) ? value : [];
}

function stringValue(obj, keys) {
  for (const key of keys) {
    if (
      obj &&
      obj[key] !== undefined &&
      obj[key] !== null &&
      String(obj[key]).trim() !== ""
    ) {
      return String(obj[key]).trim();
    }
  }
  return "";
}

function numberValue(obj, keys) {
  const raw = stringValue(obj, keys);
  const n = Number(
    raw
      .replace(/\./g, "")
      .replace(",", ".")
      .replace(/[^\d.-]/g, "")
  );
  return Number.isFinite(n) ? n : 0;
}

function normalizeState(value) {
  return String(value || "").trim().toUpperCase();
}


function bridgeUrl(companyRow) {
  const snapshot = companyRow?.snapshot || {};

  // V5.1.2:
  // primero usamos la URL ya probada por el motor V4 en Railway.
  // ScriptApp.getService().getUrl() puede devolver una URL /dev o una
  // implementación que exige login de Google y desde Railway termina en 401.
  const envBridge = String(
    process.env.APPS_SCRIPT_BRIDGE_URL || ""
  ).trim();

  const snapshotBridge = String(
    snapshot.bridgeUrl || ""
  ).trim();

  const raw = envBridge || snapshotBridge;

  if (!raw) {
    throw new Error(
      "Falta APPS_SCRIPT_BRIDGE_URL en Railway y tampoco hay bridgeUrl sincronizada."
    );
  }

  return raw
    .replace(/\/dev(?:\?.*)?$/i, "/exec")
    .replace(/\/+$/, "") +
    "?dllone_v4=1";
}

async function postBridge(companyRow, operation, payload = {}, actor = "PANEL_V5", timeoutMs = 25000) {
  const key = String(process.env.PANEL_SYNC_KEY || "").trim();
  if (!key) throw new Error("Falta PANEL_SYNC_KEY en Railway.");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const target =
      bridgeUrl(companyRow) +
      "&key=" +
      encodeURIComponent(key);

    const response = await fetch(
      target,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-dll-one-key": key
        },
        body: JSON.stringify({
          action: "panel_v5",
          operation,
          idEmpresa: companyRow.company_id,
          actor,
          ...payload
        }),
        signal: controller.signal
      }
    );

    const text = await response.text();
    let data = null;
    try { data = JSON.parse(text); } catch {}

    if (!response.ok || !data || data.ok !== true) {
      throw new Error(
        data?.error ||
        `Bridge HTTP ${response.status}: ${text.slice(0, 500)}`
      );
    }

    return data.result;
  } catch (err) {
    if (err?.name === "AbortError") {
      throw new Error("Apps Script tardó demasiado en responder.");
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}


async function postBridgeGlobal(operation, payload = {}, actor = "PANEL_V5") {
  const key = String(process.env.PANEL_SYNC_KEY || "").trim();
  if (!key) throw new Error("Falta PANEL_SYNC_KEY en Railway.");

  const raw = String(process.env.APPS_SCRIPT_BRIDGE_URL || "").trim();
  if (!raw) {
    throw new Error("Falta APPS_SCRIPT_BRIDGE_URL en Railway.");
  }

  const target =
    raw
      .replace(/\/dev(?:\?.*)?$/i, "/exec")
      .replace(/\/+$/, "") +
    "?dllone_v4=1&key=" +
    encodeURIComponent(key);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 45000);

  try {
    const response = await fetch(target, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-dll-one-key": key
      },
      body: JSON.stringify({
        action: "panel_v5",
        operation,
        actor,
        ...payload
      }),
      signal: controller.signal
    });

    const text = await response.text();
    let data = null;
    try { data = JSON.parse(text); } catch {}

    if (!response.ok || !data || data.ok !== true) {
      throw new Error(
        data?.error ||
        `Bridge HTTP ${response.status}: ${text.slice(0, 500)}`
      );
    }

    return data.result;
  } catch (err) {
    if (err?.name === "AbortError") {
      throw new Error("Apps Script tardó demasiado en responder.");
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

function requireSuperadmin(req, res, next) {
  if (String(req.session?.role || "").toUpperCase() !== "SUPERADMIN") {
    return res.status(403).json({
      ok: false,
      error: "Solo SUPERADMIN puede realizar esta acción."
    });
  }
  next();
}

async function companyAccessRequired(req, res, next) {
  try {
    const allowed = await userCanAccessCompany(
      Number(req.session?.uid || 0),
      String(req.session?.role || ""),
      String(req.params.companyId || "")
    );

    if (!allowed) {
      return res.status(403).json({
        ok: false,
        error: "No tenés acceso a esta empresa."
      });
    }

    next();
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: String(err?.message || err)
    });
  }
}

function normalizeCatalogRowsFromWorkbook(base64, filename = "lista.xlsx") {
  const raw = String(base64 || "").replace(/^data:.*?;base64,/i, "");
  if (!raw) throw new Error("No se recibió el archivo.");

  const buffer = Buffer.from(raw, "base64");
  if (!buffer.length) throw new Error("El archivo está vacío.");
  if (buffer.length > 6 * 1024 * 1024) {
    throw new Error("La lista supera 6 MB.");
  }

  const wb = XLSX.read(buffer, { type: "buffer" });
  const firstSheet = wb.SheetNames?.[0];
  if (!firstSheet) throw new Error("El archivo no tiene hojas.");

  const rows = XLSX.utils.sheet_to_json(wb.Sheets[firstSheet], {
    defval: "",
    raw: false
  });

  const pick = (row, names) => {
    const entries = Object.entries(row || {});
    for (const name of names) {
      const normalized = String(name).trim().toLowerCase();
      const found = entries.find(([k]) =>
        String(k).trim().toLowerCase() === normalized
      );
      if (found) return found[1];
    }
    return "";
  };

  const normalized = rows.map(row => {
    const precioRaw = pick(row, ["PRECIO", "PRICE", "VALOR", "PRECIO UNITARIO", "PRECIO_UNITARIO"]);
    const precio = Number(
      String(precioRaw || "")
        .replace(/\./g, "")
        .replace(",", ".")
        .replace(/[^0-9.-]/g, "")
    );

    return {
      codigo: String(pick(row, ["CODIGO", "CÓDIGO", "SKU", "ID"]) || "").trim(),
      tipoItem: String(pick(row, ["TIPO_ITEM", "TIPO", "TYPE"]) || "PRODUCTO").trim().toUpperCase(),
      nombre: String(pick(row, ["NOMBRE", "PRODUCTO", "DESCRIPCION CORTA", "DESCRIPCIÓN CORTA"]) || "").trim(),
      descripcion: String(pick(row, ["DESCRIPCION", "DESCRIPCIÓN", "DETALLE"]) || "").trim(),
      precio: Number.isFinite(precio) ? precio : 0,
      unidad: String(pick(row, ["UNIDAD", "MEDIDA"]) || "unidad").trim(),
      categoria: String(pick(row, ["CATEGORIA", "CATEGORÍA", "RUBRO"]) || "").trim(),
      marca: String(pick(row, ["MARCA", "BRAND"]) || "").trim(),
      activo: "SI"
    };
  }).filter(x => x.nombre);

  if (!normalized.length) {
    throw new Error(
      `No encontré productos en ${filename}. La lista necesita al menos una columna NOMBRE o PRODUCTO.`
    );
  }

  if (normalized.length > 1000) {
    throw new Error("La importación admite hasta 1000 filas por archivo.");
  }

  return normalized;
}

function summarize(companyRow) {
  const snapshot = companyRow?.snapshot || {};
  const pedidos = rows(snapshot, "pedidos");
  const chats = rows(snapshot, "chats");
  const quotes = rows(snapshot, "deliveryQuotes");

  const activeOrders = pedidos.filter(p => {
    const state = normalizeState(
      stringValue(
        p,
        ["ESTADO_PEDIDO", "estadoPedido", "Estado Pedido"]
      )
    );
    return !["ENTREGADO", "CANCELADO"].includes(state);
  });

  const pendingQuotes = quotes.filter(q => {
    return normalizeState(
      stringValue(q, ["ESTADO", "estado"])
    ) === "PENDIENTE";
  });

  const human = chats.filter(c => {
    const state = normalizeState(
      stringValue(
        c,
        [
          "ESTADO",
          "ESTADO_BOT",
          "estado",
          "estadoBot"
        ]
      )
    );
    return state.includes("HUMANA") || state.includes("HUMANO");
  });

  const pendingPayment = pedidos.filter(p => {
    const pay = normalizeState(
      stringValue(
        p,
        ["ESTADO_PAGO", "estadoPago", "Estado Pago"]
      )
    );
    return ["PENDIENTE", "COMPROBANTE_RECIBIDO"].includes(pay);
  });

  return {
    chats: chats.length,
    activeOrders: activeOrders.length,
    pendingQuotes: pendingQuotes.length,
    humanAttention: human.length,
    pendingPayment: pendingPayment.length
  };
}

app.get("/health", async (_req, res) => {
  try {
    const db = await dbHealth();
    return res.json({
      ok: true,
      service: "DLL ONE Panel Cloud",
      version: "5.3.1",
      mode: "GASTRO_BUNDLE_FAST",
      bridge: {
        configured: !!String(process.env.APPS_SCRIPT_BRIDGE_URL || "").trim(),
        source: String(process.env.APPS_SCRIPT_BRIDGE_URL || "").trim()
          ? "RAILWAY_ENV"
          : "SNAPSHOT_FALLBACK"
      },
      db
    });
  } catch (err) {
    return res.status(503).json({
      ok: false,
      service: "DLL ONE Panel Cloud",
      version: "5.3.1",
      error: String(err?.message || err)
    });
  }
});

app.post("/sync/company", async (req, res) => {
  const supplied = String(
    req.headers["x-dll-one-key"] || ""
  );

  const expected = String(
    process.env.PANEL_SYNC_KEY || ""
  );

  if (!expected || !safeEqual(supplied, expected)) {
    return res.status(403).json({
      ok: false,
      error: "SYNC_NOT_AUTHORIZED"
    });
  }

  try {
    const result = await upsertCompanySnapshot(
      req.body || {}
    );

    return res.json({
      ok: true,
      ...result,
      version: "5.3.1"
    });
  } catch (err) {
    return res.status(400).json({
      ok: false,
      error: String(err?.message || err)
    });
  }
});

app.post("/api/login", async (req, res) => {
  const user = String(req.body?.user || "");
  const password = String(req.body?.password || "");

  try {
    const sessionUser = await validLogin(user, password);

    if (!sessionUser) {
      return res.status(401).json({
        ok: false,
        error: "Usuario o contraseña incorrectos."
      });
    }

    issueSession(res, sessionUser);

    return res.json({
      ok: true,
      user: sessionUser.loginKey,
      name: sessionUser.displayName,
      role: sessionUser.role
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: String(err?.message || err)
    });
  }
});

app.post("/api/logout", (_req, res) => {
  clearSession(res);
  return res.json({ ok: true });
});

app.get("/api/me", authRequired, (req, res) => {
  return res.json({
    ok: true,
    user: req.session?.sub || "",
    userId: Number(req.session?.uid || 0),
    name: req.session?.name || req.session?.sub || "",
    role: req.session?.role || ""
  });
});

app.get("/api/companies", authRequired, async (req, res) => {
  try {
    const companies = await listCompaniesForUser(
      Number(req.session?.uid || 0),
      String(req.session?.role || "")
    );

    return res.json({
      ok: true,
      items: companies.map(c => ({
        idEmpresa: c.company_id,
        nombreEmpresa: c.company_name,
        phoneNumberId: c.phone_number_id,
        modules: c.modules || {},
        sourceVersion: c.source_version || "",
        syncedAt: c.synced_at
      }))
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: String(err?.message || err)
    });
  }
});

app.get("/api/admin/users", authRequired, requireSuperadmin, async (_req, res) => {
  try {
    const users = await listPanelUsers();
    return res.json({ ok:true, items:users });
  } catch (err) {
    return res.status(500).json({ ok:false, error:String(err?.message || err) });
  }
});

app.post("/api/admin/users", authRequired, requireSuperadmin, async (req, res) => {
  try {
    const loginKey = String(req.body?.loginKey || "").trim();
    const displayName = String(req.body?.displayName || loginKey).trim();
    const password = String(req.body?.password || "");
    const role = String(req.body?.role || "ADMIN_EMPRESA").trim().toUpperCase();
    const companyIds = Array.isArray(req.body?.companyIds) ? req.body.companyIds : [];

    if (!loginKey) throw new Error("Ingresá un usuario o correo.");
    if (password.length < 8) throw new Error("La contraseña debe tener al menos 8 caracteres.");
    if (role !== "SUPERADMIN" && !companyIds.length) {
      throw new Error("Asigná al menos una empresa al usuario.");
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const user = await createPanelUser({ loginKey, displayName, passwordHash, role, companyIds });

    return res.json({ ok:true, user });
  } catch (err) {
    return res.status(400).json({ ok:false, error:String(err?.message || err) });
  }
});

app.post("/api/admin/users/:userId/active", authRequired, requireSuperadmin, async (req, res) => {
  try {
    const user = await setPanelUserActive(req.params.userId, !!req.body?.active);
    if (!user) return res.status(404).json({ok:false,error:"Usuario no encontrado."});
    return res.json({ok:true,user});
  } catch (err) {
    return res.status(400).json({ok:false,error:String(err?.message || err)});
  }
});

app.post("/api/admin/companies", authRequired, requireSuperadmin, async (req, res) => {
  try {
    const payload = {
      nombreEmpresa: String(req.body?.nombreEmpresa || "").trim(),
      tipoNegocio: String(req.body?.tipoNegocio || "MIXTO").trim().toUpperCase(),
      webSlug: String(req.body?.webSlug || "").trim(),
      phoneNumberId: String(req.body?.phoneNumberId || "").trim(),
      modulos: {
        MODULO_VENTAS: req.body?.modules?.ventas ? "SI" : "NO",
        MODULO_GASTRO: req.body?.modules?.gastro ? "SI" : "NO",
        MODULO_EVENTOS: req.body?.modules?.eventos ? "SI" : "NO",
        MODULO_SERVICIOS: req.body?.modules?.servicios ? "SI" : "NO"
      }
    };

    if (!payload.nombreEmpresa) throw new Error("Ingresá el nombre de la empresa.");

    const result = await postBridgeGlobal(
      "admin_create_company",
      payload,
      req.session?.sub || "SUPERADMIN_V5"
    );

    return res.json({ ok:true, ...result });
  } catch (err) {
    return res.status(400).json({ ok:false, error:String(err?.message || err) });
  }
});


app.use(
  "/api/company/:companyId",
  authRequired,
  companyAccessRequired
);

app.get(
  "/api/company/:companyId/summary",
  authRequired,
  async (req, res) => {
    try {
      const company = await getCompany(
        req.params.companyId
      );

      if (!company) {
        return res.status(404).json({
          ok: false,
          error: "Empresa no encontrada."
        });
      }

      return res.json({
        ok: true,
        company: {
          idEmpresa: company.company_id,
          nombreEmpresa: company.company_name,
          sourceVersion: company.source_version,
          syncedAt: company.synced_at
        },
        summary: summarize(company)
      });
    } catch (err) {
      return res.status(500).json({
        ok: false,
        error: String(err?.message || err)
      });
    }
  }
);


app.get(
  "/api/company/:companyId/inbox-live",
  authRequired,
  async (req, res) => {
    try {
      const company = await getCompany(req.params.companyId);
      if (!company) {
        return res.status(404).json({ ok:false, error:"Empresa no encontrada." });
      }

      const result = await postBridge(
        company,
        "inbox",
        {
          filter: String(req.query.filter || "TODOS"),
          search: String(req.query.q || "")
        },
        req.session?.sub || "PANEL_V5"
      );

      return res.json({ ok:true, ...result });
    } catch (err) {
      return res.status(502).json({ ok:false, error:String(err?.message || err) });
    }
  }
);

app.get(
  "/api/company/:companyId/conversation/:clientId/thread",
  authRequired,
  async (req, res) => {
    try {
      const company = await getCompany(req.params.companyId);
      if (!company) {
        return res.status(404).json({ ok:false, error:"Empresa no encontrada." });
      }

      const result = await postBridge(
        company,
        "thread",
        {
          idCliente: req.params.clientId,
          limit: Math.max(10, Math.min(100, Number(req.query.limit || 60)))
        },
        req.session?.sub || "PANEL_V5"
      );

      return res.json({ ok:true, ...result });
    } catch (err) {
      return res.status(502).json({ ok:false, error:String(err?.message || err) });
    }
  }
);

app.post(
  "/api/company/:companyId/conversation/:clientId/take",
  authRequired,
  async (req, res) => {
    try {
      const company = await getCompany(req.params.companyId);
      if (!company) {
        return res.status(404).json({ ok:false, error:"Empresa no encontrada." });
      }

      const result = await postBridge(
        company,
        "take",
        { idCliente:req.params.clientId },
        req.session?.sub || "PANEL_V5"
      );

      return res.json({ ok:true, ...result });
    } catch (err) {
      return res.status(502).json({ ok:false, error:String(err?.message || err) });
    }
  }
);

app.post(
  "/api/company/:companyId/conversation/:clientId/send",
  authRequired,
  async (req, res) => {
    const message = String(req.body?.message || "").trim();
    if (!message) {
      return res.status(400).json({ ok:false, error:"Escribí un mensaje." });
    }
    if (message.length > 4096) {
      return res.status(400).json({ ok:false, error:"El mensaje supera 4096 caracteres." });
    }

    cleanupRecentHumanSends();

    const dedupeKey = [
      String(req.params.companyId || ""),
      String(req.params.clientId || ""),
      message.toLowerCase()
    ].join("|");

    const previous = recentHumanSends.get(dedupeKey);
    const now = Date.now();

    // Si el mismo operador repite exactamente el mismo mensaje a ese mismo
    // cliente pocos segundos después, no volvemos a disparar WhatsApp.
    if (
      previous &&
      previous.state === "sent" &&
      now - previous.at < HUMAN_SEND_DEDUPE_MS
    ) {
      return res.json({
        ok: true,
        duplicateSuppressed: true,
        wamid: previous.wamid || ""
      });
    }

    if (
      previous &&
      previous.state === "sending" &&
      now - previous.at < HUMAN_SEND_DEDUPE_MS
    ) {
      return res.status(409).json({
        ok: false,
        error: "Ese mensaje ya se está enviando."
      });
    }

    recentHumanSends.set(dedupeKey, {
      state: "sending",
      at: now,
      wamid: ""
    });

    try {
      const company = await getCompany(req.params.companyId);
      if (!company) {
        recentHumanSends.delete(dedupeKey);
        return res.status(404).json({ ok:false, error:"Empresa no encontrada." });
      }

      const result = await postBridge(
        company,
        "send",
        {
          idCliente:req.params.clientId,
          message,
          clientRequestId:String(req.body?.clientRequestId || "")
        },
        req.session?.sub || "PANEL_V5"
      );

      recentHumanSends.set(dedupeKey, {
        state: "sent",
        at: Date.now(),
        wamid: String(result?.wamid || "")
      });

      return res.json({
        ok:true,
        duplicateSuppressed:false,
        ...result
      });
    } catch (err) {
      recentHumanSends.delete(dedupeKey);
      return res.status(502).json({ ok:false, error:String(err?.message || err) });
    }
  }
);

app.post(
  "/api/company/:companyId/conversation/:clientId/return-bot",
  authRequired,
  async (req, res) => {
    try {
      const company = await getCompany(req.params.companyId);
      if (!company) {
        return res.status(404).json({ ok:false, error:"Empresa no encontrada." });
      }

      const result = await postBridge(
        company,
        "return_bot",
        { idCliente:req.params.clientId },
        req.session?.sub || "PANEL_V5"
      );

      return res.json({ ok:true, ...result });
    } catch (err) {
      return res.status(502).json({ ok:false, error:String(err?.message || err) });
    }
  }
);

app.get(
  "/api/company/:companyId/profile",
  authRequired,
  async (req, res) => {
    try {
      const company = await getCompany(req.params.companyId);
      if (!company) return res.status(404).json({ok:false,error:"Empresa no encontrada."});

      const result = await postBridge(
        company,
        "company_profile_get",
        {},
        req.session?.sub || "PANEL_V5"
      );

      return res.json({ok:true,...result});
    } catch (err) {
      return res.status(502).json({ok:false,error:String(err?.message || err)});
    }
  }
);

app.post(
  "/api/company/:companyId/profile",
  authRequired,
  async (req, res) => {
    try {
      const company = await getCompany(req.params.companyId);
      if (!company) return res.status(404).json({ok:false,error:"Empresa no encontrada."});

      const result = await postBridge(
        company,
        "company_profile_save",
        {
          data: req.body || {},
          allowModules: String(req.session?.role || "").toUpperCase() === "SUPERADMIN"
        },
        req.session?.sub || "PANEL_V5"
      );

      return res.json({ok:true,...result});
    } catch (err) {
      return res.status(502).json({ok:false,error:String(err?.message || err)});
    }
  }
);

app.get(
  "/api/company/:companyId/catalog",
  authRequired,
  async (req, res) => {
    try {
      const company = await getCompany(req.params.companyId);
      if (!company) return res.status(404).json({ok:false,error:"Empresa no encontrada."});
      const result = await postBridge(company,"catalog_list",{},req.session?.sub || "PANEL_V5");
      return res.json({ok:true,...result});
    } catch (err) {
      return res.status(502).json({ok:false,error:String(err?.message || err)});
    }
  }
);

app.post(
  "/api/company/:companyId/catalog/item",
  authRequired,
  async (req, res) => {
    try {
      const company = await getCompany(req.params.companyId);
      if (!company) return res.status(404).json({ok:false,error:"Empresa no encontrada."});
      const result = await postBridge(company,"catalog_save",{item:req.body || {}},req.session?.sub || "PANEL_V5");
      return res.json({ok:true,...result});
    } catch (err) {
      return res.status(502).json({ok:false,error:String(err?.message || err)});
    }
  }
);

app.post(
  "/api/company/:companyId/catalog/import-file",
  authRequired,
  async (req, res) => {
    try {
      const company = await getCompany(req.params.companyId);
      if (!company) return res.status(404).json({ok:false,error:"Empresa no encontrada."});

      const items = normalizeCatalogRowsFromWorkbook(req.body?.base64, req.body?.filename);
      const result = await postBridge(
        company,
        "catalog_bulk",
        {items},
        req.session?.sub || "PANEL_V5"
      );

      return res.json({ok:true,parsed:items.length,...result});
    } catch (err) {
      return res.status(400).json({ok:false,error:String(err?.message || err)});
    }
  }
);

app.get(
  "/api/company/:companyId/gastro/bundle",
  authRequired,
  async (req, res) => {
    try {
      const company = await getCompany(req.params.companyId);
      if (!company) return res.status(404).json({ok:false,error:"Empresa no encontrada."});

      const startedAt = Date.now();
      const result = await postBridge(
        company,
        "gastro_bundle_get",
        {},
        req.session?.sub || "PANEL_V5",
        45000
      );

      return res.json({
        ok:true,
        elapsedMs:Date.now()-startedAt,
        ...result
      });
    } catch (err) {
      return res.status(502).json({ok:false,error:String(err?.message || err)});
    }
  }
);

app.get(
  "/api/company/:companyId/gastro",
  authRequired,
  async (req, res) => {
    try {
      const company = await getCompany(req.params.companyId);
      if (!company) return res.status(404).json({ok:false,error:"Empresa no encontrada."});
      const result = await postBridge(company,"gastro_get",{},req.session?.sub || "PANEL_V5");
      return res.json({ok:true,...result});
    } catch (err) {
      return res.status(502).json({ok:false,error:String(err?.message || err)});
    }
  }
);

for (const [pathName, operation] of [
  ["category","gastro_save_category"],
  ["product","gastro_save_product"],
  ["variant","gastro_save_variant"],
  ["extra","gastro_save_extra"]
]) {
  app.post(
    `/api/company/:companyId/gastro/${pathName}`,
    authRequired,
    async (req, res) => {
      try {
        const company = await getCompany(req.params.companyId);
        if (!company) return res.status(404).json({ok:false,error:"Empresa no encontrada."});
        const result = await postBridge(company,operation,{data:req.body || {}},req.session?.sub || "PANEL_V5");
        return res.json({ok:true,...result});
      } catch (err) {
        return res.status(502).json({ok:false,error:String(err?.message || err)});
      }
    }
  );
}


app.get(
  "/api/company/:companyId/gastro/settings",
  authRequired,
  async (req, res) => {
    try {
      const company = await getCompany(req.params.companyId);
      if (!company) return res.status(404).json({ok:false,error:"Empresa no encontrada."});
      const result = await postBridge(company,"gastro_settings_get",{},req.session?.sub || "PANEL_V5");
      return res.json({ok:true,...result});
    } catch (err) {
      return res.status(502).json({ok:false,error:String(err?.message || err)});
    }
  }
);

for (const [pathName, operation] of [
  ["menu/config","gastro_menu_config"],
  ["menu/upload","gastro_menu_upload"],
  ["payment","gastro_payment_save"],
  ["config","gastro_config_save"],
  ["zone","gastro_zone_save"]
]) {
  app.post(
    `/api/company/:companyId/gastro/${pathName}`,
    authRequired,
    async (req, res) => {
      try {
        const company = await getCompany(req.params.companyId);
        if (!company) return res.status(404).json({ok:false,error:"Empresa no encontrada."});
        const result = await postBridge(company,operation,{data:req.body || {}},req.session?.sub || "PANEL_V5");
        return res.json({ok:true,...result});
      } catch (err) {
        return res.status(502).json({ok:false,error:String(err?.message || err)});
      }
    }
  );
}

app.post(
  "/api/company/:companyId/gastro/menu/:id/toggle",
  authRequired,
  async (req,res)=>{
    try{
      const company=await getCompany(req.params.companyId);
      if(!company)return res.status(404).json({ok:false,error:"Empresa no encontrada."});
      const result=await postBridge(company,"gastro_menu_toggle",{idImagen:req.params.id,activa:req.body?.activa===true},req.session?.sub||"PANEL_V5");
      return res.json({ok:true,...result});
    }catch(err){return res.status(502).json({ok:false,error:String(err?.message||err)});}
  }
);

app.post(
  "/api/company/:companyId/gastro/menu/:id/move",
  authRequired,
  async (req,res)=>{
    try{
      const company=await getCompany(req.params.companyId);
      if(!company)return res.status(404).json({ok:false,error:"Empresa no encontrada."});
      const result=await postBridge(company,"gastro_menu_move",{idImagen:req.params.id,direccion:String(req.body?.direccion||"")},req.session?.sub||"PANEL_V5");
      return res.json({ok:true,...result});
    }catch(err){return res.status(502).json({ok:false,error:String(err?.message||err)});}
  }
);

app.post(
  "/api/company/:companyId/gastro/menu/:id/delete",
  authRequired,
  async (req,res)=>{
    try{
      const company=await getCompany(req.params.companyId);
      if(!company)return res.status(404).json({ok:false,error:"Empresa no encontrada."});
      const result=await postBridge(company,"gastro_menu_delete",{idImagen:req.params.id},req.session?.sub||"PANEL_V5");
      return res.json({ok:true,...result});
    }catch(err){return res.status(502).json({ok:false,error:String(err?.message||err)});}
  }
);

app.get(
  "/api/company/:companyId/gastro/menu/:id/preview",
  authRequired,
  async (req,res)=>{
    try{
      const company=await getCompany(req.params.companyId);
      if(!company)return res.status(404).json({ok:false,error:"Empresa no encontrada."});
      const result=await postBridge(company,"gastro_menu_preview",{idImagen:req.params.id},req.session?.sub||"PANEL_V5");
      return res.json({ok:true,...result});
    }catch(err){return res.status(502).json({ok:false,error:String(err?.message||err)});}
  }
);

app.post(
  "/api/company/:companyId/gastro/payment/:fila/disable",
  authRequired,
  async (req,res)=>{
    try{
      const company=await getCompany(req.params.companyId);
      if(!company)return res.status(404).json({ok:false,error:"Empresa no encontrada."});
      const result=await postBridge(company,"gastro_payment_disable",{fila:Number(req.params.fila)},req.session?.sub||"PANEL_V5");
      return res.json({ok:true,...result});
    }catch(err){return res.status(502).json({ok:false,error:String(err?.message||err)});}
  }
);

app.post(
  "/api/company/:companyId/gastro/zone/:id/delete",
  authRequired,
  async (req,res)=>{
    try{
      const company=await getCompany(req.params.companyId);
      if(!company)return res.status(404).json({ok:false,error:"Empresa no encontrada."});
      const result=await postBridge(company,"gastro_zone_delete",{idZona:req.params.id},req.session?.sub||"PANEL_V5");
      return res.json({ok:true,...result});
    }catch(err){return res.status(502).json({ok:false,error:String(err?.message||err)});}
  }
);

app.get(
  "/api/company/:companyId/:dataset",
  authRequired,
  async (req, res) => {
    const allowed = new Set([
      "clientes",
      "chats",
      "conversaciones",
      "pedidos",
      "deliveryQuotes",
      "atencionHumana",
      "incidentes"
    ]);

    const dataset = String(req.params.dataset || "");

    if (!allowed.has(dataset)) {
      return res.status(404).json({
        ok: false,
        error: "Dataset no disponible."
      });
    }

    try {
      const company = await getCompany(
        req.params.companyId
      );

      if (!company) {
        return res.status(404).json({
          ok: false,
          error: "Empresa no encontrada."
        });
      }

      let items = rows(company.snapshot, dataset);

      if (dataset === "pedidos") {
        const filter = normalizeState(
          req.query.filter || "ACTIVOS"
        );

        if (filter === "ACTIVOS") {
          items = items.filter(p => {
            const state = normalizeState(
              stringValue(
                p,
                ["ESTADO_PEDIDO", "estadoPedido"]
              )
            );
            return !["ENTREGADO", "CANCELADO"].includes(state);
          });
        } else if (filter !== "TODOS") {
          items = items.filter(p => {
            const state = normalizeState(
              stringValue(
                p,
                ["ESTADO_PEDIDO", "estadoPedido"]
              )
            );
            const payment = normalizeState(
              stringValue(
                p,
                ["ESTADO_PAGO", "estadoPago"]
              )
            );

            return state === filter || payment === filter;
          });
        }
      }

      if (dataset === "deliveryQuotes") {
        items = items.filter(q => {
          const state = normalizeState(
            stringValue(q, ["ESTADO", "estado"])
          );
          return state === "PENDIENTE";
        });
      }

      return res.json({
        ok: true,
        items,
        total: items.length,
        syncedAt: company.synced_at
      });
    } catch (err) {
      return res.status(500).json({
        ok: false,
        error: String(err?.message || err)
      });
    }
  }
);

app.use(
  express.static(
    path.join(__dirname, "..", "public"),
    {
      maxAge:
        process.env.NODE_ENV === "production"
          ? "10m"
          : 0
    }
  )
);

app.get("/{*splat}", (_req, res) => {
  res.sendFile(
    path.join(__dirname, "..", "public", "index.html")
  );
});

await initDb();

app.listen(PORT, () => {
  console.log(
    `DLL ONE Panel Cloud V5.3.1 escuchando en puerto ${PORT}`
  );
});
