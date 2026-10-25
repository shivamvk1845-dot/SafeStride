import { createHmac, timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { config } from "./config.js";

const cookieName = "safestride_session";
type Session = { sub: string; exp: number };

function sign(payload: string): string {
  return createHmac("sha256", config.jwtSecret).update(payload).digest("base64url");
}

export function createSession(userId: string): string {
  const payload = Buffer.from(JSON.stringify({
    sub: userId,
    exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 7,
  })).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

export function verifySession(token?: string): Session | undefined {
  if (!token) return undefined;
  const [payload, signature, extra] = token.split(".");
  if (!payload || !signature || extra) return undefined;
  const expected = Buffer.from(sign(payload));
  const actual = Buffer.from(signature);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return undefined;
  try {
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString()) as Session;
    return decoded.sub && decoded.exp > Date.now() / 1000 ? decoded : undefined;
  } catch {
    return undefined;
  }
}

declare global {
  namespace Express {
    interface Request {
      userId?: string;
    }
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const session = verifySession(req.cookies?.[cookieName]);
  if (!session) {
    res.status(401).json({ error: "Please sign in to continue." });
    return;
  }
  req.userId = session.sub;
  next();
}

export function setSessionCookie(res: Response, userId: string): void {
  res.cookie(cookieName, createSession(userId), {
    httpOnly: true,
    sameSite: "strict",
    secure: config.production,
    path: "/",
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(cookieName, { httpOnly: true, sameSite: "strict", secure: config.production, path: "/" });
}
