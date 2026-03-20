export default function HeroCopy() {
  return (
    <div>
      <div className="pill">
        <div className="pill-dot" />
        <span className="pill-badge">NEW</span>
        <span>Code Reviewer Agent now live</span>
      </div>
      <h1 className="ht">
        <span className="grad">
          Your business,
          <br />
          run by
        </span>{" "}
        <span className="hl">AI employees.</span>
      </h1>
      <p className="hero-sub">
        Deploy autonomous agents for support, sales, research, and ops — billed
        by credits, scaled instantly.
      </p>
      <div className="hero-ctas">
        <a href="#" className="btn btn-green btn-lg">
          Deploy your first agent →
        </a>
        <a href="#" className="btn btn-ghost btn-lg">
          Watch demo ▶
        </a>
      </div>
      <div className="hstats">
        <div className="hstat">
          <div className="hstat-n">1.8M+</div>
          <div className="hstat-l">Tasks completed</div>
        </div>
        <div className="hstat">
          <div className="hstat-n">99.4%</div>
          <div className="hstat-l">Uptime SLA</div>
        </div>
        <div className="hstat">
          <div className="hstat-n">&lt;4min</div>
          <div className="hstat-l">Avg. deploy time</div>
        </div>
      </div>
    </div>
  );
}
