export default function CTASection() {
  return (
    <div className="cta-wrap">
      <div className="cta-inner rev">
        <h2 className="cta-h">
          Ready to push your
          <br />
          <span style={{ color: "var(--text3)" }}>business forward?</span>
        </h2>
        <p className="cta-sub">
          Start with 100 free credits. No credit card required.
        </p>
        <div className="cta-btns">
          <a href={`${process.env.NEXT_PUBLIC_FRONTEND_URL || "http://localhost:3000"}/register`} target="_blank" rel="noopener noreferrer" className="btn btn-green btn-lg">
            Deploy your first agent →
          </a>
          <a href={`${process.env.NEXT_PUBLIC_FRONTEND_URL || "http://localhost:3000"}/login`} target="_blank" rel="noopener noreferrer" className="btn btn-ghost btn-lg">
            Talk to sales
          </a>
        </div>
      </div>
    </div>
  );
}
