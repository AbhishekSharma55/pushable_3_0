import type { Metadata } from "next";
import PageShell from "@/components/PageShell";

export const metadata: Metadata = {
  title: "Privacy Policy — Pushable.ai",
  description:
    "Learn how Pushable.ai collects, uses, and protects your data. Your privacy and security are our top priority.",
};

export default function PrivacyPage() {
  return (
    <PageShell>
      <div className="page-header">
        <div className="ey rev">Legal</div>
        <h1 className="rev d1">Privacy Policy</h1>
        <p className="page-date rev d2">
          Effective date: January 1, 2026 &middot; Last updated: March 1, 2026
        </p>
      </div>

      <div className="prose rev">
        <p>
          At Pushable.ai, we are committed to protecting your privacy and
          ensuring the security of your personal information. This Privacy Policy
          explains how we collect, use, disclose, and safeguard your information
          when you use our AI employee platform and related services.
        </p>

        <h2>1. Information We Collect</h2>

        <h3>Account Information</h3>
        <p>
          When you create an account, we collect your name, email address, and
          password. Passwords are securely hashed using bcrypt and are never
          stored in plaintext.
        </p>

        <h3>Workspace &amp; Team Data</h3>
        <p>
          We collect information about workspaces you create or join, including
          workspace names, team member details, and role assignments (Owner,
          Admin, Member).
        </p>

        <h3>Agent Configuration Data</h3>
        <p>
          When you configure AI agents, we store agent names, system prompts,
          model preferences, execution permissions, and workflow configurations.
          This data is necessary to operate your agents as configured.
        </p>

        <h3>Usage &amp; Activity Data</h3>
        <ul>
          <li>
            Messages exchanged between you and your AI agents, including token
            counts for credit calculation
          </li>
          <li>
            Credit consumption records, including task type, credits deducted,
            and model information
          </li>
          <li>Session history and agent execution logs</li>
          <li>
            Browser session metadata (session IDs, task identifiers, status)
          </li>
        </ul>

        <h3>Integration Data</h3>
        <p>
          When you connect third-party services (such as Slack, HubSpot, Gmail,
          or Notion), we store OAuth tokens necessary to maintain those
          connections. These tokens are encrypted at rest using AES-256-GCM
          encryption.
        </p>

        <h3>Knowledge Base Data</h3>
        <p>
          Documents you upload to agent knowledge bases are stored along with
          generated embeddings to enable intelligent search and retrieval by your
          agents.
        </p>

        <h2>2. How We Use Your Information</h2>
        <ul>
          <li>
            <strong>Service Delivery:</strong> To operate AI agents, process
            tasks, and provide the core platform functionality
          </li>
          <li>
            <strong>Billing &amp; Credits:</strong> To track credit consumption,
            process payments, and manage subscription plans
          </li>
          <li>
            <strong>Security:</strong> To detect and prevent unauthorized access,
            fraud, and abuse of the platform
          </li>
          <li>
            <strong>Support:</strong> To respond to your inquiries, troubleshoot
            issues, and provide technical assistance
          </li>
          <li>
            <strong>Platform Improvement:</strong> To analyze usage patterns and
            improve our services (using aggregated, anonymized data only)
          </li>
        </ul>

        <h2>3. Data Security</h2>
        <p>
          We implement industry-leading security measures to protect your data:
        </p>
        <ul>
          <li>
            <strong>Encryption in Transit:</strong> All data transmitted to and
            from our platform is encrypted using TLS 1.3
          </li>
          <li>
            <strong>Encryption at Rest:</strong> Sensitive data including
            integration credentials and vault connections are encrypted using
            AES-256-GCM
          </li>
          <li>
            <strong>Isolated Sandboxes:</strong> Each AI agent runs in an
            isolated sandbox environment with restricted access to prevent
            cross-contamination
          </li>
          <li>
            <strong>Vault Security:</strong> Master passwords for credential
            vaults are never stored — they are only used during one-time
            connection setup. All vault access is logged in audit trails (actual
            credential values are never logged)
          </li>
          <li>
            <strong>Access Controls:</strong> Role-based access control (Owner,
            Admin, Member) ensures team members only access what they need
          </li>
        </ul>

        <h2>4. Data Sharing &amp; Third-Party Services</h2>
        <p>We may share data with the following categories of service providers:</p>
        <ul>
          <li>
            <strong>AI Model Providers</strong> (such as Anthropic and OpenAI) —
            Your agent prompts and messages are processed by AI models to
            generate responses. These providers do not retain your data for
            training purposes.
          </li>
          <li>
            <strong>Integration Platforms</strong> — When you connect third-party
            services, data is exchanged as necessary to fulfill your configured
            workflows.
          </li>
        </ul>
        <p>
          <strong>
            We never sell your personal data. We never use your data to train AI
            models.
          </strong>
        </p>

        <h2>5. Data Retention</h2>
        <p>
          We retain your data for as long as your account is active and as needed
          to provide our services. Upon account deletion, we will delete your
          personal data within 30 days, except where retention is required by law
          or for legitimate business purposes (such as billing records).
        </p>

        <h2>6. Your Rights</h2>
        <p>
          Depending on your jurisdiction, you may have the following rights:
        </p>
        <ul>
          <li>
            <strong>Access:</strong> Request a copy of the personal data we hold
            about you
          </li>
          <li>
            <strong>Correction:</strong> Request correction of inaccurate or
            incomplete data
          </li>
          <li>
            <strong>Deletion:</strong> Request deletion of your personal data
          </li>
          <li>
            <strong>Data Portability:</strong> Receive your data in a structured,
            machine-readable format
          </li>
          <li>
            <strong>Opt-Out:</strong> Opt out of non-essential data processing
            and marketing communications
          </li>
        </ul>
        <p>
          To exercise any of these rights, contact us at{" "}
          <a href="mailto:privacy@pushable.ai">privacy@pushable.ai</a>.
        </p>

        <h2>7. Cookies</h2>
        <p>
          We use minimal cookies strictly necessary for session management and
          authentication. We do not use third-party tracking cookies or
          advertising cookies.
        </p>

        <h2>8. Children&apos;s Privacy</h2>
        <p>
          Pushable.ai is not intended for use by individuals under the age of
          18. We do not knowingly collect personal information from children. If
          we become aware that we have collected data from a child, we will take
          steps to delete it promptly.
        </p>

        <h2>9. International Data Transfers</h2>
        <p>
          Your data may be processed in countries outside your jurisdiction. We
          ensure appropriate safeguards are in place for international data
          transfers, including standard contractual clauses where applicable.
          Enterprise customers may opt for on-premise deployment to keep data
          within their own infrastructure.
        </p>

        <h2>10. Changes to This Policy</h2>
        <p>
          We may update this Privacy Policy from time to time. When we make
          material changes, we will notify you via email or through a prominent
          notice on our platform. Your continued use of Pushable.ai after
          changes take effect constitutes acceptance of the updated policy.
        </p>

        <h2>11. Contact Us</h2>
        <p>
          If you have questions about this Privacy Policy or our data practices,
          contact us at:
        </p>
        <ul>
          <li>
            Email: <a href="mailto:privacy@pushable.ai">privacy@pushable.ai</a>
          </li>
          <li>
            General inquiries:{" "}
            <a href="/contact">Contact page</a>
          </li>
        </ul>
      </div>
    </PageShell>
  );
}
