import jwt from "@fastify/jwt";

export interface JWTPayload {
  userId: string;
  email: string;
}

// sign and verify are handled by @fastify/jwt plugin
// This file exports the type only — use fastify.jwt.sign/verify in routes
