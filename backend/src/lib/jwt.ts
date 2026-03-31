import jwt from "@fastify/jwt";
import { createHmac } from "crypto";

export interface JWTPayload {
  userId: string;
  email: string;
}

// sign and verify are handled by @fastify/jwt plugin
// This file exports the type only — use fastify.jwt.sign/verify in routes

/**
 * Sign a short-lived internal JWT for service-to-service calls
 * (e.g. Python sandbox → backend API). Uses the same JWT_SECRET
 * as the Fastify JWT plugin so the backend can verify it.
 *
 * Uses Node built-in crypto (no external deps) to produce an
 * HS256 JWT compatible with @fastify/jwt verification.
 */
export function signInternalToken(payload: {
  userId: string;
  email?: string;
  workspaceId?: string;
}, expiresInMs: number = 60_000): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET not set");

  const header = { alg: "HS256", typ: "JWT" };
  const now = Math.floor(Date.now() / 1000);
  const claims = {
    userId: payload.userId,
    email: payload.email || "internal@pushable.ai",
    _internal: true,
    iat: now,
    exp: now + Math.floor(expiresInMs / 1000),
  };

  const b64url = (obj: unknown) =>
    Buffer.from(JSON.stringify(obj)).toString("base64url");

  const headerB64 = b64url(header);
  const payloadB64 = b64url(claims);
  const signature = createHmac("sha256", secret)
    .update(`${headerB64}.${payloadB64}`)
    .digest("base64url");

  return `${headerB64}.${payloadB64}.${signature}`;
}
