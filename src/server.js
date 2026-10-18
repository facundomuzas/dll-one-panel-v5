import {eventsChat} from './events_chat.js';
import {initPayments, paymentSettings} from './payment_settings.js';
import {paymentRouter,publicPaymentRoutes,flushPaymentNotifications} from './payment_routes.js';
import {createCheckout} from './payments.js';
import {initEvents} from './events.js';
import {eventsRouter} from './events_routes.js';
import {requireConfiguredModule,configuredModule} from './module_access.js';
import {initHealthDemo,isHealth,seedHealthDemo,doctors,saveDoctor,availability,reserve,appointments,appointmentState,healthChat,printAgenda,localToday} from './health_demo.js';
import {listCompanyServices,changeCompanyService} from './company_service.js';
import {auditCompanyMigration,combineMigrationAudit} from './migration_audit.js';
import {getBotInstructions,saveBotInstructions} from './bot_instructions.js';
import {importExistingConnection,checkMetaCredentials} from './meta_connection.js';
import {createNativeCompany,nativeConnectionStatus,saveNativeConnection,effectiveMotorSnapshot} from './native_companies.js';
import {isSales,getSalesCatalog,saveSalesItems,salesMotorCatalog,validateSalesOrder,parseSalesPrice} from './sales_catalog.js';
import {gastroMigrationStatus,migrateGastroStep} from './gastro_migration.js';
import {getOrderHours,saveOrderHours,evaluateHours,requireOrderOpen} from "./order_hours.js";
import {readMotorSnapshot,saveMotorSnapshot} from "./motor_snapshot.js";
import {getBusinessProfile,saveBusinessProfile} from "./business_profile.js";
import {getGastroSettings,changeSettings,getMenuFile,motorSettings} from "./gastro_settings.js";
import {ensureGastroCatalog, getGastroCatalog, saveGastroItem, motorCatalog, isGastro} from "./gastro_catalog.js";
import {storeReceipt,listReceipts,reviewReceipt,candidates} from "./receipts.js";
import {getNotifications, markThreadRead, notificationActor} from "./notifications.js";
import {liveCustomers} from "./customers.js";
import {mergeThreadMessages} from "./thread_messages.js";
import {dateMs, formatDateAr} from "./dates.js";
import {getPickup, savePickup} from "./pickup.js";
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
  pool,
  upsertCompanySnapshot,
  listCompanies,
  listCompaniesForUser,
  getCompany,
  userCanAccessCompany,
  listPanelUsers,
  createPanelUser,
  updatePanelUserCompanies,
  setPanelUserActive,
  upsertConversationEvent,
  setConversationMode,
  getConversationState,
  listConversationStates,
  listConversationRuntimeMessages,
  createOrGetDirectOrder,
  getDirectOrder,
  listDirectOrders,
  updateDirectOrderAction,
  upsertDirectDeliveryQuote,
  listDirectDeliveryQuotes,
  getDirectDeliveryQuote,
  markDirectDeliveryQuoteQuoted,
  closeDirectDeliveryQuotes,
  directOperationsSummary,
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

const MOTOR_URL = String(
  process.env.DLL_ONE_MOTOR_URL || ""
).trim().replace(/\/+$/, "");

const MOTOR_KEY = String(
  process.env.PANEL_SYNC_KEY || ""
).trim();

const MOTOR_TIMEOUT_MS = Number(
  process.env.MOTOR_TIMEOUT_MS || 7000
);

async function postMotor(pathname, body = {}) {
  if (!MOTOR_URL) {
    throw new Error("Falta DLL_ONE_MOTOR_URL en Railway.");
  }

  if (!MOTOR_KEY) {
    throw new Error("Falta PANEL_SYNC_KEY en Railway.");
  }

  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    MOTOR_TIMEOUT_MS
  );

  try {
    const response = await fetch(
      MOTOR_URL + pathname,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-dll-one-key": MOTOR_KEY
        },
        body: JSON.stringify(body),
        signal: controller.signal
      }
    );

    const text = await response.text();
    let data = {};

    try {
      data = JSON.parse(text);
    } catch {
      throw new Error(
        `Motor respondió algo no JSON: ${text.slice(0, 300)}`
      );
    }

    if (!response.ok || data?.ok === false) {
      throw new Error(
        data?.error ||
        `Motor HTTP ${response.status}`
      );
    }

    return data;
  } finally {
    clearTimeout(timer);
  }
}

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

function snapshotRows(companyRow, key) {
  const snapshot = companyRow?.snapshot || {};
  const value = snapshot?.data?.[key];
  return Array.isArray(value) ? value : [];
}

function rowValue(row, keys) {
  for (const key of keys) {
    if (
      row &&
      row[key] !== undefined &&
      row[key] !== null &&
      String(row[key]).trim() !== ""
    ) {
      return row[key];
    }
  }
  return "";
}

const recentConversationModes = new Map();
const CONVERSATION_MODE_OVERLAY_MS = 2 * 60 * 1000;

function modeOverlayKey(companyId, clientId) {
  return `${String(companyId || "")}|${String(clientId || "")}`;
}

function setConversationModeOverlay(companyId, clientId, mode) {
  recentConversationModes.set(
    modeOverlayKey(companyId, clientId),
    {
      mode: String(mode || "").toUpperCase(),
      at: Date.now()
    }
  );
}

function getConversationModeOverlay(companyId, clientId) {
  const key = modeOverlayKey(companyId, clientId);
  const value = recentConversationModes.get(key);
  if (!value) return "";

  if (Date.now() - value.at > CONVERSATION_MODE_OVERLAY_MS) {
    recentConversationModes.delete(key);
    return "";
  }

  return value.mode || "";
}

function companyClientsMap(companyRow) {
  const out = new Map();

  for (const row of snapshotRows(companyRow, "clientes")) {
    const id = String(rowValue(row, ["ID_CLIENTE", "idCliente"]) || "").trim();
    if (!id) continue;

    out.set(
      id,
      {
        nombre: String(rowValue(row, ["NOMBRE", "nombre"]) || "").trim(),
        telefono: String(rowValue(row, ["TELEFONO", "telefono"]) || "").trim()
      }
    );
  }

  return out;
}

function companyHumanMap(companyRow) {
  const out = new Map();
  const rows = snapshotRows(companyRow, "atencionHumana");

  for (let i = rows.length - 1; i >= 0; i--) {
    const row = rows[i] || {};
    const id = String(rowValue(row, ["ID_CLIENTE", "idCliente"]) || "").trim();
    if (!id || out.has(id)) continue;

    const estado = normalizeState(rowValue(row, ["ESTADO", "estado"]));
    if (estado !== "PENDIENTE") continue;

    out.set(
      id,
      {
        asignadoA: String(
          rowValue(row, ["ASIGNADO_A", "asignadoA"]) || ""
        ).trim()
      }
    );
  }

  return out;
}

function companyChatIndexMap(companyRow) {
  const out = new Map();

  for (const row of snapshotRows(companyRow, "chats")) {
    const id = String(rowValue(row, ["ID_CLIENTE", "idCliente"]) || "").trim();
    if (!id) continue;
    out.set(id, row);
  }

  return out;
}

function inboxFromPostgres(companyRow, filter = "TODOS", search = "") {
  const clients = companyClientsMap(companyRow);
  const human = companyHumanMap(companyRow);
  const rows = snapshotRows(companyRow, "chats").slice();

  const wanted = normalizeState(filter || "TODOS");
  const q = String(search || "").trim().toLowerCase();
  const companyId = companyRow?.company_id || "";

  rows.sort(
    (a, b) =>
      dateMs(rowValue(b, ["FECHA_ULTIMO", "fechaUltimo"])) -
      dateMs(rowValue(a, ["FECHA_ULTIMO", "fechaUltimo"]))
  );

  const items = [];

  for (const row of rows) {
    if (items.length >= 300) break;

    const idCliente = String(
      rowValue(row, ["ID_CLIENTE", "idCliente"]) || ""
    ).trim();

    if (!idCliente || !idCliente.startsWith("WA_")) continue;

    const cli = clients.get(idCliente) || {
      nombre: "",
      telefono: ""
    };

    const pendingHuman = human.get(idCliente) || null;
    const overlayMode = getConversationModeOverlay(companyId, idCliente);

    const modo =
      overlayMode ||
      (pendingHuman ? "HUMANO" : "BOT");

    if (wanted !== "TODOS" && wanted !== modo) continue;

    const ultimoMensaje = String(
      rowValue(row, ["ULTIMO_MENSAJE", "ultimoMensaje"]) || ""
    );

    const assigned = pendingHuman?.asignadoA || "";

    const searchable = [
      cli.nombre,
      cli.telefono,
      idCliente,
      ultimoMensaje,
      modo,
      assigned
    ]
      .join(" ")
      .toLowerCase();

    if (q && !searchable.includes(q)) continue;

    const lastInbound = rowValue(
      row,
      ["ULTIMA_ENTRADA_WA", "ultimaEntradaWa"]
    );

    const inboundMs = dateMs(lastInbound);

    items.push({
      idCliente,
      nombre: cli.nombre,
      telefono: cli.telefono,
      fechaUltimo: formatDateAr(
        rowValue(row, ["FECHA_ULTIMO", "fechaUltimo"])
      ),
      tipoUltimo: normalizeState(
        rowValue(row, ["TIPO_ULTIMO", "tipoUltimo"])
      ),
      ultimoMensaje,
      modo,
      filaHumana: pendingHuman ? 1 : 0,
      asignadoA: assigned,
      ventana24hAbierta:
        !!inboundMs &&
        Date.now() - inboundMs < 24 * 60 * 60 * 1000
    });
  }

  return items;
}

function recentHumanMessagesForThread(companyId, clientId) {
  const now = Date.now();
  const out = [];

  for (const [key, value] of recentHumanSends.entries()) {
    if (!value || value.state !== "sent") continue;
    if (now - value.at > 2 * 60 * 1000) continue;

    const expectedPrefix =
      `${String(companyId || "")}|${String(clientId || "")}|`;

    if (!key.startsWith(expectedPrefix)) continue;
    if (!value.message) continue;

    out.push({
      fecha: formatDateAr(value.at, true),
      tipo: "VENDEDOR",
      mensaje: value.message,
      _localRecent: true,
      _at: value.at
    });
  }

  return out.sort((a, b) => a._at - b._at);
}

function threadFromPostgres(companyRow, clientId, limit = 60) {
  const id = String(clientId || "").trim();
  const max = Math.max(10, Math.min(100, Number(limit || 60)));
  const clients = companyClientsMap(companyRow);
  const humans = companyHumanMap(companyRow);
  const chats = companyChatIndexMap(companyRow);
  const companyId = companyRow?.company_id || "";

  const cli = clients.get(id) || {
    nombre: "",
    telefono: ""
  };

  const pendingHuman = humans.get(id) || null;
  const overlayMode = getConversationModeOverlay(companyId, id);

  const chatIndex = chats.get(id) || {};
  const inboundMs = dateMs(
    rowValue(chatIndex, ["ULTIMA_ENTRADA_WA", "ultimaEntradaWa"])
  );

  const rawMessages = snapshotRows(companyRow, "conversaciones")
    .filter(
      row =>
        String(
          rowValue(row, ["ID_CLIENTE", "idCliente"]) || ""
        ).trim() === id
    )
    .map(row => ({
      fecha: formatDateAr(
        rowValue(row, ["FECHA_HORA", "fechaHora"]),
        true
      ),
      tipo: normalizeState(
        rowValue(row, ["TIPO", "tipo"])
      ),
      mensaje: String(
        rowValue(row, ["MENSAJE", "mensaje"]) || ""
      ),
      _at: dateMs(
        rowValue(row, ["FECHA_HORA", "fechaHora"])
      )
    }))
    .sort((a, b) => a._at - b._at);

  const localRecent = recentHumanMessagesForThread(companyId, id);

  // Evita duplicar un mensaje optimista cuando ya entró al snapshot.
  for (const local of localRecent) {
    const duplicate = rawMessages.some(
      m =>
        m.tipo === "VENDEDOR" &&
        m.mensaje === local.mensaje &&
        Math.abs((m._at || 0) - (local._at || 0)) < 120000
    );

    if (!duplicate) rawMessages.push(local);
  }

  rawMessages.sort((a, b) => (a._at || 0) - (b._at || 0));

  const messages = rawMessages
    .slice(-max)
    .map(({ _at, _localRecent, ...rest }) => ({...rest, timestamp: _at}));

  return {
    chat: {
      idCliente: id,
      nombre: cli.nombre,
      telefono: cli.telefono,
      modo:
        overlayMode ||
        (pendingHuman ? "HUMANO" : "BOT"),
      filaHumana: pendingHuman ? 1 : 0,
      asignadoA: pendingHuman?.asignadoA || "",
      ventana24hAbierta:
        !!inboundMs &&
        Date.now() - inboundMs < 24 * 60 * 60 * 1000
    },
    messages
  };
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
  // Keep formatted codes (e.g. 000123), but use actual numeric price cells.
  const numericRows=XLSX.utils.sheet_to_json(wb.Sheets[firstSheet],{defval:'',raw:true});
  rows.forEach((row,i)=>{for(const key of Object.keys(row)){
    if(['PRECIO','PRICE','VALOR','PRECIO UNITARIO','PRECIO_UNITARIO'].includes(key.trim().toUpperCase())&&typeof numericRows[i]?.[key]==='number')row[key]=numericRows[i][key];
  }});

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

  const normalized = rows.filter(row=>String(pick(row,["NOMBRE","PRODUCTO","DESCRIPCION CORTA","DESCRIPCIÓN CORTA"])||"").trim()).map(row => {
    const precioRaw = pick(row, ["PRECIO", "PRICE", "VALOR", "PRECIO UNITARIO", "PRECIO_UNITARIO"]);
    const modoPrecio=String(pick(row,['MODO_PRECIO','MODO PRECIO'])||'FIJO').trim().toUpperCase();
    const precio=modoPrecio==='A_COTIZAR'&&!String(precioRaw).trim()?0:parseSalesPrice(precioRaw);

    return {
      codigo: String(pick(row, ["CODIGO", "CÓDIGO", "SKU", "ID"]) || "").trim(),
      tipoItem: String(pick(row, ["TIPO_ITEM", "TIPO", "TYPE"]) || "PRODUCTO").trim().toUpperCase(),
      nombre: String(pick(row, ["NOMBRE", "PRODUCTO", "DESCRIPCION CORTA", "DESCRIPCIÓN CORTA"]) || "").trim(),
      descripcion: String(pick(row, ["DESCRIPCION", "DESCRIPCIÓN", "DETALLE"]) || "").trim(),
      precio,modoPrecio,
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


function runtimeStateToChatItem(state) {
  const clientId = String(state?.client_id || "");
  const inboundMs = dateMs(state?.last_inbound_at);

  return {
    idCliente: clientId,
    nombre: String(state?.customer_name || ""),
    telefono: String(state?.wa_id || ""),
    fechaUltimo: formatDateAr(state?.last_message_at),
    tipoUltimo: normalizeState(state?.last_message_type),
    ultimoMensaje: String(state?.last_message || ""),
    modo: normalizeState(state?.mode) === "HUMANO" ? "HUMANO" : "BOT",
    filaHumana: normalizeState(state?.mode) === "HUMANO" ? 1 : 0,
    asignadoA: String(state?.assigned_to || ""),
    ventana24hAbierta:
      !!inboundMs &&
      Date.now() - inboundMs < 24 * 60 * 60 * 1000,
    _sortTs: dateMs(state?.last_message_at)
  };
}

function mergeInboxItems(snapshotItems, runtimeStates, filter = "TODOS", search = "") {
  const map = new Map();

  for (const item of snapshotItems || []) {
    map.set(
      String(item?.idCliente || ""),
      {
        ...item,
        _sortTs: dateMs(item?.fechaUltimo)
      }
    );
  }

  for (const state of runtimeStates || []) {
    const item = runtimeStateToChatItem(state);
    const key = item.idCliente;
    if (!key) continue;

    const previous = map.get(key);

    if (previous) {
      map.set(
        key,
        {
          ...previous,
          ...item,
          nombre: item.nombre || previous.nombre,
          telefono: item.telefono || previous.telefono
        }
      );
    } else {
      map.set(key, item);
    }
  }

  const wanted = normalizeState(filter || "TODOS");
  const q = String(search || "").trim().toLowerCase();

  return [...map.values()]
    .filter(item => {
      if (wanted !== "TODOS" && normalizeState(item.modo) !== wanted) {
        return false;
      }

      if (!q) return true;

      return [
        item.nombre,
        item.telefono,
        item.idCliente,
        item.ultimoMensaje,
        item.modo,
        item.asignadoA
      ]
        .join(" ")
        .toLowerCase()
        .includes(q);
    })
    .sort((a, b) => Number(b._sortTs || 0) - Number(a._sortTs || 0))
    .slice(0, 300)
    .map(({ _sortTs, ...rest }) => rest);
}

async function authenticateMotorRequest(req, res, next) {
  const supplied = String(
    req.headers["x-dll-one-key"] || ""
  );

  const expected = String(
    process.env.PANEL_SYNC_KEY || ""
  );

  if (!expected || !safeEqual(supplied, expected)) {
    return res.status(403).json({
      ok: false,
      error: "MOTOR_NOT_AUTHORIZED"
    });
  }

  next();
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

publicPaymentRoutes(app,pool,getCompany);

app.get("/health", async (_req, res) => {
  try {
    const db = await dbHealth();
    return res.json({
      ok: true,
      service: "DLL ONE Panel Cloud",
      version: "5.8.5",
      mode: "GASTRO_OPERATIONS_DIRECT",
      bridge: {
        configured: !!String(process.env.APPS_SCRIPT_BRIDGE_URL || "").trim(),
        source: String(process.env.APPS_SCRIPT_BRIDGE_URL || "").trim()
          ? "RAILWAY_ENV"
          : "SNAPSHOT_FALLBACK"
      },
      motor: {
        configured: !!MOTOR_URL,
        mode: "DIRECT_WHATSAPP"
      },
      db
    });
  } catch (err) {
    return res.status(503).json({
      ok: false,
      service: "DLL ONE Panel Cloud",
      version: "5.8.5",
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
    const result=await createNativeCompany(pool,req.body||{},req.session?.sub||'SUPERADMIN');

    return res.json({ ok:true, ...result });
  } catch (err) {
    return res.status(400).json({ ok:false, error:String(err?.message || err) });
  }
});



app.get('/api/admin/companies/:companyId/connection',authRequired,requireSuperadmin,async(req,res)=>{
 try{res.set('Cache-Control','no-store');res.json({ok:true,...await nativeConnectionStatus(pool,req.params.companyId)});}
 catch{res.status(500).json({ok:false,error:'No se pudo cargar la conexión.'});}
});
app.post('/api/admin/companies/:companyId/connection',authRequired,requireSuperadmin,async(req,res)=>{
 try{res.set('Cache-Control','no-store');res.json({ok:true,...await saveNativeConnection(pool,req.params.companyId,req.body||{})});}
 catch(err){res.status(400).json({ok:false,error:String(err.message||'No se pudo guardar la conexión.')});}
});

app.post('/api/admin/companies/:companyId/connection/import',authRequired,requireSuperadmin,async(req,res)=>{
 res.set('Cache-Control','no-store');
 try{
  const id=req.params.companyId,existing=await nativeConnectionStatus(pool,id);
  if(existing.native)return res.json({ok:true,...existing});
  let data;try{data=await postMotor('/admin/panel/connection-export',{companyId:id});}catch{throw Error('No pude leer la conexión actual del motor. Comprobá que esté activo y actualizado a 4.3.11.');}
  res.json({ok:true,...await importExistingConnection(pool,id,data.company,req.session?.sub)});
 }catch(err){res.status(400).json({ok:false,error:err.message});}
});
app.post('/api/admin/companies/:companyId/connection/check',authRequired,requireSuperadmin,async(req,res)=>{
 res.set('Cache-Control','no-store');
 try{
  const row=(await pool.query('SELECT runtime,revision FROM panel_native_companies WHERE company_id=$1',[req.params.companyId])).rows[0];
  if(!row)throw Error('Primero importá la conexión existente.');
  if(req.body?.revision!==row.revision)throw Error('La conexión cambió. Recargá antes de comprobar.');
  const result=await checkMetaCredentials(row.runtime);
  const latest=await nativeConnectionStatus(pool,req.params.companyId);
  if(latest.revision!==row.revision)throw Error('La conexión cambió durante la consulta. Comprobá nuevamente.');
  res.json({ok:true,...result,revision:row.revision});
 }catch(err){res.status(400).json({ok:false,error:err.message});}
});
app.post('/api/admin/health-demo',authRequired,requireSuperadmin,async(req,res)=>{
 try{
 const result=await createNativeCompany(pool,{requestId:'one-salud-demo-v580',nombreEmpresa:'ONE Salud · Demostración',tipoNegocio:'SERVICIOS',modules:{salud:true}},req.session.sub);
 await seedHealthDemo(pool,result.idEmpresa);res.json({ok:true,...result});
 }catch(e){res.status(400).json({ok:false,error:e.code?'No se pudo preparar la demo. Reintentá.':e.message});}
});
app.get('/api/admin/company-services',authRequired,requireSuperadmin,async(req,res)=>{
 res.set('Cache-Control','no-store');try{res.json({ok:true,items:await listCompanyServices(pool)});}catch{res.status(503).json({ok:false,error:'No pude consultar las empresas.'});}
});
app.post('/api/admin/companies/:companyId/service',authRequired,requireSuperadmin,async(req,res)=>{
 res.set('Cache-Control','no-store');
 try{
  const company=await changeCompanyService(pool,req.params.companyId,req.body||{},req.session.sub);
  let motorApplied=false;try{const r=await postMotor('/admin/panel/refresh-config',{companyId:company.company_id,state:company.service_state});motorApplied=r.applied===true;}catch{}
  res.json({ok:true,company,motorApplied});
 }catch(e){res.status(400).json({ok:false,error:e.message});}
});
app.get('/api/admin/migration-audit',authRequired,requireSuperadmin,async(req,res)=>{
 res.set('Cache-Control','no-store');
 try{
  const companies=(await pool.query("SELECT company_id,company_name,phone_number_id,modules,service_state FROM panel_companies WHERE service_state<>'ARCHIVED' ORDER BY company_name")).rows;
  const rows=[];for(const company of companies)rows.push(await auditCompanyMigration(pool,company));
  let motor=null;try{motor=await postMotor('/admin/panel/migration-status');}catch{}
  res.json({ok:true,...combineMigrationAudit(rows,motor)});
 }catch{res.status(503).json({ok:false,error:'No se pudo completar la revisión. Reintentá; no se modificó ningún dato.'});}
});

app.post('/api/admin/meta/webhook',authRequired,requireSuperadmin,async(req,res)=>{
 res.set('Cache-Control','no-store');
 try{
  const data=await postMotor('/admin/panel/webhook-info');
  // Public URL may differ from the internal service URL used by the panel.
  const base=String(process.env.MOTOR_PUBLIC_URL||MOTOR_URL).trim().replace(/\/+$/,'');
  const url=new URL(base);
  const publicUrl=url.protocol==='https:'&&!url.hostname.endsWith('.internal')&&!url.username&&!url.password&&!url.search&&!url.hash;
  res.json({ok:true,callbackUrl:publicUrl?base+'/webhook':'',verifyToken:String(data.verifyToken||''),publicUrlConfigured:publicUrl});
 }catch{res.status(503).json({ok:false,error:'No pude obtener los datos del webhook. Verificá el motor 4.3.11 y la conexión panel–motor.'});}
});

// Private service-to-service routes. Never exposed through company profile APIs.
app.get('/motor/config-snapshot',authenticateMotorRequest,async(req,res)=>{
 try{res.set('Cache-Control','no-store');res.json({ok:true,snapshot:await effectiveMotorSnapshot(pool,await readMotorSnapshot(pool))});}
 catch{res.status(503).json({ok:false,error:'No se pudo recuperar la configuración del motor.'});}
});
app.post('/motor/config-snapshot',authenticateMotorRequest,async(req,res)=>{
 try{res.set('Cache-Control','no-store');res.json({ok:true,...await saveMotorSnapshot(pool,req.body)});}
 catch{res.status(400).json({ok:false,error:'No se pudo guardar la configuración del motor. Revisá que esté completa.'});}
});


app.post('/motor/events/chat',authenticateMotorRequest,async(req,res)=>{
 try{const c=await getCompany(req.body?.companyId);if(!configuredModule(c,'eventos')||c.service_state!=='ACTIVE'||String(c.phone_number_id)!==String(req.body.phoneNumberId))return res.status(403).json({ok:false,error:'ONE Eventos no está habilitado.'});
 const response=await eventsChat(pool,c.company_id,req.body||{});res.json({ok:true,response});
 }catch(e){res.json({ok:true,response:(e.code?'No se pudo consultar Eventos. Reintentá.':e.message)+' Escribí EVENTOS para ver las opciones.'});}
});
app.post('/motor/order/payment',authenticateMotorRequest,async(req,res)=>{
 try{const c=await getCompany(req.body?.companyId);if(!c||c.service_state!=='ACTIVE'||String(c.phone_number_id)!==String(req.body.phoneNumberId))return res.status(403).json({ok:false,error:'Empresa no disponible.'});
 const setting=await paymentSettings(pool,c.company_id);if(setting.mode!=='MP')return res.json({ok:true,mode:'MANUAL'});
 try{res.json({ok:true,...await createCheckout(pool,c.company_id,'ORDER',req.body.orderId)});}catch{res.json({ok:true,mode:'MP',warning:'El pedido está guardado, pero no pudimos obtener el enlace de pago. Pedí ayuda al comercio.'});}
 }catch{res.status(503).json({ok:false,error:'No se pudo consultar la modalidad de pago.'});}
});

app.post('/motor/health/chat',authenticateMotorRequest,async(req,res)=>{
 res.set('Cache-Control','no-store');
 try{
 const c=await getCompany(req.body?.companyId);
 if(!isHealth(c)||c.service_state!=='ACTIVE'||String(c.phone_number_id)!==String(req.body.phoneNumberId))return res.status(403).json({ok:false,error:'Servicio demo no habilitado.'});
 const response=await healthChat(pool,c.company_id,{contact:'WA-'+String(req.body.waId||'').replace(/\D/g,''),text:req.body.text,messageId:req.body.messageId});
 res.json({ok:true,response});
 }catch(e){
  if(e.code)return res.status(503).json({ok:false,error:'No se pudo consultar la agenda demo.'});
  res.json({ok:true,response:'DEMO — '+e.message+' Escribí TURNOS para empezar otra vez.'});
 }
});
app.get('/motor/company/:companyId/service',authenticateMotorRequest,async(req,res)=>{
 res.set('Cache-Control','no-store');try{
 const c=await getCompany(req.params.companyId);
 const active=!!c&&c.service_state==='ACTIVE'&&String(c.phone_number_id)===String(req.query.phoneNumberId||'');
 res.json({ok:true,active,module:active?['eventos','salud','gastro','ventas'].find(key=>configuredModule(c,key))||null:null});
 }catch{res.status(503).json({ok:false,error:'No se pudo verificar el servicio.'});}
});
app.get("/motor/company/:companyId/pickup", authenticateMotorRequest, async (req,res) => {
  try {
    const company=await getCompany(req.params.companyId);
    if(!company) return res.status(404).json({ok:false,error:"Empresa no encontrada."});
    // Evita enlazar por error un número de otra empresa.
    if(String(req.query.phoneNumberId || "") !== String(company.phone_number_id || ""))
      return res.status(409).json({ok:false,error:"El número no corresponde a esta empresa."});
    res.set("Cache-Control", "no-store");
    return res.json({ok:true,pickup:await getPickup(pool,company)});
  } catch(err) {
    return res.status(503).json({ok:false,error:"No se pudo consultar la ubicación."});
  }
});

app.get("/motor/company/:companyId/catalog",authenticateMotorRequest,async(req,res)=>{
  try{
    const company=await getCompany(req.params.companyId);
    if(!company)return res.status(404).json({ok:false,error:'Empresa no encontrada.'});
    if(String(req.query.phoneNumberId||'')!==String(company.phone_number_id||''))return res.status(409).json({ok:false,error:'El número no corresponde a esta empresa.'});
    res.set('Cache-Control','no-store');
    const stored=isGastro(company)?await getGastroCatalog(pool,company,false):null;
    const sales=isSales(company)?await getSalesCatalog(pool,company):null;
    if(sales&&req.query.salesNative!=='1')throw Error('Actualizá el motor para leer ONE Ventas.');
    const config=(await pool.query('SELECT settings FROM panel_gastro_settings WHERE company_id=$1',[company.company_id])).rows[0];
    return res.json({ok:true,companyId:company.company_id,native:!!(stored||sales),catalogType:sales?'SALES':'GASTRO',
      orderAvailability:evaluateHours((await getOrderHours(pool,company.company_id)).settings),
      profile:(await getBusinessProfile(pool,company)).config,
      botInstructions:await getBotInstructions(pool,company.company_id),
      ...(config&&isGastro(company)?{settings:motorSettings(config.settings)}:{}),
      ...(stored?{catalog: motorCatalog(stored.catalog),revision:stored.revision}:sales?{catalog:salesMotorCatalog(sales.items),revision:sales.revision}:{})});
  }catch(err){return res.status(503).json({ok:false,error:'No se pudo consultar el catálogo vigente.'});}
});

app.get('/motor/company/:companyId/menu/:imageId',authenticateMotorRequest,async(req,res)=>{
 try{
  const company=await getCompany(req.params.companyId);
  if(!company||!isGastro(company)||String(company.phone_number_id)!==String(req.query.phoneNumberId))return res.status(403).json({ok:false,error:'Empresa o número incorrecto.'});
  const settings=await getGastroSettings(pool,company);
  if(!settings.settings.menu.auto||!settings.settings.menu.imagenes.some(x=>x.idImagen===req.params.imageId&&x.activa))throw new Error('Imagen desactivada.');
  const file=await getMenuFile(pool,company,req.params.imageId,id=>postBridge(company,'gastro_menu_preview',{idImagen:id}));
  res.set('Cache-Control','no-store');res.json({ok:true,companyId:company.company_id,...file});
 }catch(err){res.status(400).json({ok:false,error:String(err.message||err)});}
});

app.post("/motor/media/receive",authenticateMotorRequest,async(req,res)=>{
  try{return res.json({ok:true,...await storeReceipt(pool,req.body||{})});}
  catch(err){return res.status(400).json({ok:false,error:String(err.message||err)});}
});

app.post(
  "/motor/conversation/event",
  authenticateMotorRequest,
  async (req, res) => {
    try {
      const body = req.body || {};
      const company=await getCompany(body.companyId);
      if(!company||String(company.phone_number_id)!==String(body.phoneNumberId))return res.status(403).json({ok:false,error:'Empresa o número incorrecto.'});
      if(!['CLIENTE','BOT','VENDEDOR','SISTEMA'].includes(String(body.senderType||'').toUpperCase()))throw Error('Tipo de mensaje inválido.');

      const result = await upsertConversationEvent({
        companyId: body.companyId,
        clientId: body.clientId,
        phoneNumberId: body.phoneNumberId,
        waId: body.waId,
        customerName: body.customerName,
        senderType: body.senderType,
        message: body.message,
        wamid: body.wamid,
        source: body.source || "MOTOR",
        createdAt: body.createdAt
      });

      return res.json({
        ok: true,
        ...result
      });
    } catch (err) {
      return res.status(400).json({
        ok: false,
        error: String(err?.message || err)
      });
    }
  }
);

app.get(
  "/motor/conversation/state/:companyId/:clientId",
  authenticateMotorRequest,
  async (req, res) => {
    try {
      const state = await getConversationState(
        req.params.companyId,
        req.params.clientId
      );

      return res.json({
        ok: true,
        state: state || {
          company_id: req.params.companyId,
          client_id: req.params.clientId,
          mode: "BOT",
          assigned_to: ""
        }
      });
    } catch (err) {
      return res.status(500).json({
        ok: false,
        error: String(err?.message || err)
      });
    }
  }
);

app.post(
  "/motor/conversation/mode",
  authenticateMotorRequest,
  async (req, res) => {
    try {
      const result = await setConversationMode(
        req.body?.companyId,
        req.body?.clientId,
        req.body?.mode,
        req.body?.assignedTo || ""
      );

      return res.json({
        ok: true,
        ...result
      });
    } catch (err) {
      return res.status(400).json({
        ok: false,
        error: String(err?.message || err)
      });
    }
  }
);


app.post(
  "/motor/order/confirm",
  authenticateMotorRequest,
  async (req, res) => {
    try {
      await requireOrderOpen(pool,req.body||{});
      await validateSalesOrder(pool,await getCompany(req.body?.companyId),req.body||{});
      const result =
        await createOrGetDirectOrder(
          req.body || {}
        );

      return res.json({
        ok: true,
        ...result
      });
    } catch (err) {
      return res.status(400).json({
        ok: false,
        code:err?.code||"",
        error: String(err?.message || err)
      });
    }
  }
);

app.post(
  "/motor/delivery/quote/upsert",
  authenticateMotorRequest,
  async (req, res) => {
    try {
      await requireOrderOpen(pool,req.body||{});
      const result =
        await upsertDirectDeliveryQuote(
          req.body || {}
        );

      return res.json({
        ok: true,
        ...result
      });
    } catch (err) {
      return res.status(400).json({
        ok: false,
        code:err?.code||"",
        error: String(err?.message || err)
      });
    }
  }
);

app.post(
  "/motor/delivery/quote/close",
  authenticateMotorRequest,
  async (req, res) => {
    try {
      const result =
        await closeDirectDeliveryQuotes(
          req.body?.companyId,
          req.body?.clientId,
          req.body?.state || "CANCELADA"
        );

      return res.json({
        ok: true,
        ...result
      });
    } catch (err) {
      return res.status(400).json({
        ok: false,
        error: String(err?.message || err)
      });
    }
  }
);

app.use(
  "/api/company/:companyId",
  authRequired,
  companyAccessRequired,
  requireConfiguredModule(getCompany)
);

app.use('/api/company/:companyId/events',eventsRouter(pool));
app.use('/api/company/:companyId/payments',paymentRouter(pool));

// Demo administrative scheduling, isolated from production Gastro and other tenants.
app.use('/api/company/:companyId/health',async(req,res,next)=>{
 try{const c=await getCompany(req.params.companyId);if(!isHealth(c))return res.status(403).json({ok:false,error:'Esta empresa no tiene la demo Salud.'});req.healthCompany=c;res.set('Cache-Control','no-store');next();}catch{res.status(503).json({ok:false,error:'No se pudo consultar la demo.'});}
});
const healthError=(res,e)=>res.status(400).json({ok:false,error:e.code?'No se pudo completar la operación. Actualizá la agenda.':e.message});
app.get('/api/company/:companyId/health/doctors',async(req,res)=>{try{res.json({ok:true,today:localToday(),items:await doctors(pool,req.params.companyId)});}catch(e){healthError(res,e);}});
app.post('/api/company/:companyId/health/doctors',requireSuperadmin,async(req,res)=>{try{res.json({ok:true,id:await saveDoctor(pool,req.params.companyId,req.body||{})});}catch(e){healthError(res,e);}});
app.get('/api/company/:companyId/health/availability',async(req,res)=>{try{res.json({ok:true,...await availability(pool,req.params.companyId,req.query.doctorId,String(req.query.date||''))});}catch(e){healthError(res,e);}});
app.get('/api/company/:companyId/health/agenda',async(req,res)=>{try{res.json({ok:true,items:await appointments(pool,req.params.companyId,String(req.query.date||''),String(req.query.doctorId||''))});}catch(e){healthError(res,e);}});
app.post('/api/company/:companyId/health/book',async(req,res)=>{try{if(req.healthCompany.service_state!=='ACTIVE')throw Error('Servicio demo pausado.');res.json({ok:true,appointment:await reserve(pool,req.params.companyId,req.body||{})});}catch(e){healthError(res,e);}});
app.post('/api/company/:companyId/health/state',async(req,res)=>{try{res.json({ok:true,appointment:await appointmentState(pool,req.params.companyId,req.body.id,req.body.state)});}catch(e){healthError(res,e);}});
app.post('/api/company/:companyId/health/chat',async(req,res)=>{try{if(req.healthCompany.service_state!=='ACTIVE')throw Error('Servicio demo pausado.');const response=await healthChat(pool,req.params.companyId,{contact:'SIM-'+crypto.createHash('sha256').update(req.session.sub+'|'+String(req.body.sessionId||'').slice(0,40)).digest('hex'),text:req.body.text,messageId:req.body.messageId});res.json({ok:true,response});}catch(e){healthError(res,e);}});
app.get('/api/company/:companyId/health/print',async(req,res)=>{try{const date=String(req.query.date||'');res.type('html').send(printAgenda(req.healthCompany.company_name,date,await appointments(pool,req.params.companyId,date,String(req.query.doctorId||'')),(await doctors(pool,req.params.companyId)).find(d=>d.id===req.query.doctorId)?.name||'Todos los especialistas'));}catch(e){healthError(res,e);}});

app.get("/api/company/:companyId/receipts",authRequired,async(req,res)=>{
 try{return res.json({ok:true,items:await listReceipts(pool,req.params.companyId)});}
 catch(err){return res.status(500).json({ok:false,error:String(err.message||err)});}
});
app.get("/api/company/:companyId/receipts/:id/file",authRequired,async(req,res)=>{
 try{
  const r=(await pool.query('SELECT data,mime FROM panel_receipts WHERE company_id=$1 AND id=$2',[req.params.companyId,req.params.id])).rows[0];
  if(!r?.data)return res.status(404).json({ok:false,error:"Archivo no disponible."});
  const extension={"image/jpeg":"jpg","image/png":"png","image/webp":"webp","application/pdf":"pdf"}[r.mime];
  if(!extension)return res.status(415).end();
  res.set({"Content-Type":r.mime,"Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff",
   "Content-Security-Policy":"sandbox; default-src 'none'",
   "Content-Disposition":`${r.mime==='application/pdf'?'attachment':'inline'}; filename="comprobante.${extension}"`});
  return res.send(r.data);
 }catch(err){return res.status(400).json({ok:false,error:"No se pudo abrir el archivo."});}
});
app.get("/api/company/:companyId/receipts/:id/orders",authRequired,async(req,res)=>{
 try{
  const r=(await pool.query('SELECT client_id FROM panel_receipts WHERE company_id=$1 AND id=$2',[req.params.companyId,req.params.id])).rows[0];
  if(!r)return res.status(404).json({ok:false,error:"Archivo no encontrado."});
  return res.json({ok:true,items:await candidates(pool,req.params.companyId,r.client_id)});
 }catch(err){return res.status(400).json({ok:false,error:String(err.message||err)});}
});
app.post("/api/company/:companyId/receipts/:id/review",authRequired,async(req,res)=>{
 try{
  if(String(req.session?.role||'').toUpperCase()!=='SUPERADMIN') {
    const allowed=(await pool.query("SELECT permissions FROM panel_user_companies WHERE company_id=$1 AND user_id=$2",[req.params.companyId,req.session?.uid])).rows[0];
    if(!allowed || allowed.permissions?.operate===false)return res.status(403).json({ok:false,error:'No tenés permiso para operar pagos.'});
  }
  const action=String(req.body?.action||'');
  const receipt=await reviewReceipt(pool,req.params.companyId,req.params.id,action,String(req.body?.orderId||''),req.session?.sub||'PANEL');
  let warning='';
  if(receipt.order_id && ['ACEPTAR','RECHAZAR'].includes(action)){
    try {
      const order=await getDirectOrder(req.params.companyId,receipt.order_id);
      // No enviar rechazo si otro archivo mantiene el pago en revisión o ya se confirmó.
      if(order && (action==='ACEPTAR'||order.estadoPago==='RECHAZADO')){
        await postMotor('/admin/panel/order-status',{companyId:req.params.companyId,phoneNumberId:order.phoneNumberId,
          action:action==='ACEPTAR'?'CONFIRMAR_PAGO':'RECHAZAR_PAGO',order});
      }
    }catch{warning='La revisión se guardó, pero no se pudo avisar al cliente por WhatsApp. Podés avisarle desde Conversaciones.';}
  }
  return res.json({ok:true,receipt,warning});
 }catch(err){return res.status(400).json({ok:false,error:String(err.message||err)});}
});

app.get("/api/company/:companyId/notifications", authRequired, async(req,res)=>{
  try {
    res.set("Cache-Control","no-store");
    return res.json({ok:true,...await getNotifications(pool,req.params.companyId,notificationActor(req.session))});
  } catch(err) {return res.status(500).json({ok:false,error:"No se pudieron actualizar los avisos."});}
});
app.post("/api/company/:companyId/conversation/:clientId/read", authRequired, async(req,res)=>{
  try {
    await markThreadRead(pool,req.params.companyId,notificationActor(req.session),req.params.clientId,req.body?.lastMessageId);
    return res.json({ok:true});
  } catch(err) {return res.status(400).json({ok:false,error:String(err.message || err)});}
});
app.get("/api/company/:companyId/clientes", authRequired, async(req,res)=>{
  try {
    const company=await getCompany(req.params.companyId);
    if(!company)return res.status(404).json({ok:false,error:"Empresa no encontrada."});
    const items=await liveCustomers(pool,company.company_id,rows(company.snapshot,"clientes"));
    return res.json({ok:true,source:"POSTGRES_DIRECT",items,total:items.length,syncedAt:new Date().toISOString()});
  }catch(err){return res.status(500).json({ok:false,error:String(err.message || err)});}
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

      const summary = summarize(company);
      const direct = await directOperationsSummary(
        req.params.companyId
      );

      summary.activeOrders = direct.activeOrders;
      summary.pendingQuotes = direct.pendingQuotes;
      summary.pendingPayment = direct.pendingPayment;

      return res.json({
        ok: true,
        company: {
          idEmpresa: company.company_id,
          nombreEmpresa: company.company_name,
          sourceVersion: company.source_version,
          syncedAt: company.synced_at
        },
        summary
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
        return res.status(404).json({
          ok:false,
          error:"Empresa no encontrada."
        });
      }

      const snapshotItems = inboxFromPostgres(
        company,
        "TODOS",
        ""
      );

      const runtimeStates =
        await listConversationStates(
          req.params.companyId
        );

      const items = mergeInboxItems(
        snapshotItems,
        runtimeStates,
        String(req.query.filter || "TODOS"),
        String(req.query.q || "")
      );

      return res.json({
        ok:true,
        source:"POSTGRES_DIRECT",
        syncedAt:company.synced_at,
        items,
        generatedAt:new Date().toISOString()
      });
    } catch (err) {
      return res.status(500).json({
        ok:false,
        error:String(err?.message || err)
      });
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
        return res.status(404).json({
          ok:false,
          error:"Empresa no encontrada."
        });
      }

      const snapshotResult = threadFromPostgres(
        company,
        req.params.clientId,
        req.query.limit
      );

      const runtimeMessages =
        await listConversationRuntimeMessages(
          req.params.companyId,
          req.params.clientId,
          req.query.limit || 100
        );

      const runtimeState =
        await getConversationState(
          req.params.companyId,
          req.params.clientId
        );

      const messages = mergeThreadMessages(
        snapshotResult.messages || [],
        runtimeMessages
      );

      const chat = {
        ...(snapshotResult.chat || {}),
        ...(runtimeState
          ? {
              nombre:
                runtimeState.customer_name ||
                snapshotResult.chat?.nombre ||
                "",
              telefono:
                runtimeState.wa_id ||
                snapshotResult.chat?.telefono ||
                "",
              modo:
                normalizeState(runtimeState.mode) === "HUMANO"
                  ? "HUMANO"
                  : "BOT",
              asignadoA:
                runtimeState.assigned_to || "",
              ventana24hAbierta:
                !!dateMs(runtimeState.last_inbound_at) &&
                Date.now() - dateMs(runtimeState.last_inbound_at) <
                  24 * 60 * 60 * 1000
            }
          : {})
      };

      return res.json({
        ok:true,
        source:"POSTGRES_DIRECT",
        syncedAt:company.synced_at,
        chat,
        messages,
        attachments:await listReceipts(pool,req.params.companyId,req.params.clientId),
        lastMessageId: runtimeMessages.reduce((max,m)=>BigInt(m.id || 0)>BigInt(max)?String(m.id):max,"0")
      });
    } catch (err) {
      return res.status(500).json({
        ok:false,
        error:String(err?.message || err)
      });
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
        return res.status(404).json({
          ok:false,
          error:"Empresa no encontrada."
        });
      }

      const operator =
        String(
          req.session?.sub ||
          "PANEL_V5"
        );

      await setConversationMode(
        req.params.companyId,
        req.params.clientId,
        "HUMANO",
        operator
      );

      let motorWarning = "";

      try {
        await postMotor(
          "/admin/panel/conversation-mode",
          {
            companyId:req.params.companyId,
            phoneNumberId:company.phone_number_id,
            clientId:req.params.clientId,
            mode:"HUMANO",
            assignedTo:operator
          }
        );
      } catch (err) {
        motorWarning = String(err?.message || err);
      }

      return res.json({
        ok:true,
        modo:"HUMANO",
        source:"POSTGRES_DIRECT",
        motorWarning
      });
    } catch (err) {
      return res.status(500).json({
        ok:false,
        error:String(err?.message || err)
      });
    }
  }
);

app.post(
  "/api/company/:companyId/conversation/:clientId/send",
  authRequired,
  async (req, res) => {
    const message = String(req.body?.message || "").trim();

    if (!message) {
      return res.status(400).json({
        ok:false,
        error:"Escribí un mensaje."
      });
    }

    if (message.length > 4096) {
      return res.status(400).json({
        ok:false,
        error:"El mensaje supera 4096 caracteres."
      });
    }

    cleanupRecentHumanSends();

    const dedupeKey = [
      String(req.params.companyId || ""),
      String(req.params.clientId || ""),
      message.toLowerCase()
    ].join("|");

    const previous = recentHumanSends.get(dedupeKey);
    const now = Date.now();

    if (
      previous &&
      previous.state === "sent" &&
      now - previous.at < HUMAN_SEND_DEDUPE_MS
    ) {
      return res.json({
        ok:true,
        duplicateSuppressed:true,
        wamid:previous.wamid || ""
      });
    }

    if (
      previous &&
      previous.state === "sending" &&
      now - previous.at < HUMAN_SEND_DEDUPE_MS
    ) {
      return res.status(409).json({
        ok:false,
        error:"Ese mensaje ya se está enviando."
      });
    }

    recentHumanSends.set(
      dedupeKey,
      {
        state:"sending",
        at:now,
        wamid:"",
        message
      }
    );

    try {
      const company = await getCompany(req.params.companyId);

      if (!company) {
        recentHumanSends.delete(dedupeKey);
        return res.status(404).json({
          ok:false,
          error:"Empresa no encontrada."
        });
      }

      const state = await getConversationState(
        req.params.companyId,
        req.params.clientId
      );

      if (
        state &&
        normalizeState(state.mode) !== "HUMANO"
      ) {
        recentHumanSends.delete(dedupeKey);

        return res.status(409).json({
          ok:false,
          error:"Primero tomá la conversación."
        });
      }

      const result = await postMotor(
        "/admin/panel/send",
        {
          companyId:req.params.companyId,
          phoneNumberId:company.phone_number_id,
          clientId:req.params.clientId,
          message,
          operator:
            String(
              req.session?.sub ||
              "PANEL_V5"
            ),
          clientRequestId:
            String(
              req.body?.clientRequestId ||
              ""
            )
        }
      );

      recentHumanSends.set(
        dedupeKey,
        {
          state:"sent",
          at:Date.now(),
          wamid:String(result?.wamid || ""),
          message
        }
      );

      return res.json({
        ok:true,
        duplicateSuppressed:false,
        source:"MOTOR_DIRECT",
        ...result
      });
    } catch (err) {
      recentHumanSends.delete(dedupeKey);

      return res.status(502).json({
        ok:false,
        error:String(err?.message || err)
      });
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
        return res.status(404).json({
          ok:false,
          error:"Empresa no encontrada."
        });
      }

      await setConversationMode(
        req.params.companyId,
        req.params.clientId,
        "BOT",
        ""
      );

      let motorWarning = "";

      try {
        await postMotor(
          "/admin/panel/conversation-mode",
          {
            companyId:req.params.companyId,
            phoneNumberId:company.phone_number_id,
            clientId:req.params.clientId,
            mode:"BOT",
            assignedTo:""
          }
        );
      } catch (err) {
        motorWarning = String(err?.message || err);
      }

      return res.json({
        ok:true,
        modo:"BOT",
        source:"POSTGRES_DIRECT",
        motorWarning
      });
    } catch (err) {
      return res.status(500).json({
        ok:false,
        error:String(err?.message || err)
      });
    }
  }
);

app.get('/api/company/:companyId/order-hours',authRequired,async(req,res)=>{
 try{const row=await getOrderHours(pool,req.params.companyId);res.json({ok:true,...row,status:evaluateHours(row.settings)});}
 catch(err){res.status(400).json({ok:false,error:String(err.message||err)});}
});
app.post('/api/company/:companyId/order-hours',authRequired,async(req,res)=>{
 try{
  if(String(req.session?.role||'').toUpperCase()!=='SUPERADMIN'){
   const access=(await pool.query('SELECT permissions FROM panel_user_companies WHERE company_id=$1 AND user_id=$2',[req.params.companyId,req.session?.uid])).rows[0];
   if(!access||access.permissions?.editBusiness===false)return res.status(403).json({ok:false,error:'No tenés permiso para editar horarios.'});
  }
  const row=await saveOrderHours(pool,req.params.companyId,req.body||{});res.json({ok:true,...row,status:evaluateHours(row.settings)});
 }catch(err){res.status(400).json({ok:false,error:String(err.message||err)});}
});

app.get('/api/company/:companyId/bot-instructions',authRequired,async(req,res)=>{
 res.set('Cache-Control','no-store');
 try{res.json({ok:true,...await getBotInstructions(pool,req.params.companyId)});}
 catch{res.status(503).json({ok:false,error:'No se pudieron cargar las instrucciones.'});}
});
app.post('/api/company/:companyId/bot-instructions',authRequired,async(req,res)=>{
 res.set('Cache-Control','no-store');
 try{
  if(String(req.session?.role||'').toUpperCase()!=='SUPERADMIN'){
   const access=(await pool.query('SELECT permissions FROM panel_user_companies WHERE company_id=$1 AND user_id=$2',[req.params.companyId,req.session?.uid])).rows[0];
   if(!access||access.permissions?.editBusiness===false)return res.status(403).json({ok:false,error:'No tenés permiso para editar las instrucciones del bot.'});
  }
  res.json({ok:true,...await saveBotInstructions(pool,req.params.companyId,req.body||{})});
 }catch(err){res.status(400).json({ok:false,error:err.message});}
});

app.get('/api/company/:companyId/profile',authRequired,async(req,res)=>{
 try{const company=await getCompany(req.params.companyId);if(!company)return res.status(404).json({ok:false,error:'Empresa no encontrada.'});res.json({ok:true,...await getBusinessProfile(pool,company)});}
 catch(err){res.status(400).json({ok:false,error:String(err.message||err)});}
});
app.post('/api/company/:companyId/profile',authRequired,async(req,res)=>{
 try{
  const isSuper=String(req.session?.role||'').toUpperCase()==='SUPERADMIN';
  if(!isSuper){const access=(await pool.query('SELECT permissions FROM panel_user_companies WHERE company_id=$1 AND user_id=$2',[req.params.companyId,req.session?.uid])).rows[0];if(!access||access.permissions?.editBusiness===false)return res.status(403).json({ok:false,error:'No tenés permiso para editar la empresa.'});}
  res.json({ok:true,...await saveBusinessProfile(pool,req.params.companyId,req.body||{},isSuper)});
 }catch(err){res.status(400).json({ok:false,error:String(err.message||err)});}
});

app.get(
  "/api/company/:companyId/catalog",
  authRequired,
  async (req, res) => {
    try {
      const company = await getCompany(req.params.companyId);
      if (!company) return res.status(404).json({ok:false,error:"Empresa no encontrada."});
      const result = await ensureSales(company);
      return res.json({ok:true,...result});
    } catch (err) {
      return res.status(502).json({ok:false,error:String(err?.message || err)});
    }
  }
);

app.post(
  "/api/company/:companyId/catalog/item",
  authRequired,canEditGastro,
  async (req, res) => {
    try {
      const company = await getCompany(req.params.companyId);
      if (!company) return res.status(404).json({ok:false,error:"Empresa no encontrada."});
      await ensureSales(company);
      const result = await saveSalesItems(pool,company,[req.body||{}],req.body?.revision);
      return res.json({ok:true,...result});
    } catch (err) {
      return res.status(502).json({ok:false,error:String(err?.message || err)});
    }
  }
);

app.post(
  "/api/company/:companyId/catalog/import-file",
  authRequired,canEditGastro,
  async (req, res) => {
    try {
      const company = await getCompany(req.params.companyId);
      if (!company) return res.status(404).json({ok:false,error:"Empresa no encontrada."});

      const items = normalizeCatalogRowsFromWorkbook(req.body?.base64, req.body?.filename);
      await ensureSales(company);
      const result = await saveSalesItems(pool,company,items,req.body?.revision,{bulk:true});

      return res.json({ok:true,parsed:items.length,...result});
    } catch (err) {
      return res.status(400).json({ok:false,error:String(err?.message || err)});
    }
  }
);

async function ensureSales(company){return getSalesCatalog(pool,company,()=>postBridge(company,'catalog_list'));}

async function ensureCatalog(company){
  return ensureGastroCatalog(pool,company,()=>postBridge(company,'gastro_get'));
}
async function ensureSettings(company){
  return getGastroSettings(pool,company,()=>postBridge(company,'gastro_settings_get'));
}
async function canEditGastro(req,res,next){
  if(String(req.session?.role||'').toUpperCase()==='SUPERADMIN')return next();
  try{
    const {rows}=await pool.query('SELECT permissions FROM panel_user_companies WHERE user_id=$1 AND company_id=$2',[Number(req.session?.uid||0),req.params.companyId]);
    if(!rows[0]||rows[0].permissions?.editCatalog===false)return res.status(403).json({ok:false,error:'No tenés permiso para editar el catálogo.'});
    next();
  }catch(err){res.status(500).json({ok:false,error:'No se pudo verificar el permiso.'});}
}

app.get(
  "/api/company/:companyId/gastro/bundle",
  authRequired,
  async (req, res) => {
    try {
      const company = await getCompany(req.params.companyId);

      if (!company) {
        return res.status(404).json({
          ok:false,
          error:"Empresa no encontrada."
        });
      }

      const stored=await ensureCatalog(company);
      return res.json({ok:true,...(company.snapshot?.data?.gastroBundle||{}),...stored.catalog,
        source:"PANEL",revision:stored.revision,syncedAt:stored.updated_at});
    } catch (err) {
      return res.status(500).json({
        ok:false,
        error:String(err?.message || err)
      });
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
      const result = (await ensureCatalog(company)).catalog;
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
        if(String(req.session?.role||'').toUpperCase()!=='SUPERADMIN'){
          const access=await pool.query('SELECT permissions FROM panel_user_companies WHERE user_id=$1 AND company_id=$2',[Number(req.session?.uid||0),company.company_id]);
          if(!access.rows[0]||access.rows[0].permissions?.editCatalog===false)return res.status(403).json({ok:false,error:'No tenés permiso para editar el catálogo.'});
        }
        await ensureCatalog(company);
        const result = await saveGastroItem(pool,company,pathName,req.body||{});
        return res.json({ok:true,...result});
      } catch (err) {
        return res.status(502).json({ok:false,error:String(err?.message || err)});
      }
    }
  );
}


app.get('/api/company/:companyId/gastro/migration',authRequired,async(req,res)=>{
 try{
  const company=await getCompany(req.params.companyId);if(!company)return res.status(404).json({ok:false,error:'Empresa no encontrada.'});
  res.set('Cache-Control','no-store');res.json({ok:true,...await gastroMigrationStatus(pool,company)});
 }catch(err){res.status(400).json({ok:false,error:String(err.message||err)});}
});
app.post('/api/company/:companyId/gastro/migration',authRequired,canEditGastro,async(req,res)=>{
 try{
  const company=await getCompany(req.params.companyId);if(!company)return res.status(404).json({ok:false,error:'Empresa no encontrada.'});
  const status=await migrateGastroStep(pool,company,req.body||{},(operation,payload)=>postBridge(company,operation,payload,req.session?.sub||'PANEL_V5'));
  res.json({ok:true,...status});
 }catch(err){res.status(400).json({ok:false,error:String(err.message||err)});}
});

app.get('/api/company/:companyId/gastro/settings',authRequired,async(req,res)=>{
  try{
    const company=await getCompany(req.params.companyId);if(!company)throw new Error('Empresa no encontrada.');
    const row=await ensureSettings(company);res.json({ok:true,...row.settings,settingsRevision:row.revision});
  }catch(err){res.status(503).json({ok:false,error:String(err.message||err)});}
});
for(const [path,operation] of [
 ['config','config'],['payment','payment'],['payment/:id/toggle','payment/toggle'],
 ['zone','zone'],['zone/:id/delete','zone/delete'],['menu/config','menu/config'],
 ['menu/upload','menu/upload'],['menu/:id/toggle','menu/toggle'],
 ['menu/:id/move','menu/move'],['menu/:id/delete','menu/delete']]){
 app.post('/api/company/:companyId/gastro/'+path,authRequired,canEditGastro,async(req,res)=>{
  try{
   const company=await getCompany(req.params.companyId);if(!company)throw new Error('Empresa no encontrada.');
   await ensureSettings(company);
   const row=await changeSettings(pool,company,operation,req.body||{},req.params.id||'');
   res.json({ok:true,...row.settings,settingsRevision:row.revision});
  }catch(err){res.status(400).json({ok:false,error:String(err.message||err)});}
 });
}
app.get('/api/company/:companyId/gastro/menu/:id/preview',authRequired,async(req,res)=>{
 try{
  const company=await getCompany(req.params.companyId);if(!company)throw new Error('Empresa no encontrada.');
  await ensureSettings(company);
  const file=await getMenuFile(pool,company,req.params.id,id=>postBridge(company,'gastro_menu_preview',{idImagen:id}));
  res.set('Cache-Control','no-store');res.json({ok:true,dataUrl:`data:${file.mime};base64,${file.base64}`});
 }catch(err){res.status(400).json({ok:false,error:String(err.message||err)});}
});


app.get(
  "/api/company/:companyId/pedidos",
  authRequired,
  async (req, res) => {
    try {
      const items = await listDirectOrders(
        req.params.companyId,
        req.query.filter || "ACTIVOS"
      );

      return res.json({
        ok: true,
        source: "POSTGRES_DIRECT",
        items,
        total: items.length,
        generatedAt: new Date().toISOString()
      });
    } catch (err) {
      return res.status(500).json({
        ok: false,
        error: String(err?.message || err)
      });
    }
  }
);

app.post(
  "/api/company/:companyId/pedidos/:orderId/action",
  authRequired,
  async (req, res) => {
    try {
      const company =
        await getCompany(
          req.params.companyId
        );

      if (!company) {
        return res.status(404).json({
          ok: false,
          error: "Empresa no encontrada."
        });
      }

      const result =
        await updateDirectOrderAction(
          req.params.companyId,
          req.params.orderId,
          req.body?.action,
          req.session?.sub || "PANEL_V5",
          req.body?.notes || ""
        );

      if(result.changed && ['CONFIRMAR_PAGO','RECHAZAR_PAGO','CANCELADO'].includes(String(req.body?.action||''))) {
        await pool.query(`UPDATE panel_receipts SET state=$3,reviewed_by=$4,reviewed_at=NOW(),updated_at=NOW()
          WHERE company_id=$1 AND order_id=$2 AND state='PENDIENTE'`,
          [req.params.companyId,req.params.orderId,req.body.action==='CONFIRMAR_PAGO'?'CERRADO_PAGO':'ARCHIVADO',req.session?.sub||'PANEL']);
      }
      let notification = {
        sent: false,
        reason: "SIN_CAMBIOS"
      };

      if (result.changed) {
        const action =
          String(req.body?.action || "")
            .toUpperCase();

        const actionsWithMessage =
          new Set([
            "CONFIRMAR_PAGO",
            "RECHAZAR_PAGO",
            "PREPARANDO",
            "LISTO_RETIRO",
            "EN_CAMINO",
            "ENTREGADO",
            "CANCELADO"
          ]);

        if (actionsWithMessage.has(action)) {
          try {
            notification = await postMotor(
              "/admin/panel/order-status",
              {
                companyId: req.params.companyId,
                phoneNumberId:
                  result.order.phoneNumberId ||
                  company.phone_number_id,
                action,
                order: result.order
              }
            );
          } catch (err) {
            notification = {
              sent: false,
              warning: String(err?.message || err)
            };
          }
        }
      }

      return res.json({
        ok: true,
        ...result,
        notification
      });
    } catch (err) {
      return res.status(400).json({
        ok: false,
        error: String(err?.message || err)
      });
    }
  }
);

app.get(
  "/api/company/:companyId/deliveryQuotes",
  authRequired,
  async (req, res) => {
    try {
      const items =
        await listDirectDeliveryQuotes(
          req.params.companyId
        );

      return res.json({
        ok: true,
        source: "POSTGRES_DIRECT",
        items,
        total: items.length,
        generatedAt: new Date().toISOString()
      });
    } catch (err) {
      return res.status(500).json({
        ok: false,
        error: String(err?.message || err)
      });
    }
  }
);

app.post(
  "/api/company/:companyId/deliveryQuotes/:quoteId/quote",
  authRequired,
  async (req, res) => {
    try {
      const company =
        await getCompany(
          req.params.companyId
        );

      if (!company) {
        return res.status(404).json({
          ok: false,
          error: "Empresa no encontrada."
        });
      }

      const quote =
        await getDirectDeliveryQuote(
          req.params.companyId,
          req.params.quoteId
        );

      if (!quote) {
        return res.status(404).json({
          ok: false,
          error: "Cotización no encontrada."
        });
      }

      if (
        String(quote.estado || "")
          .toUpperCase() !== "PENDIENTE"
      ) {
        return res.json({
          ok: true,
          changed: false,
          quote
        });
      }

      const cost = Number(req.body?.cost);

      if (!Number.isFinite(cost) || cost < 0) {
        return res.status(400).json({
          ok: false,
          error: "Ingresá un costo de delivery válido."
        });
      }

      const motor = await postMotor(
        "/admin/delivery-quote",
        {
          phoneNumberId:
            quote.phoneNumberId ||
            company.phone_number_id,
          waId: quote.waId,
          quoteId: quote.idCotizacion,
          cost,
          pedido: quote.pedidoJson
        }
      );

      const updated =
        await markDirectDeliveryQuoteQuoted(
          req.params.companyId,
          req.params.quoteId,
          cost,
          req.session?.sub || "PANEL_V5",
          motor?.pedido || null
        );

      return res.json({
        ok: true,
        changed: true,
        quote: updated,
        motor
      });
    } catch (err) {
      return res.status(400).json({
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
      setHeaders(res,filePath){if(/\.(html|js)$/.test(filePath))res.setHeader('Cache-Control','no-cache');},
      maxAge:
        process.env.NODE_ENV === "production"
          ? "10m"
          : 0
    }
  )
);

app.get(/\.js$/, (_req,res)=>res.status(404).type('text/plain').send('Archivo JavaScript ausente. Revisá la carga completa del panel V583.'));
app.get("/{*splat}", (_req, res) => {
  res.sendFile(
    path.join(__dirname, "..", "public", "index.html")
  );
});

await initDb();
await initHealthDemo(pool);
await initEvents(pool);
await initPayments(pool);
let paymentFlushBusy=false;
setInterval(async()=>{if(paymentFlushBusy)return;paymentFlushBusy=true;try{await flushPaymentNotifications(pool,body=>postMotor('/admin/panel/payment-notice',body));}finally{paymentFlushBusy=false;}},30000).unref();

app.listen(PORT, () => {
  console.log(
    `DLL ONE Panel Cloud V5.8.5 escuchando en puerto ${PORT}`
  );
});
