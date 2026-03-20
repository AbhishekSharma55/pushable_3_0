export default function HowItWorks() {
  return (
    <div className="steps-bg">
      <div className="sec" style={{ maxWidth: 1100, margin: "0 auto" }}>
        <div className="ey rev">How it works</div>
        <h2 className="st rev d1">
          From zero to deployed <span className="dim">in three steps.</span>
        </h2>
        <div className="sgrid rev d2">
          <div className="step">
            <div className="sn">01</div>
            <div className="si">🚀</div>
            <div className="stitle">Choose your agent</div>
            <div className="sdesc">
              Browse the catalog and pick the role you need. Each agent ships
              pre-configured with industry-standard workflows.
            </div>
          </div>
          <div className="step">
            <div className="sn">02</div>
            <div className="si">⚙️</div>
            <div className="stitle">Configure &amp; connect</div>
            <div className="sdesc">
              Connect Slack, HubSpot, Gmail, Notion. Set guardrails and tone in
              plain language. No code required.
            </div>
          </div>
          <div className="step">
            <div className="sn">03</div>
            <div className="si">📈</div>
            <div className="stitle">Monitor &amp; scale</div>
            <div className="sdesc">
              Watch agents work in real time. Add capacity with credits. Scale as
              your team grows.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
