import type { Metadata } from "next";
import PageShell from "@/components/PageShell";

export const metadata: Metadata = {
  title: "Terms of Service — Pushable.ai",
  description:
    "Read the Pushable.ai Terms of Service covering account usage, credit system, billing, and platform policies.",
};

export default function TermsPage() {
  return (
    <PageShell>
      <div className="page-header">
        <div className="ey rev">Legal</div>
        <h1 className="rev d1">Terms of Service</h1>
        <p className="page-date rev d2">
          Effective date: January 1, 2026 &middot; Last updated: March 1, 2026
        </p>
      </div>

      <div className="prose rev">
        <p>
          Welcome to Pushable.ai. These Terms of Service (&quot;Terms&quot;)
          govern your access to and use of the Pushable.ai platform, including
          all AI agents, APIs, and related services. By creating an account or
          using our platform, you agree to be bound by these Terms.
        </p>

        <h2>1. Description of Service</h2>
        <p>
          Pushable.ai is an AI employee platform that enables businesses to
          deploy autonomous AI agents for customer support, sales, research,
          human resources, finance, and code review. The platform operates on a
          credit-based billing model where credits are consumed based on the
          complexity and volume of tasks performed by your agents.
        </p>

        <h2>2. Account Registration</h2>
        <ul>
          <li>
            You must provide accurate and complete information when creating an
            account, including a valid name and email address
          </li>
          <li>
            Passwords must be at least 8 characters in length. You are
            responsible for maintaining the confidentiality of your account
            credentials
          </li>
          <li>
            You are responsible for all activity that occurs under your account.
            Notify us immediately if you suspect unauthorized access
          </li>
          <li>
            You must be at least 18 years of age to create an account and use
            the platform
          </li>
        </ul>

        <h2>3. Workspaces &amp; Teams</h2>
        <p>
          Pushable.ai supports multi-workspace environments with role-based
          access control:
        </p>
        <ul>
          <li>
            <strong>Owner:</strong> Full control over the workspace, billing,
            agents, and team management
          </li>
          <li>
            <strong>Admin:</strong> Can manage agents, integrations, and team
            members within the workspace
          </li>
          <li>
            <strong>Member:</strong> Can interact with agents and view workspace
            resources as permitted
          </li>
        </ul>
        <p>
          Workspace owners are responsible for the actions of all team members
          within their workspace, including credit consumption and data handling.
        </p>

        <h2>4. Credit System &amp; Billing</h2>
        <h3>How Credits Work</h3>
        <p>
          Credits are the unit of compute consumed by your AI agents. Credits are
          deducted based on task complexity:
        </p>
        <ul>
          <li>
            Simple tasks (e.g., replying to an FAQ): approximately 0.5 credits
          </li>
          <li>
            Moderate tasks (e.g., drafting outreach emails): approximately 2–6
            credits
          </li>
          <li>
            Complex tasks (e.g., research reports): approximately 5–15 credits
          </li>
        </ul>
        <p>
          Credits are consumed for: chat messages, task runs, workflow steps,
          knowledge base operations, browser automation actions, scheduled runs,
          and agent delegation.
        </p>

        <h3>Subscription Plans</h3>
        <ul>
          <li>
            <strong>Starter (Free):</strong> 100 credits per month, 2 active
            agents, Support and Research agents only. Credits reset monthly.
          </li>
          <li>
            <strong>Growth ($49/month or $39/month billed annually):</strong>{" "}
            2,000 credits per month with rollover, all 6 agent types, priority
            support, advanced analytics, custom workflows.
          </li>
          <li>
            <strong>Enterprise (Custom pricing):</strong> Unlimited credits,
            custom AI agents, SSO/SAML, 99.9% SLA, dedicated success manager,
            on-premise deployment option.
          </li>
        </ul>

        <h3>Rollover &amp; Top-Ups</h3>
        <p>
          On Growth and Enterprise plans, unused credits roll over to the next
          billing period indefinitely. Starter plan credits reset each month.
          Additional credit packs can be purchased at any time from your
          dashboard.
        </p>

        <h3>Refunds</h3>
        <p>
          Credits are non-refundable except in cases of verified billing errors.
          If you believe you have been charged incorrectly, contact our support
          team within 30 days of the charge.
        </p>

        <h2>5. Acceptable Use</h2>
        <p>You agree not to use the Pushable.ai platform to:</p>
        <ul>
          <li>
            Engage in any illegal, fraudulent, or harmful activity
          </li>
          <li>
            Abuse AI agent capabilities, including generating spam, harassment,
            or misleading content
          </li>
          <li>
            Attempt to reverse engineer, decompile, or extract source code from
            the platform or its AI models
          </li>
          <li>
            Circumvent credit limits, usage caps, or other platform restrictions
          </li>
          <li>
            Interfere with or disrupt the platform, servers, or networks
            connected to the service
          </li>
          <li>
            Use agents to impersonate individuals or organizations without
            authorization
          </li>
          <li>
            Share account credentials with unauthorized third parties
          </li>
        </ul>

        <h2>6. AI Agent Disclaimer</h2>
        <p>
          AI agents are automated systems powered by large language models. While
          we strive for high accuracy and reliability, you acknowledge that:
        </p>
        <ul>
          <li>
            Agents may occasionally produce inaccurate, incomplete, or
            unexpected outputs
          </li>
          <li>
            You are responsible for reviewing agent outputs before acting on
            them, especially for critical business decisions
          </li>
          <li>
            Human escalation is recommended for high-stakes situations including
            legal, financial, and medical contexts
          </li>
          <li>
            Agent performance depends on the quality of your configuration,
            prompts, and training data
          </li>
        </ul>

        <h2>7. Intellectual Property</h2>
        <ul>
          <li>
            <strong>Platform IP:</strong> The Pushable.ai platform, including
            its software, design, branding, and documentation, is the
            intellectual property of Pushable.ai. You may not copy, modify, or
            distribute any part of the platform without our written consent.
          </li>
          <li>
            <strong>Your Data:</strong> You retain full ownership of all data you
            provide to the platform, including documents, messages, and agent
            configurations. We do not claim any ownership over your content.
          </li>
          <li>
            <strong>No Training:</strong> We do not use your data to train or
            improve AI models.
          </li>
        </ul>

        <h2>8. Integrations &amp; Third-Party Services</h2>
        <p>
          When you connect third-party services (such as Slack, HubSpot, Gmail,
          Notion, or credential vaults), you are responsible for:
        </p>
        <ul>
          <li>
            Ensuring you have the authority to connect those services to
            Pushable.ai
          </li>
          <li>
            Complying with the terms of service of those third-party providers
          </li>
          <li>
            Managing and revoking access when team members leave or
            integrations are no longer needed
          </li>
        </ul>
        <p>
          Pushable.ai secures OAuth tokens and credentials with AES-256-GCM
          encryption but is not liable for incidents originating from
          third-party services.
        </p>

        <h2>9. Service Availability</h2>
        <ul>
          <li>
            We target 99.4% uptime for all paid plans and 99.9% uptime for
            Enterprise customers with SLA guarantees
          </li>
          <li>
            Scheduled maintenance windows will be communicated in advance
            whenever possible
          </li>
          <li>
            We are not liable for downtime caused by factors beyond our
            reasonable control, including third-party service outages, network
            failures, or force majeure events
          </li>
        </ul>

        <h2>10. Limitation of Liability</h2>
        <p>
          To the maximum extent permitted by applicable law, Pushable.ai and its
          officers, directors, employees, and affiliates shall not be liable for
          any indirect, incidental, special, consequential, or punitive damages,
          including but not limited to loss of profits, data, or business
          opportunities, arising from your use of or inability to use the
          platform.
        </p>
        <p>
          The platform is provided on an &quot;as-is&quot; and
          &quot;as-available&quot; basis. We make no warranties, express or
          implied, regarding the accuracy, reliability, or completeness of AI
          agent outputs.
        </p>

        <h2>11. Termination</h2>
        <ul>
          <li>
            You may terminate your account at any time from your account settings
          </li>
          <li>
            We may suspend or terminate your account if you violate these Terms,
            engage in abusive behavior, or fail to pay outstanding charges
          </li>
          <li>
            Upon termination, you may request an export of your data within 30
            days. After that period, your data will be permanently deleted
          </li>
          <li>
            Termination does not entitle you to a refund of unused credits
          </li>
        </ul>

        <h2>12. Modifications to These Terms</h2>
        <p>
          We reserve the right to modify these Terms at any time. When we make
          material changes, we will notify you via email or a prominent notice on
          the platform at least 15 days before the changes take effect. Your
          continued use of the platform after the effective date constitutes
          acceptance of the updated Terms.
        </p>

        <h2>13. Governing Law</h2>
        <p>
          These Terms shall be governed by and construed in accordance with the
          laws of the jurisdiction in which Pushable.ai is incorporated, without
          regard to its conflict of laws provisions. Any disputes arising from
          these Terms shall be resolved through binding arbitration in accordance
          with applicable rules.
        </p>

        <h2>14. Contact</h2>
        <p>
          For questions about these Terms of Service, contact us at:
        </p>
        <ul>
          <li>
            Email: <a href="mailto:legal@pushable.ai">legal@pushable.ai</a>
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
