import {sessionSeconds,sessionAllowed} from "./session_policy.js";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import bcrypt from "bcryptjs";
import { getPanelUserByLogin, getPanelUserById } from "./db.js";

const COOKIE = "dllone_panel_v5";

function secret() {
  const value = String(process.env.JWT_SECRET || "");
  if (value.length < 24) {
    throw new Error("JWT_SECRET debe tener al menos 24 caracteres.");
  }
  return value;
}

function safeTextEqual(a, b) {
  const aa = Buffer.from(String(a || ""));
  const bb = Buffer.from(String(b || ""));

  if (aa.length !== bb.length) return false;
  return crypto.timingSafeEqual(aa, bb);
}

export async function validLogin(user, password) {
  const loginKey = String(user || "").trim();
  const pass = String(password || "");

  if (!loginKey || !pass) return null;

  // Super Admin de emergencia / bootstrap definido en Railway.
  if (
    process.env.PANEL_ADMIN_USER && process.env.PANEL_ADMIN_PASSWORD &&
    safeTextEqual(loginKey, process.env.PANEL_ADMIN_USER) &&
    safeTextEqual(pass, process.env.PANEL_ADMIN_PASSWORD || "")
  ) {
    return {
      userId: 0,
      loginKey,
      displayName: "Super Admin",
      role: "SUPERADMIN",
      source: "ENV"
    };
  }

  const dbUser = await getPanelUserByLogin(loginKey);

  if (!dbUser || !dbUser.active) {
    return null;
  }

  const ok = await bcrypt.compare(
    pass,
    String(dbUser.password_hash || "")
  );

  if (!ok) return null;

  return {
    userId: Number(dbUser.user_id),
    loginKey: dbUser.login_key,
    displayName: dbUser.display_name,
    role: String(dbUser.role || "ADMIN_EMPRESA").toUpperCase(),
    source: "DB"
  };
}

export function issueSession(res, user) {
  const token = jwt.sign(
    {
      policy:2,
      sub: String(user.loginKey || ""),
      uid: Number(user.userId || 0),
      name: String(user.displayName || user.loginKey || "Usuario"),
      role: String(user.role || "ADMIN_EMPRESA").toUpperCase()
    },
    secret(),
    {
      expiresIn: sessionSeconds(),
      issuer: "DLL ONE Panel V5"
    }
  );

  res.cookie(
    COOKIE,
    token,
    {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production"
    }
  );
}

export function clearSession(res) {
  res.clearCookie(COOKIE);
}

const verifiedRequest = Symbol("verifiedPanelSession");

export async function authRequired(req, res, next) {
  // El middleware se usa también en rutas bajo el control global de empresa.
  if (req[verifiedRequest]) return next();
  const token = req.cookies?.[COOKIE];

  if (!token) {
    return res.status(401).json({
      ok: false,
      error: "NO_AUTH"
    });
  }

  try {
    req.session = jwt.verify(
      token,
      secret(),
      {
        issuer: "DLL ONE Panel V5"
      }
    );
    if(!sessionAllowed(req.session))throw Error("SESSION_EXPIRED");
    const uid = req.session.uid;
    if (!Number.isSafeInteger(uid) || uid < 0) throw Error("SESSION_EXPIRED");
    if (uid === 0) {
      if (!process.env.PANEL_ADMIN_USER || !process.env.PANEL_ADMIN_PASSWORD ||
          req.session.role !== "SUPERADMIN" ||
          !safeTextEqual(req.session.sub, process.env.PANEL_ADMIN_USER)) {
        throw Error("SESSION_EXPIRED");
      }
    } else {
      const current = await getPanelUserById(uid);
      if (!current?.active || current.login_key !== req.session.sub ||
          String(current.role || "").toUpperCase() !== req.session.role) {
        throw Error("SESSION_EXPIRED");
      }
    }
    req[verifiedRequest] = true;
    return next();
  } catch {
    return res.status(401).json({
      ok: false,
      error: "SESSION_EXPIRED"
    });
  }
}
