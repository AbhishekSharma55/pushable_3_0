import type { Metadata } from "next";
import PageShell from "@/components/PageShell";
import PricingSection from "@/components/PricingSection";
import FAQ from "@/components/FAQ";
import LogoMarquee from "@/components/LogoMarquee";
import CTASection from "@/components/CTASection";

export const metadata: Metadata = {
  title: "Pricing — Pushable.ai",
  description:
    "Simple, transparent pricing for Pushable.ai. Start free with 100 credits. Scale with Growth at $49/month. Enterprise plans available.",
};

export default function PricingPage() {
  return (
    <PageShell>
      <div className="page-header">
        <div className="ey rev">Pricing</div>
        <h1 className="rev d1">
          <span className="grad">Simple, transparent</span>{" "}
          <span className="hl">pricing.</span>
        </h1>
        <p className="page-sub rev d2">
          Start free with 100 credits. No credit card required. Scale as you
          grow — only pay for actual work done.
        </p>
      </div>

      {/* Pricing Cards */}
      <PricingSection />

      {/* Comparison */}
      <section className="sec">
        <div className="ey rev">Compare Plans</div>
        <h2 className="st rev d1">
          Everything you need, <span className="dim">at every stage.</span>
        </h2>

        <div className="credit-table rev" style={{ marginTop: 40 }}>
          <div className="credit-table-row header">
            <div className="credit-table-cell">Feature</div>
            <div className="credit-table-cell">Starter</div>
            <div className="credit-table-cell">Growth</div>
            <div className="credit-table-cell">Enterprise</div>
          </div>
          <div className="credit-table-row">
            <div className="credit-table-cell">Monthly credits</div>
            <div className="credit-table-cell mono">100</div>
            <div className="credit-table-cell mono">2,000</div>
            <div className="credit-table-cell mono">Unlimited</div>
          </div>
          <div className="credit-table-row">
            <div className="credit-table-cell">Active agents</div>
            <div className="credit-table-cell" style={{ color: "var(--text2)" }}>2</div>
            <div className="credit-table-cell" style={{ color: "var(--text2)" }}>Unlimited</div>
            <div className="credit-table-cell" style={{ color: "var(--text2)" }}>Unlimited</div>
          </div>
          <div className="credit-table-row">
            <div className="credit-table-cell">Agent types</div>
            <div className="credit-table-cell" style={{ color: "var(--text2)" }}>Support + Research</div>
            <div className="credit-table-cell" style={{ color: "var(--text2)" }}>All 6</div>
            <div className="credit-table-cell" style={{ color: "var(--text2)" }}>All 6 + Custom</div>
          </div>
          <div className="credit-table-row">
            <div className="credit-table-cell">Credit rollover</div>
            <div className="credit-table-cell" style={{ color: "var(--text3)" }}>—</div>
            <div className="credit-table-cell mono">✓</div>
            <div className="credit-table-cell mono">✓</div>
          </div>
          <div className="credit-table-row">
            <div className="credit-table-cell">Priority support</div>
            <div className="credit-table-cell" style={{ color: "var(--text3)" }}>—</div>
            <div className="credit-table-cell mono">✓</div>
            <div className="credit-table-cell mono">✓</div>
          </div>
          <div className="credit-table-row">
            <div className="credit-table-cell">Custom workflows</div>
            <div className="credit-table-cell" style={{ color: "var(--text3)" }}>—</div>
            <div className="credit-table-cell mono">✓</div>
            <div className="credit-table-cell mono">✓</div>
          </div>
          <div className="credit-table-row">
            <div className="credit-table-cell">Advanced analytics</div>
            <div className="credit-table-cell" style={{ color: "var(--text3)" }}>—</div>
            <div className="credit-table-cell mono">✓</div>
            <div className="credit-table-cell mono">✓</div>
          </div>
          <div className="credit-table-row">
            <div className="credit-table-cell">SSO / SAML</div>
            <div className="credit-table-cell" style={{ color: "var(--text3)" }}>—</div>
            <div className="credit-table-cell" style={{ color: "var(--text3)" }}>—</div>
            <div className="credit-table-cell mono">✓</div>
          </div>
          <div className="credit-table-row">
            <div className="credit-table-cell">SLA guarantee</div>
            <div className="credit-table-cell" style={{ color: "var(--text3)" }}>—</div>
            <div className="credit-table-cell" style={{ color: "var(--text2)" }}>99.4%</div>
            <div className="credit-table-cell mono">99.9%</div>
          </div>
          <div className="credit-table-row">
            <div className="credit-table-cell">On-premise deployment</div>
            <div className="credit-table-cell" style={{ color: "var(--text3)" }}>—</div>
            <div className="credit-table-cell" style={{ color: "var(--text3)" }}>—</div>
            <div className="credit-table-cell mono">✓</div>
          </div>
        </div>
      </section>

      <FAQ />

      <LogoMarquee />

      <div style={{ paddingTop: "80px" }}>
        <CTASection />
      </div>
    </PageShell>
  );
}
