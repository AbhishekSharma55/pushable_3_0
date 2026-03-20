export default function DashboardCard() {
  return (
    <div className="hcard rev">
      <div className="hc-hdr">
        <div className="hc-dots">
          <div className="hc-dot" style={{ background: "#ef4444" }} />
          <div className="hc-dot" style={{ background: "#f59e0b" }} />
          <div className="hc-dot" style={{ background: "#22c55e" }} />
        </div>
        <span className="hc-title">Agent Dashboard — pushable.ai</span>
        <span className="live">LIVE</span>
      </div>
      <div className="hc-body">
        <div className="arow">
          <div className="ai" style={{ background: "rgba(251,191,36,.1)" }}>
            🎧
          </div>
          <div className="an">
            <div className="an-name">Support Agent</div>
            <div className="an-task">Resolved ticket #4821 — billing</div>
          </div>
          <div className="am">
            <span className="badge bg">Active</span>
            <span className="acr">4 cr/hr</span>
          </div>
        </div>
        <div className="arow">
          <div className="ai" style={{ background: "rgba(59,130,246,.1)" }}>
            📬
          </div>
          <div className="an">
            <div className="an-name">Sales Agent</div>
            <div className="an-task">Drafted 14 follow-up emails</div>
          </div>
          <div className="am">
            <span className="badge bg">Active</span>
            <span className="acr">6 cr/hr</span>
          </div>
        </div>
        <div className="arow">
          <div className="ai" style={{ background: "rgba(34,197,94,.1)" }}>
            🔬
          </div>
          <div className="an">
            <div className="an-name">Research Analyst</div>
            <div className="an-task">Compiling competitor report</div>
          </div>
          <div className="am">
            <span className="badge ba">Queued</span>
            <span className="acr">8 cr/hr</span>
          </div>
        </div>
        <div className="arow">
          <div className="ai" style={{ background: "rgba(168,85,247,.1)" }}>
            👤
          </div>
          <div className="an">
            <div className="an-name">HR Screener</div>
            <div className="an-task">Scored 22 applications</div>
          </div>
          <div className="am">
            <span className="badge bz">Idle</span>
            <span className="acr">5 cr/hr</span>
          </div>
        </div>
      </div>
      <div className="hc-foot">
        <span className="cr-lbl">Credits</span>
        <div className="cr-track">
          <div className="cr-fill" />
        </div>
        <span className="cr-cnt">1,340 / 2,000</span>
      </div>
    </div>
  );
}
