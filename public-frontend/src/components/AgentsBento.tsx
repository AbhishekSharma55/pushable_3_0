export default function AgentsBento() {
  return (
    <section className="sec">
      <div className="ey rev">AI Employees</div>
      <h2 className="st rev d1">
        Six roles. <span className="dim">Infinite capacity.</span>
      </h2>
      <p className="ss rev d2">
        Pre-built agents for every core business function — deploy in minutes,
        customize in plain language.
      </p>
      <div className="bento">
        {/* Support Agent - spans 2 columns */}
        <div className="bc bl rev">
          <div className="brow">
            <div className="brow-txt">
              <div className="bi">🎧</div>
              <div className="bn">Support Agent</div>
              <div className="bd">
                Handles tickets, FAQ responses, escalation routing, and customer
                follow-ups 24/7 — without burning out.
              </div>
              <div className="bf">
                <span className="badge bg">Most Popular</span>
                <span className="bcr">4 cr / hr</span>
              </div>
            </div>
            <img src="/images/support-agent.png" alt="Support Agent" className="bc-img bc-img-lg" />
          </div>
        </div>

        {/* Sales Agent */}
        <div className="bc rev d1">
          <img src="/images/sales-agent.png" alt="Sales Agent" className="bc-img" />
          <div className="bn">Sales Agent</div>
          <div className="bd">
            Qualifies leads, drafts outreach, and manages follow-up sequences
            autonomously.
          </div>
          <div className="bf">
            <span className="badge bz">Growth+</span>
            <div className="bstat">
              <span>847</span> tasks
            </div>
          </div>
        </div>

        {/* Research Analyst */}
        <div className="bc rev d2">
          <img src="/images/research-analyst.png" alt="Research Analyst" className="bc-img" />
          <div className="bn">Research Analyst</div>
          <div className="bd">
            Compiles market reports, competitor intel, and data summaries on
            demand.
          </div>
          <div className="bf">
            <span className="badge bz">All plans</span>
            <div className="bstat">
              <span>320</span> tasks
            </div>
          </div>
        </div>

        {/* HR Screener */}
        <div className="bc rev">
          <img src="/images/hr-screener.png" alt="HR Screener" className="bc-img" />
          <div className="bn">HR Screener</div>
          <div className="bd">
            Scores applications, schedules interviews, and drafts offer letters
            with consistency.
          </div>
          <div className="bf">
            <span className="badge bz">Growth+</span>
            <div className="bstat">
              <span>590</span> tasks
            </div>
          </div>
        </div>

        {/* Finance Auditor */}
        <div className="bc rev d1">
          <img src="/images/finance-auditor.png" alt="Finance Auditor" className="bc-img" />
          <div className="bn">Finance Auditor</div>
          <div className="bd">
            Reviews invoices, flags anomalies, reconciles transactions,
            generates reports.
          </div>
          <div className="bf">
            <span className="badge bz">Growth+</span>
            <div className="bstat">
              <span>410</span> tasks
            </div>
          </div>
        </div>

        {/* Code Reviewer */}
        <div className="bc rev d2">
          <img src="/images/code-reviewer.png" alt="Code Reviewer" className="bc-img" />
          <div className="bn">Code Reviewer</div>
          <div className="bd">
            Reviews PRs, catches security issues, writes docs, suggests
            improvements.
          </div>
          <div className="bf">
            <span className="badge bg">New</span>
            <div className="bstat">
              <span>210</span> tasks
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
