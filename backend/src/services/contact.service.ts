import { contactRepository } from "../repositories/contact.repository.ts";
import { NotFoundError } from "../lib/errors.ts";
import { sendMail, buildContactConfirmationEmail } from "../lib/mailer.ts";
import { logger } from "../lib/logger.ts";

export const contactService = {
    async createSubmission(data: {
        name: string;
        email: string;
        subject: string;
        message: string;
    }) {
        const submission = await contactRepository.create(data);

        // Send confirmation email (don't block the response on failure)
        sendMail({
            to: data.email,
            subject: "We received your message — Pushable",
            html: buildContactConfirmationEmail(data.name, data.subject, data.message),
        }).catch((err) => {
            logger.error(`Failed to send contact confirmation email: ${err}`);
        });

        return submission;
    },

    async getSubmissions() {
        return contactRepository.findAll();
    },

    async getSubmission(id: string) {
        const submission = await contactRepository.findById(id);
        if (!submission) throw new NotFoundError("Contact submission not found");
        return submission;
    },

    async updateSubmissionStatus(id: string, status: string, notes?: string) {
        const submission = await contactRepository.findById(id);
        if (!submission) throw new NotFoundError("Contact submission not found");
        return contactRepository.updateStatus(id, { status, notes });
    },

    async deleteSubmission(id: string) {
        const submission = await contactRepository.findById(id);
        if (!submission) throw new NotFoundError("Contact submission not found");
        await contactRepository.delete(id);
    },
};
