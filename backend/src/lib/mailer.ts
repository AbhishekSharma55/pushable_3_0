import nodemailer from "nodemailer";
import { logger } from "./logger.ts";

const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT) || 587,
    secure: process.env.SMTP_SECURE === "true",
    auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASSWORD,
    },
});

export async function sendMail(options: {
    to: string;
    subject: string;
    html: string;
}) {
    try {
        await transporter.sendMail({
            from: process.env.SMTP_FROM || process.env.SMTP_USER,
            to: options.to,
            subject: options.subject,
            html: options.html,
        });
        logger.info(`Email sent to ${options.to}`);
    } catch (err) {
        logger.error(`Failed to send email to ${options.to}: ${err}`);
        throw err;
    }
}

/**
 * Send a reply email with proper threading headers (In-Reply-To, References).
 * Used by the email channel to reply to inbound emails.
 */
export async function sendReplyMail(options: {
    to: string;
    subject: string;
    text?: string;
    html: string;
    from: string;
    fromName?: string;
    inReplyTo?: string;
    references?: string;
}) {
    const fromField = options.fromName
        ? `"${options.fromName}" <${options.from}>`
        : options.from;

    const subject = options.subject.startsWith("Re: ")
        ? options.subject
        : `Re: ${options.subject}`;

    const headers: Record<string, string> = {};
    if (options.inReplyTo) {
        headers["In-Reply-To"] = options.inReplyTo;
    }
    if (options.references) {
        headers["References"] = options.references;
    }

    try {
        await transporter.sendMail({
            from: fromField,
            replyTo: options.from,
            to: options.to,
            subject,
            text: options.text,
            html: options.html,
            headers,
        });
        logger.info(`Reply email sent to ${options.to}`);
    } catch (err) {
        logger.error(`Failed to send reply email to ${options.to}: ${err}`);
        throw err;
    }
}

export function buildInvitationEmail(
    workspaceName: string,
    inviterName: string,
    role: string,
    inviteLink: string
): string {
    return `
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
</head>
<body style="margin:0;padding:0;background:#0a0a0a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0a;padding:40px 20px;">
        <tr>
            <td align="center">
                <table width="600" cellpadding="0" cellspacing="0" style="background:#141414;border:1px solid #222;border-radius:12px;overflow:hidden;">
                    <!-- Header -->
                    <tr>
                        <td style="padding:32px 40px;border-bottom:1px solid #222;">
                            <h1 style="margin:0;font-size:20px;font-weight:700;color:#ffffff;">Pushable</h1>
                        </td>
                    </tr>
                    <!-- Body -->
                    <tr>
                        <td style="padding:40px;">
                            <h2 style="margin:0 0 16px;font-size:22px;color:#ffffff;">You've been invited!</h2>
                            <p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#a0a0a0;">
                                <strong style="color:#ccc;">${inviterName}</strong> has invited you to join
                                <strong style="color:#ccc;">${workspaceName}</strong> as a <strong style="color:#ccc;">${role}</strong> on Pushable.
                            </p>

                            <!-- Invite button -->
                            <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
                                <tr>
                                    <td align="center">
                                        <a href="${inviteLink}" style="display:inline-block;padding:14px 32px;background:#3b82f6;color:#ffffff;font-size:15px;font-weight:600;text-decoration:none;border-radius:8px;">
                                            Accept Invitation
                                        </a>
                                    </td>
                                </tr>
                            </table>

                            <p style="margin:0 0 16px;font-size:13px;line-height:1.6;color:#666;">
                                This invitation will expire in 7 days. If you don't have a Pushable account yet,
                                you'll be prompted to create one when you click the link.
                            </p>

                            <!-- Link fallback -->
                            <table width="100%" cellpadding="0" cellspacing="0" style="background:#1a1a1a;border:1px solid #2a2a2a;border-radius:8px;">
                                <tr>
                                    <td style="padding:16px;">
                                        <p style="margin:0 0 8px;font-size:12px;color:#666;">If the button doesn't work, copy and paste this link:</p>
                                        <p style="margin:0;font-size:12px;color:#3b82f6;word-break:break-all;">${inviteLink}</p>
                                    </td>
                                </tr>
                            </table>
                        </td>
                    </tr>
                    <!-- Footer -->
                    <tr>
                        <td style="padding:24px 40px;border-top:1px solid #222;">
                            <p style="margin:0;font-size:12px;color:#555;">
                                &copy; ${new Date().getFullYear()} Pushable. All rights reserved.
                            </p>
                        </td>
                    </tr>
                </table>
            </td>
        </tr>
    </table>
</body>
</html>`;
}

export function buildContactConfirmationEmail(name: string, subject: string, message: string): string {
    const subjectLabels: Record<string, string> = {
        general: "General Inquiry",
        sales: "Sales & Enterprise",
        support: "Technical Support",
        partnership: "Partnerships",
    };

    return `
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
</head>
<body style="margin:0;padding:0;background:#0a0a0a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0a;padding:40px 20px;">
        <tr>
            <td align="center">
                <table width="600" cellpadding="0" cellspacing="0" style="background:#141414;border:1px solid #222;border-radius:12px;overflow:hidden;">
                    <!-- Header -->
                    <tr>
                        <td style="padding:32px 40px;border-bottom:1px solid #222;">
                            <h1 style="margin:0;font-size:20px;font-weight:700;color:#ffffff;">Pushable</h1>
                        </td>
                    </tr>
                    <!-- Body -->
                    <tr>
                        <td style="padding:40px;">
                            <h2 style="margin:0 0 16px;font-size:22px;color:#ffffff;">Thanks for reaching out, ${name}!</h2>
                            <p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#a0a0a0;">
                                We've received your message and our team will get back to you within 24 hours.
                            </p>

                            <!-- Summary card -->
                            <table width="100%" cellpadding="0" cellspacing="0" style="background:#1a1a1a;border:1px solid #2a2a2a;border-radius:8px;margin-bottom:24px;">
                                <tr>
                                    <td style="padding:24px;">
                                        <p style="margin:0 0 12px;font-size:13px;color:#666;text-transform:uppercase;letter-spacing:0.5px;">Your message summary</p>
                                        <p style="margin:0 0 8px;font-size:14px;color:#a0a0a0;">
                                            <strong style="color:#ccc;">Subject:</strong> ${subjectLabels[subject] || subject}
                                        </p>
                                        <p style="margin:0;font-size:14px;color:#a0a0a0;line-height:1.5;">
                                            <strong style="color:#ccc;">Message:</strong> ${message.length > 300 ? message.substring(0, 300) + "..." : message}
                                        </p>
                                    </td>
                                </tr>
                            </table>

                            <p style="margin:0;font-size:14px;line-height:1.6;color:#666;">
                                If you need immediate assistance, you can reply directly to this email.
                            </p>
                        </td>
                    </tr>
                    <!-- Footer -->
                    <tr>
                        <td style="padding:24px 40px;border-top:1px solid #222;">
                            <p style="margin:0;font-size:12px;color:#555;">
                                &copy; ${new Date().getFullYear()} Pushable. All rights reserved.
                            </p>
                        </td>
                    </tr>
                </table>
            </td>
        </tr>
    </table>
</body>
</html>`;
}
