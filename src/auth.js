import jwt from "jsonwebtoken";
import crypto from "crypto";

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

export function validLogin(user, password) {
  return (
    safeTextEqual(
      user,
      process.env.PANEL_ADMIN_USER || ""
    ) &&
    safeTextEqual(
      password,
      process.env.PANEL_ADMIN_PASSWORD || ""
    )
  );
}

export function issueSession(res, user) {
  const token = jwt.sign(
    {
      sub: String(user),
      role: "SUPERADMIN"
    },
    secret(),
    {
      expiresIn: "12h",
      issuer: "DLL ONE Panel V5"
    }
  );

  res.cookie(
    COOKIE,
    token,
    {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 12 * 60 * 60 * 1000
    }
  );
}

export function clearSession(res) {
  res.clearCookie(COOKIE);
}

export function authRequired(req, res, next) {
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
    next();
  } catch {
    return res.status(401).json({
      ok: false,
      error: "SESSION_EXPIRED"
    });
  }
}
