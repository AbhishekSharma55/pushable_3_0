import "dotenv/config";
import Fastify from "fastify";
import cors from "@fastify/cors";
import jwtPlugin from "@fastify/jwt";
import multipart from "@fastify/multipart";
import { logger } from "./lib/logger.ts";
import { AppError } from "./lib/errors.ts";
import { authRoutes } from "./routes/auth.ts";
import { workspaceRoutes } from "./routes/workspaces.ts";
import { agentRoutes } from "./routes/agents.ts";
import { sessionRoutes } from "./routes/sessions.ts";
import { chatRoutes } from "./routes/chat.ts";
import { llmRoutes } from "./routes/llm.ts";
import { toolRoutes } from "./routes/tools.ts";
import { permissionRoutes } from "./routes/permissions.ts";

const app = Fastify({ logger: false });

// Plugins
await app.register(cors, {
  origin: true,
  methods: ["GET", "PUT", "POST", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "x-workspace-id"],
});
await app.register(jwtPlugin, { secret: process.env.JWT_SECRET! });
await app.register(multipart);

// Error handler
app.setErrorHandler((err, _req, reply) => {
  const error = err as any;
  logger.error(error);

  // Handle Zod validation errors
  if (error.name === "ZodError") {
    return reply.status(400).send({
      error: {
        message: "Validation failed",
        code: "VALIDATION_ERROR",
        details: (error as any).issues,
      },
    });
  }

  if (error instanceof AppError) {
    return reply.status(error.statusCode).send({
      error: { message: error.message, code: error.code },
    });
  }

  return reply.status(500).send({
    error: { message: "Internal server error", code: "INTERNAL_ERROR" },
  });
});

// Health check
app.get("/health", async () => ({ status: "ok" }));

// Routes
await app.register(authRoutes, { prefix: "/api" });
await app.register(workspaceRoutes, { prefix: "/api" });
await app.register(agentRoutes, { prefix: "/api" });
await app.register(sessionRoutes, { prefix: "/api" });
await app.register(chatRoutes, { prefix: "/api" });
await app.register(llmRoutes, { prefix: "/api" });
await app.register(toolRoutes, { prefix: "/api" });
await app.register(permissionRoutes, { prefix: "/api" });

const port = Number(process.env.PORT) || 4000;
await app.listen({ port, host: "0.0.0.0" });
logger.info(`Server running on port ${port}`);
