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
import { kbRoutes } from "./routes/kb.ts";
import { skillRoutes } from "./routes/skills.ts";
import { taskRoutes } from "./routes/tasks.ts";
import { workflowRoutes } from "./routes/workflows.ts";
import { scheduleRoutes } from "./routes/schedules.ts";
import { integrationRoutes } from "./routes/integrations.ts";
import { browserRoutes } from "./routes/browser.ts";
import { internalRoutes } from "./routes/internal.ts";
import { vaultRoutes } from "./routes/vault.ts";
import { startWorkers, stopWorkers } from "./lib/workers.ts";
import { initScheduler } from "./lib/scheduler.ts";
import { taskQueue, workflowQueue } from "./lib/queue.ts";

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
await app.register(kbRoutes, { prefix: "/api" });
await app.register(skillRoutes, { prefix: "/api" });
await app.register(taskRoutes, { prefix: "/api" });
await app.register(workflowRoutes, { prefix: "/api" });
await app.register(scheduleRoutes, { prefix: "/api" });
await app.register(integrationRoutes, { prefix: "/api" });
await app.register(browserRoutes, { prefix: "/api" });
await app.register(vaultRoutes, { prefix: "/api" });
await app.register(internalRoutes, { prefix: "/api/internal" });

const port = Number(process.env.PORT) || 4000;
await app.listen({ port, host: "0.0.0.0" });

// Start workers and scheduler after app is ready
startWorkers();
await initScheduler();

logger.info(`Server running on port ${port}`);

// Graceful shutdown
const shutdown = async () => {
  logger.info("Shutting down...");
  await stopWorkers();
  await taskQueue.close();
  await workflowQueue.close();
  await app.close();
  process.exit(0);
};

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
