import type { Metadata } from "next";
import PageShell from "@/components/PageShell";
import LogoMarquee from "@/components/LogoMarquee";
import CTASection from "@/components/CTASection";

export const metadata: Metadata = {
  title: "About — Pushable.ai",
  description:
    "Learn about Pushable.ai — the AI employees platform helping modern teams automate support, sales, research, and operations.",
};

export default function AboutPage() {
  return (
    <PageShell>
      {/* Header */}
      <div className="page-header">
        <div className="ey rev">About Us</div>
        <h1 className="rev d1">
          <span className="grad">Building the future of work</span>{" "}
          <span className="hl">with AI employees.</span>
        </h1>
        <p className="page-sub rev d2">
          We&apos;re on a mission to make intelligent automation accessible to
          every team — not just enterprises with unlimited budgets.
        </p>
      </div>

      {/* Mission */}
      <div className="about-mission rev">
        <p>
          At Pushable.ai, we believe the future of work isn&apos;t about
          replacing people — it&apos;s about{" "}
          <strong>giving every team AI-powered employees</strong> that handle
          the repetitive, time-consuming tasks so your people can focus on what
          matters most. Our credit-based model means you only pay for actual work
          done, not seats gathering dust. No contracts. No hidden fees. Just{" "}
          <strong>honest, transparent pricing</strong> that scales with your
          business.
        </p>
      </div>

      {/* Stats */}
      <div className="stats-row rev">
        <div className="stat-item">
          <div className="stat-num">1.8M+</div>
          <div className="stat-label">Tasks completed</div>
        </div>
        <div className="stat-item">
          <div className="stat-num">99.4%</div>
          <div className="stat-label">Uptime SLA</div>
        </div>
        <div className="stat-item">
          <div className="stat-num">&lt;4min</div>
          <div className="stat-label">Avg. deploy time</div>
        </div>
        <div className="stat-item">
          <div className="stat-num">6</div>
          <div className="stat-label">Agent types</div>
        </div>
      </div>

      {/* What We Do */}
      <section className="sec">
        <div className="ey rev">What We Do</div>
        <h2 className="st rev d1">
          Six AI employees, <span className="dim">one platform.</span>
        </h2>
        <p className="ss rev d2">
          Pre-built agents for every core business function — deploy in minutes,
          customize in plain language.
        </p>
        <div className="bento rev" style={{ gridTemplateColumns: "repeat(3, 1fr)" }}>
          <div className="bc">
            <div className="bi">🎧</div>
            <div className="bn">Support Agent</div>
            <div className="bd">
              Handles tickets, FAQ responses, escalation routing, and customer
              follow-ups around the clock.
            </div>
          </div>
          <div className="bc">
            <div className="bi">📬</div>
            <div className="bn">Sales Agent</div>
            <div className="bd">
              Qualifies leads, drafts outreach, and manages follow-up sequences
              autonomously.
            </div>
          </div>
          <div className="bc">
            <div className="bi">🔬</div>
            <div className="bn">Research Analyst</div>
            <div className="bd">
              Compiles market reports, competitor intel, and data summaries on
              demand.
            </div>
          </div>
          <div className="bc">
            <div className="bi">👤</div>
            <div className="bn">HR Screener</div>
            <div className="bd">
              Scores applications, schedules interviews, and drafts offer
              letters with consistency.
            </div>
          </div>
          <div className="bc">
            <div className="bi">📊</div>
            <div className="bn">Finance Auditor</div>
            <div className="bd">
              Reviews invoices, flags anomalies, reconciles transactions, and
              generates reports.
            </div>
          </div>
          <div className="bc">
            <div className="bi">💻</div>
            <div className="bn">Code Reviewer</div>
            <div className="bd">
              Reviews PRs, catches security issues, writes documentation, and
              suggests improvements.
            </div>
          </div>
        </div>
      </section>

      {/* Values */}
      <section className="sec" style={{ paddingTop: 0 }}>
        <div className="ey rev">Our Values</div>
        <h2 className="st rev d1">
          Built on principles <span className="dim">that matter.</span>
        </h2>
        <div className="values-grid rev d2">
          <div className="bc">
            <div className="bi">🔍</div>
            <div className="bn">Transparency</div>
            <div className="bd">
              Our credit-based model is honest — you see exactly what every task
              costs. No hidden fees, no surprise invoices, no seat-based pricing
              that punishes growth.
            </div>
          </div>
          <div className="bc">
            <div className="bi">🔒</div>
            <div className="bn">Security</div>
            <div className="bd">
              All data encrypted with TLS 1.3 in transit and AES-256 at rest.
              Agents run in isolated sandboxes. We never use your data to train
              models. Enterprise customers can deploy on-premise.
            </div>
          </div>
          <div className="bc">
            <div className="bi">⚡</div>
            <div className="bn">Efficiency</div>
            <div className="bd">
              Pay only for work done, not time elapsed. Deploy agents in under 4
              minutes. Scale up or down instantly with credits — no contracts, no
              commitments.
            </div>
          </div>
        </div>
      </section>

      {/* Trusted By */}
      <LogoMarquee />

      {/* CTA */}
      <div style={{ paddingTop: "80px" }}>
        <CTASection />
      </div>
    </PageShell>
  );
}
