import type { Metadata } from "next";
import PageShell from "@/components/PageShell";

export const metadata: Metadata = {
  title: "Documentation — Pushable.ai",
  description:
    "Get started with Pushable.ai. Guides, API reference, integration docs, and best practices for AI agent deployment.",
};

const gettingStarted = [
  {
    emoji: "🚀",
    title: "Quick Start",
    desc: "Create your account, deploy your first agent, and see results in under 4 minutes.",
    link: "5 min read",
  },
  {
    emoji: "⚙️",
    title: "Agent Configuration",
    desc: "Learn how to configure agents with custom prompts, guardrails, and tone in plain language.",
    link: "8 min read",
  },
  {
    emoji: "💳",
    title: "Understanding Credits",
    desc: "How the credit system works, what tasks cost, and how to optimize your usage.",
    link: "4 min read",
  },
];

const integrations = [
  {
    emoji: "💬",
    title: "Slack Integration",
    desc: "Connect your workspace to Slack for real-time agent notifications and commands.",
    link: "View guide",
  },
  {
    emoji: "📧",
    title: "Gmail & Email",
    desc: "Set up email integrations for Sales and Support agents to send and receive emails.",
    link: "View guide",
  },
  {
    emoji: "📝",
    title: "Notion & Docs",
    desc: "Connect Notion workspaces for Research agents to read and write documentation.",
    link: "View guide",
  },
  {
    emoji: "📊",
    title: "HubSpot CRM",
    desc: "Integrate with HubSpot to let Sales agents manage leads and update deals automatically.",
    link: "View guide",
  },
  {
    emoji: "🔗",
    title: "Webhooks",
    desc: "Set up custom webhooks to trigger agents from external events and systems.",
    link: "View guide",
  },
  {
    emoji: "🔑",
    title: "API Reference",
    desc: "Full REST API documentation for programmatic control of agents, sessions, and credits.",
    link: "View reference",
  },
];

const advanced = [
  {
    emoji: "🧠",
    title: "Knowledge Base",
    desc: "Upload documents and data to give your agents domain-specific knowledge and context.",
    link: "View guide",
  },
  {
    emoji: "🔄",
    title: "Custom Workflows",
    desc: "Build multi-step workflows that chain agent actions together for complex automation.",
    link: "View guide",
  },
  {
    emoji: "👥",
    title: "Team Management",
    desc: "Set up workspaces, invite team members, and configure role-based access controls.",
    link: "View guide",
  },
  {
    emoji: "🌐",
    title: "Browser Automation",
    desc: "Let agents interact with web applications, fill forms, and extract data from websites.",
    link: "View guide",
  },
  {
    emoji: "📅",
    title: "Scheduled Agents",
    desc: "Set up recurring tasks — daily reports, weekly digests, hourly monitoring checks.",
    link: "View guide",
  },
  {
    emoji: "🔒",
    title: "Security & Compliance",
    desc: "Encryption standards, data handling practices, audit logging, and on-premise deployment.",
    link: "View guide",
  },
];

export default function DocsPage() {
  return (
    <PageShell>
      <div className="page-header">
        <div className="ey rev">Documentation</div>
        <h1 className="rev d1">
          <span className="grad">Everything you need</span>{" "}
          <span className="hl">to get started.</span>
        </h1>
        <p className="page-sub rev d2">
          Guides, references, and best practices for deploying and managing your
          AI employees.
        </p>
        <div className="doc-search rev d3">
          <span className="doc-search-icon">🔍</span>
          <input
            type="text"
            placeholder="Search documentation..."
            readOnly
          />
        </div>
      </div>

      {/* Getting Started */}
      <section className="sec" style={{ paddingTop: 0 }}>
        <div className="ey rev">Getting Started</div>
        <h2 className="st rev d1">
          Up and running <span className="dim">in minutes.</span>
        </h2>
        <div className="docs-grid rev d2">
          {gettingStarted.map((doc) => (
            <a key={doc.title} href="#" className="doc-card">
              <div className="doc-card-icon">{doc.emoji}</div>
              <h3>{doc.title}</h3>
              <p>{doc.desc}</p>
              <span className="doc-card-link">{doc.link} →</span>
            </a>
          ))}
        </div>
      </section>

      {/* Integrations */}
      <div className="steps-bg">
        <section className="sec">
          <div className="ey rev">Integrations</div>
          <h2 className="st rev d1">
            Connect your tools, <span className="dim">amplify your agents.</span>
          </h2>
          <div className="docs-grid rev d2">
            {integrations.map((doc) => (
              <a key={doc.title} href="#" className="doc-card">
                <div className="doc-card-icon">{doc.emoji}</div>
                <h3>{doc.title}</h3>
                <p>{doc.desc}</p>
                <span className="doc-card-link">{doc.link} →</span>
              </a>
            ))}
          </div>
        </section>
      </div>

      {/* Advanced */}
      <section className="sec">
        <div className="ey rev">Advanced</div>
        <h2 className="st rev d1">
          Go deeper, <span className="dim">do more.</span>
        </h2>
        <div className="docs-grid rev d2">
          {advanced.map((doc) => (
            <a key={doc.title} href="#" className="doc-card">
              <div className="doc-card-icon">{doc.emoji}</div>
              <h3>{doc.title}</h3>
              <p>{doc.desc}</p>
              <span className="doc-card-link">{doc.link} →</span>
            </a>
          ))}
        </div>
      </section>

      {/* Help */}
      <div className="cta-wrap">
        <div className="cta-inner rev">
          <h2 className="cta-h">
            Can&apos;t find what
            <br />
            <span style={{ color: "var(--text3)" }}>you&apos;re looking for?</span>
          </h2>
          <p className="cta-sub">
            Our support team is here to help. Reach out anytime.
          </p>
          <div className="cta-btns">
            <a href="/contact" className="btn btn-green btn-lg">
              Contact support →
            </a>
            <a href="#" className="btn btn-ghost btn-lg">
              Join community
            </a>
          </div>
        </div>
      </div>
    </PageShell>
  );
}
