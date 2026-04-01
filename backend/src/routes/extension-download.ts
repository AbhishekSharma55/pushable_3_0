import type { FastifyInstance } from "fastify";
import archiver from "archiver";
import { resolve, join } from "path";
import { existsSync } from "fs";

export async function extensionDownloadRoutes(fastify: FastifyInstance) {
    // Public endpoint — no auth required so users can download the extension
    fastify.get("/extension/download", async (_request, reply) => {
        // Resolve the extension-v4 directory relative to the backend root
        const extensionDir =
            process.env.EXTENSION_DIR ||
            resolve(import.meta.dirname, "../../../extension-v4");

        if (!existsSync(extensionDir)) {
            return reply.status(404).send({
                error: { message: "Extension files not found", code: "NOT_FOUND" },
            });
        }

        reply.header("Content-Type", "application/zip");
        reply.header(
            "Content-Disposition",
            'attachment; filename="Pushable-relay.zip"'
        );

        const archive = archiver("zip", { zlib: { level: 9 } });

        archive.on("error", () => {
            reply.status(500).send({
                error: { message: "Failed to create zip", code: "ARCHIVE_ERROR" },
            });
        });

        // Only include the actual extension files (not README)
        const extensionFiles = [
            "manifest.json",
            "background.js",
            "popup.html",
            "popup.js",
            "content.js",
            "icon16.png",
            "icon48.png",
            "icon128.png",
        ];

        for (const file of extensionFiles) {
            const filePath = join(extensionDir, file);
            if (existsSync(filePath)) {
                archive.file(filePath, { name: file });
            }
        }

        archive.finalize();

        return reply.send(archive);
    });
}
