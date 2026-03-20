import type { Metadata } from "next";
import PageShell from "@/components/PageShell";
import LogoMarquee from "@/components/LogoMarquee";
import CTASection from "@/components/CTASection";

export const metadata: Metadata = {
  title: "AI Agents — Pushable.ai",
  description:
    "Explore Pushable.ai's 6 AI agent types: Support, Sales, Research, HR, Finance, and Code Review. Deploy in minutes, pay by credits.",
};

const agents = [
  {
    emoji: "🎧",
    name: "Support Agent",
    image: "/images/support-agent.png",
    badge: "Most Popular",
    badgeClass: "bg",
    credits: "4 cr/hr",
    description:
      "Your always-on customer support team. Handles tickets, responds to FAQs, routes escalations, and follows up with customers 24/7 — without burnout, sick days, or turnover.",
    capabilities: [
      "Auto-resolve common tickets",
      "Intelligent escalation routing",
      "Multi-language support",
      "FAQ response generation",
      "Customer follow-up sequences",
      "CSAT survey automation",
      "Sentiment-based prioritization",
      "Knowledge base integration",
    ],
    color: "rgba(251,191,36,.1)",
  },
  {
    emoji: "📬",
    name: "Sales Agent",
    image: "/images/sales-agent.png",
    badge: "Growth+",
    badgeClass: "bz",
    credits: "6 cr/hr",
    description:
      "Automates your outbound pipeline end-to-end. Qualifies inbound leads, drafts personalized outreach, manages follow-up sequences, and updates your CRM — so your sales team can focus on closing.",
    capabilities: [
      "Lead qualification & scoring",
      "Personalized email drafting",
      "Follow-up sequence management",
      "CRM auto-updates",
      "Meeting scheduling",
      "Competitor mention alerts",
      "Pipeline reporting",
      "A/B subject line testing",
    ],
    color: "rgba(59,130,246,.1)",
  },
  {
    emoji: "🔬",
    name: "Research Analyst",
    image: "/images/research-analyst.png",
    badge: "All Plans",
    badgeClass: "bz",
    credits: "8 cr/hr",
    description:
      "Your on-demand intelligence analyst. Compiles market reports, tracks competitor moves, summarizes industry news, and delivers structured briefings — work that used to take a full day, done in minutes.",
    capabilities: [
      "Market research reports",
      "Competitor analysis",
      "Industry news digests",
      "Data summarization",
      "Trend identification",
      "Source citation & linking",
      "Scheduled daily briefings",
      "Custom report templates",
    ],
    color: "rgba(34,197,94,.1)",
  },
  {
    emoji: "👤",
    name: "HR Screener",
    image: "/images/hr-screener.png",
    badge: "Growth+",
    badgeClass: "bz",
    credits: "5 cr/hr",
    description:
      "Scales your hiring without scaling your HR team. Screens applications against your criteria, scores candidates consistently, schedules interviews, and drafts offer letters — handling hundreds of applicants with uniform quality.",
    capabilities: [
      "Application screening & scoring",
      "Resume parsing & ranking",
      "Interview scheduling",
      "Offer letter drafting",
      "Candidate communication",
      "Diversity metric tracking",
      "Role-specific scoring criteria",
      "Bulk processing support",
    ],
    color: "rgba(168,85,247,.1)",
  },
  {
    emoji: "📊",
    name: "Finance Auditor",
    image: "/images/finance-auditor.png",
    badge: "Growth+",
    badgeClass: "bz",
    credits: "7 cr/hr",
    description:
      "Your financial watchdog. Reviews invoices, flags billing anomalies, reconciles transactions, and generates compliance reports — catching discrepancies that human reviewers miss under fatigue.",
    capabilities: [
      "Invoice review & validation",
      "Anomaly & fraud detection",
      "Transaction reconciliation",
      "Expense categorization",
      "Compliance report generation",
      "Vendor payment tracking",
      "Budget variance analysis",
      "Audit trail documentation",
    ],
    color: "rgba(245,158,11,.1)",
  },
  {
    emoji: "💻",
    name: "Code Reviewer",
    image: "/images/code-reviewer.png",
    badge: "New",
    badgeClass: "bg",
    credits: "8 cr/hr",
    description:
      "Your senior engineer who never gets tired. Reviews pull requests for bugs, security vulnerabilities, and style issues. Writes documentation, suggests improvements, and catches the things that slip through in Friday afternoon reviews.",
    capabilities: [
      "Pull request review",
      "Security vulnerability scanning",
      "Code style enforcement",
      "Documentation generation",
      "Performance suggestions",
      "Test coverage analysis",
      "Dependency audit",
      "Refactoring recommendations",
    ],
    color: "rgba(34,197,94,.1)",
  },
];

export default function AgentsPage() {
  return (
    <PageShell>
      <div className="page-header">
        <div className="ey rev">AI Agents</div>
        <h1 className="rev d1">
          <span className="grad">Six roles.</span>{" "}
          <span className="hl">Infinite capacity.</span>
        </h1>
        <p className="page-sub rev d2">
          Pre-built AI employees for every core business function. Deploy in
          minutes, customize in plain language, pay only for work done.
        </p>
      </div>

      <section className="sec" style={{ paddingTop: 0 }}>
        <div className="agent-grid">
          {agents.map((agent, i) => (
            <div
              key={agent.name}
              className={`agent-detail rev ${i % 3 === 1 ? "d1" : i % 3 === 2 ? "d2" : ""}`}
            >
              <div className="agent-detail-img-wrap">
                <img src={agent.image} alt={agent.name} className="agent-detail-img" />
              </div>
              <div className="agent-detail-header">
                <div
                  className="agent-detail-icon"
                  style={{ background: agent.color }}
                >
                  {agent.emoji}
                </div>
                <div>
                  <h3>{agent.name}</h3>
                  <div className="agent-detail-meta">
                    <span className={`badge ${agent.badgeClass}`}>
                      {agent.badge}
                    </span>
                    <span className="acr">{agent.credits}</span>
                  </div>
                </div>
              </div>
              <p className="agent-detail-desc">{agent.description}</p>
              <ul className="agent-capabilities">
                {agent.capabilities.map((cap) => (
                  <li key={cap}>{cap}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      {/* How it works */}
      <div className="steps-bg">
        <div className="sec" style={{ maxWidth: 1100, margin: "0 auto" }}>
          <div className="ey rev">Getting Started</div>
          <h2 className="st rev d1">
            Deploy any agent{" "}
            <span className="dim">in under 4 minutes.</span>
          </h2>
          <div className="sgrid rev d2">
            <div className="step">
              <div className="sn">01</div>
              <div className="si">🚀</div>
              <div className="stitle">Choose your agent</div>
              <div className="sdesc">
                Pick the role you need from the catalog above. Each agent ships
                pre-configured with industry-standard workflows.
              </div>
            </div>
            <div className="step">
              <div className="sn">02</div>
              <div className="si">⚙️</div>
              <div className="stitle">Configure &amp; connect</div>
              <div className="sdesc">
                Connect Slack, HubSpot, Gmail, Notion. Set guardrails and tone
                in plain language. No code required.
              </div>
            </div>
            <div className="step">
              <div className="sn">03</div>
              <div className="si">📈</div>
              <div className="stitle">Monitor &amp; scale</div>
              <div className="sdesc">
                Watch agents work in real time. Add capacity with credits. Scale
                up or down as your team grows.
              </div>
            </div>
          </div>
        </div>
      </div>

      <LogoMarquee />

      <div style={{ paddingTop: "80px" }}>
        <CTASection />
      </div>
    </PageShell>
  );
}
