import express from "express";
import helmet from "helmet";
import compression from "compression";
import cookieParser from "cookie-parser";
import crypto from "crypto";
import path from "path";
import { fileURLToPath } from "url";

import {
  initDb,
  upsertCompanySnapshot,
  listCompanies,
  getCompany,
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
      version: "5.0.2",
      mode: "POSTGRES_SHADOW",
      db
    });
  } catch (err) {
    return res.status(503).json({
      ok: false,
      service: "DLL ONE Panel Cloud",
      version: "5.0.0",
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
      version: "5.0.0"
    });
  } catch (err) {
    return res.status(400).json({
      ok: false,
      error: String(err?.message || err)
    });
  }
});

app.post("/api/login", (req, res) => {
  const user = String(req.body?.user || "");
  const password = String(req.body?.password || "");

  if (!validLogin(user, password)) {
    return res.status(401).json({
      ok: false,
      error: "Usuario o contraseña incorrectos."
    });
  }

  issueSession(res, user);

  return res.json({
    ok: true,
    user,
    role: "SUPERADMIN"
  });
});

app.post("/api/logout", (_req, res) => {
  clearSession(res);
  return res.json({ ok: true });
});

app.get("/api/me", authRequired, (req, res) => {
  return res.json({
    ok: true,
    user: req.session?.sub || "",
    role: req.session?.role || ""
  });
});

app.get("/api/companies", authRequired, async (_req, res) => {
  try {
    const companies = await listCompanies();

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
    `DLL ONE Panel Cloud V5.0.2 escuchando en puerto ${PORT}`
  );
});
