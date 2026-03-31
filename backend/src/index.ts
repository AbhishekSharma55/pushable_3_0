import "dotenv/config";
import { runMigrations } from "./db/migrate.ts";
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
import { scheduleRoutes } from "./routes/schedules.ts";
import { integrationRoutes } from "./routes/integrations.ts";
import { browserRoutes } from "./routes/browser.ts";
import { internalRoutes } from "./routes/internal.ts";
import { vaultRoutes } from "./routes/vault.ts";
import { browserProxyRoutes } from "./routes/browser-proxies.ts";
import { channelRoutes } from "./routes/channels.ts";
import { bucketRoutes } from "./routes/bucket.ts";
import { webhookRoutes } from "./routes/webhooks.ts";
import { startWorkers, stopWorkers } from "./lib/workers.ts";
import { initScheduler } from "./lib/scheduler.ts";
import { scheduleQueue } from "./lib/queue.ts";
import { channelManager } from "./channels/channel-manager.ts";
import { seedModels } from "./db/seeds/models.seed.ts";
import { seedProxies } from "./db/seeds/proxies.seed.ts";
import { modelRoutes } from "./routes/models.ts";
import { creditRoutes } from "./routes/credits.ts";
import { blogRoutes } from "./routes/blogs.ts";
import { contactRoutes } from "./routes/contact.ts";
import { extensionDownloadRoutes } from "./routes/extension-download.ts";
import { projectRoutes } from "./routes/projects.ts";
import { runReportRoutes } from "./routes/runReports.ts";
import { testingRoutes } from "./routes/testing.ts";
import { workflowRoutes } from "./routes/workflows.ts";
import { browserService } from "./services/browser.service.ts";

const app = Fastify({ logger: false });

// Plugins
await app.register(cors, {
  origin: true,
  credentials: true,
  methods: ["GET", "PUT", "POST", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "x-workspace-id"],
});
await app.register(jwtPlugin, { secret: process.env.JWT_SECRET! });
await app.register(multipart, { limits: { fileSize: 20 * 1024 * 1024, files: 10 } });

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
await app.register(scheduleRoutes, { prefix: "/api" });
await app.register(integrationRoutes, { prefix: "/api" });
await app.register(browserRoutes, { prefix: "/api" });
await app.register(vaultRoutes, { prefix: "/api" });
await app.register(internalRoutes, { prefix: "/api/internal" });
await app.register(browserProxyRoutes, { prefix: "/api" });
await app.register(channelRoutes, { prefix: "/api" });
await app.register(bucketRoutes, { prefix: "/api" });
await app.register(modelRoutes, { prefix: "/api" });
await app.register(creditRoutes, { prefix: "/api" });
await app.register(blogRoutes, { prefix: "/api" });
await app.register(contactRoutes, { prefix: "/api" });
await app.register(extensionDownloadRoutes, { prefix: "/api" });
await app.register(projectRoutes, { prefix: "/api" });
await app.register(runReportRoutes, { prefix: "/api" });
await app.register(testingRoutes, { prefix: "/api" });
await app.register(workflowRoutes, { prefix: "/api" });

// Webhook routes — NO auth, external platforms call these
await app.register(webhookRoutes);

const port = Number(process.env.PORT) || 4000;
await app.listen({ port, host: "0.0.0.0" });

// Clean up stale browser sessions from previous process
await browserService.cleanupStaleSessions();
console.log("Stale browser sessions cleaned up");

// Run DB migrations, seed models, start workers/scheduler
await runMigrations();
await seedModels();
await seedProxies();
startWorkers();
await initScheduler();
await channelManager.initializeAllActive();

logger.info(`Server running on port ${port}`);

// Graceful shutdown
const shutdown = async () => {
  logger.info("Shutting down...");
  await stopWorkers();
  await scheduleQueue.close();
  await app.close();
  process.exit(0);
};

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
