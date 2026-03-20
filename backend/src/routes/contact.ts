import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { contactService } from "../services/contact.service.ts";
import { AppError, UnauthorizedError } from "../lib/errors.ts";

const createContactSchema = z.object({
    name: z.string().min(1, "Name is required"),
    email: z.string().email("Valid email is required"),
    subject: z.enum(["general", "sales", "support", "partnership"]),
    message: z.string().min(1, "Message is required"),
});

const updateStatusSchema = z.object({
    status: z.enum(["new", "read", "replied", "archived"]),
    notes: z.string().optional(),
});

export async function contactRoutes(fastify: FastifyInstance) {
    // ── Public route (no auth) ──────────────────────────────

    // POST /public/contact — submit contact form
    fastify.post("/public/contact", async (request, reply) => {
        const body = createContactSchema.parse(request.body);
        const submission = await contactService.createSubmission(body);
        return reply.status(201).send({ data: submission });
    });

    // ── Authenticated routes (admin management) ─────────────

    fastify.register(async function authenticatedRoutes(app) {
        app.addHook("onRequest", async (request) => {
            try {
                await request.jwtVerify();
            } catch {
                throw new UnauthorizedError("Invalid or expired token");
            }
        });

        // GET /contact-submissions
        app.get("/contact-submissions", async () => {
            const submissions = await contactService.getSubmissions();
            return { data: submissions };
        });

        // GET /contact-submissions/:id
        app.get("/contact-submissions/:id", async (request) => {
            const { id } = request.params as { id: string };
            const submission = await contactService.getSubmission(id);
            return { data: submission };
        });

        // PATCH /contact-submissions/:id/status
        app.patch("/contact-submissions/:id/status", async (request) => {
            const { id } = request.params as { id: string };
            const body = updateStatusSchema.parse(request.body);
            const submission = await contactService.updateSubmissionStatus(
                id,
                body.status,
                body.notes
            );
            return { data: submission };
        });

        // DELETE /contact-submissions/:id
        app.delete("/contact-submissions/:id", async (request, reply) => {
            const { id } = request.params as { id: string };
            await contactService.deleteSubmission(id);
            return reply.status(204).send();
        });
    });
}
