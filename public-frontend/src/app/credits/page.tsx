import type { Metadata } from "next";
import PageShell from "@/components/PageShell";
import CreditFeatures from "@/components/CreditFeatures";
import CreditSimulator from "@/components/CreditSimulator";
import CTASection from "@/components/CTASection";

export const metadata: Metadata = {
  title: "Credits — Pushable.ai",
  description:
    "Understand how Pushable.ai credits work. Pay only for work done — no seats, no idle charges. Transparent credit-based pricing.",
};

export default function CreditsPage() {
  return (
    <PageShell>
      <div className="page-header">
        <div className="ey rev">Credit System</div>
        <h1 className="rev d1">
          <span className="grad">Pay for work done,</span>{" "}
          <span className="hl">not seats.</span>
        </h1>
        <p className="page-sub rev d2">
          Credits are consumed only when your agents are working. No idle
          charges, no seat fees, no surprises.
        </p>
      </div>

      {/* How Credits Work */}
      <section className="sec" style={{ paddingTop: 0 }}>
        <div className="ey rev">How It Works</div>
        <h2 className="st rev d1">
          Credits = <span className="dim">agent compute.</span>
        </h2>
        <p className="ss rev d2">
          Each agent consumes credits based on the complexity of the task —
          simple tasks are cheap, complex tasks cost more.
        </p>

        <div className="credit-table rev" style={{ marginTop: 40 }}>
          <div className="credit-table-row header">
            <div className="credit-table-cell">Task Type</div>
            <div className="credit-table-cell">Example</div>
            <div className="credit-table-cell">Credits</div>
          </div>
          <div className="credit-table-row">
            <div className="credit-table-cell">Simple reply</div>
            <div className="credit-table-cell" style={{ color: "var(--text2)" }}>
              Answering an FAQ, acknowledging a ticket
            </div>
            <div className="credit-table-cell mono">~0.5 cr</div>
          </div>
          <div className="credit-table-row">
            <div className="credit-table-cell">Moderate task</div>
            <div className="credit-table-cell" style={{ color: "var(--text2)" }}>
              Drafting an outreach email, scoring an application
            </div>
            <div className="credit-table-cell mono">2–6 cr</div>
          </div>
          <div className="credit-table-row">
            <div className="credit-table-cell">Complex task</div>
            <div className="credit-table-cell" style={{ color: "var(--text2)" }}>
              Writing a research report, full code review
            </div>
            <div className="credit-table-cell mono">5–15 cr</div>
          </div>
          <div className="credit-table-row">
            <div className="credit-table-cell">Browser action</div>
            <div className="credit-table-cell" style={{ color: "var(--text2)" }}>
              Navigating a website, extracting data
            </div>
            <div className="credit-table-cell mono">1–3 cr</div>
          </div>
          <div className="credit-table-row">
            <div className="credit-table-cell">Scheduled run</div>
            <div className="credit-table-cell" style={{ color: "var(--text2)" }}>
              Daily digest, recurring report
            </div>
            <div className="credit-table-cell mono">2–8 cr</div>
          </div>
        </div>
      </section>

      {/* Agent Rates */}
      <div className="steps-bg">
        <section className="sec">
          <div className="ey rev">Agent Rates</div>
          <h2 className="st rev d1">
            Baseline credit consumption <span className="dim">per agent.</span>
          </h2>
          <div className="sgrid rev d2">
            <div className="step">
              <div className="sn">SUPPORT</div>
              <div className="si">🎧</div>
              <div className="stitle">4 credits / hour</div>
              <div className="sdesc">
                Lowest cost agent. Handles high-volume, low-complexity tasks
                like ticket responses and FAQ replies.
              </div>
            </div>
            <div className="step">
              <div className="sn">SALES</div>
              <div className="si">📬</div>
              <div className="stitle">6 credits / hour</div>
              <div className="sdesc">
                Mid-range cost. Drafting personalized outreach and managing
                follow-up sequences requires more compute.
              </div>
            </div>
            <div className="step">
              <div className="sn">RESEARCH</div>
              <div className="si">🔬</div>
              <div className="stitle">8 credits / hour</div>
              <div className="sdesc">
                Higher cost due to complex analysis, data synthesis, and
                multi-source report generation.
              </div>
            </div>
          </div>
        </section>
      </div>

      {/* Features + Simulator */}
      <section className="sec">
        <div className="ey rev">Why Credits</div>
        <h2 className="st rev d1">
          Transparent, fair, <span className="dim">and flexible.</span>
        </h2>
        <div className="cgrid">
          <CreditFeatures />
          <CreditSimulator />
        </div>
      </section>

      {/* Plans Overview */}
      <section className="sec" style={{ paddingTop: 0 }}>
        <div className="ey rev">Plans</div>
        <h2 className="st rev d1">
          Credit allocations <span className="dim">by plan.</span>
        </h2>
        <div className="sgrid rev d2">
          <div className="step">
            <div className="sn">STARTER</div>
            <div className="si">🆓</div>
            <div className="stitle">100 credits / month</div>
            <div className="sdesc">
              Free forever. Perfect for trying out the platform. Credits reset
              monthly. 2 active agents.
            </div>
          </div>
          <div className="step">
            <div className="sn">GROWTH</div>
            <div className="si">🚀</div>
            <div className="stitle">2,000 credits / month</div>
            <div className="sdesc">
              $49/month ($39 annual). Unused credits roll over. All 6 agent
              types. Top up anytime from your dashboard.
            </div>
          </div>
          <div className="step">
            <div className="sn">ENTERPRISE</div>
            <div className="si">🏢</div>
            <div className="stitle">Unlimited credits</div>
            <div className="sdesc">
              Custom pricing. 99.9% SLA. Dedicated success manager. On-premise
              deployment available.
            </div>
          </div>
        </div>
      </section>

      <CTASection />
    </PageShell>
  );
}
