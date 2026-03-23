import type { Metadata } from "next";
import PageShell from "@/components/PageShell";
import ContactForm from "@/components/ContactForm";

export const metadata: Metadata = {
  title: "Contact — Pushable.ai",
  description:
    "Get in touch with the Pushable.ai team for sales, support, partnerships, or general inquiries.",
};

export default function ContactPage() {
  return (
    <PageShell>
      {/* Header */}
      <div className="page-header">
        <div className="ey rev">Contact</div>
        <h1 className="rev d1">
          <span className="grad">Get in</span>{" "}
          <span className="hl">touch.</span>
        </h1>
        <p className="page-sub rev d2">
          Have questions about our platform, pricing, or enterprise solutions?
          We&apos;d love to hear from you.
        </p>
      </div>

      {/* Contact Grid */}
      <div className="contact-grid">
        {/* Left: Form */}
        <div className="rev">
          <ContactForm />
        </div>

        {/* Right: Info Cards */}
        <div className="contact-cards rev d1">
          <div className="contact-card">
            <div className="contact-card-icon">💼</div>
            <h3>Sales &amp; Enterprise</h3>
            <p>
              Talk to our sales team about custom plans, volume pricing, and
              enterprise deployment options including on-premise.
            </p>
            <a href="mailto:sales@pushable.ai">sales@pushable.ai →</a>
          </div>
          <div className="contact-card">
            <div className="contact-card-icon">🎧</div>
            <h3>Technical Support</h3>
            <p>
              Need help with your agents, integrations, or account? Our support
              team is here to help.
            </p>
            <a href="mailto:support@pushable.ai">support@pushable.ai →</a>
          </div>
          <div className="contact-card">
            <div className="contact-card-icon">🤝</div>
            <h3>Partnerships</h3>
            <p>
              Interested in integrations, reseller programs, or building on top
              of Pushable.ai? Let&apos;s talk.
            </p>
            <a href="mailto:partners@pushable.ai">partners@pushable.ai →</a>
          </div>
        </div>
      </div>

      {/* Social */}
      {/* <div className="social-row rev">
        <a href="#">Twitter</a>
        <a href="#">LinkedIn</a>
        <a href="#">GitHub</a>
      </div> */}

      {/* FAQ Link */}
      <div
        className="rev"
        style={{
          textAlign: "center",
          padding: "0 32px 80px",
          position: "relative",
          zIndex: 1,
        }}
      >
        <p style={{ fontSize: "14px", color: "var(--text3)" }}>
          Looking for quick answers?{" "}
          <a
            href="/#pricing"
            style={{ color: "var(--green)", textDecoration: "none" }}
          >
            Check our FAQ →
          </a>
        </p>
      </div>
    </PageShell>
  );
}
