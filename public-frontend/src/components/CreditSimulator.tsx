"use client";

import { useState, useCallback } from "react";

export default function CreditSimulator() {
  const [tickets, setTickets] = useState(50);
  const [leads, setLeads] = useState(30);
  const [reports, setReports] = useState(4);

  const calc = useCallback(() => {
    const sc = Math.round(tickets * 30 * 0.5 * 4);
    const lc = Math.round(leads * 4 * 2 * 6);
    const rc = Math.round(reports * 10 * 8);
    const tot = sc + lc + rc;
    return { sc, lc, rc, tot };
  }, [tickets, leads, reports]);

  const { sc, lc, rc, tot } = calc();

  return (
    <div className="sim rev d1">
      <div className="sim-h">⚡ Estimate your monthly usage</div>
      <div className="sw">
        <div className="sl">
          Support tickets/day <strong>{tickets}</strong>
        </div>
        <input
          type="range"
          min={5}
          max={200}
          value={tickets}
          onChange={(e) => setTickets(Number(e.target.value))}
        />
      </div>
      <div className="sw">
        <div className="sl">
          Sales leads/week <strong>{leads}</strong>
        </div>
        <input
          type="range"
          min={5}
          max={200}
          value={leads}
          onChange={(e) => setLeads(Number(e.target.value))}
        />
      </div>
      <div className="sw">
        <div className="sl">
          Research reports/month <strong>{reports}</strong>
        </div>
        <input
          type="range"
          min={0}
          max={30}
          value={reports}
          onChange={(e) => setReports(Number(e.target.value))}
        />
      </div>
      <div className="sbreak">
        <div className="srow">
          <span className="srl">Support Agent</span>
          <span className="srv">{sc.toLocaleString()} cr</span>
        </div>
        <div className="srow">
          <span className="srl">Sales Agent</span>
          <span className="srv">{lc.toLocaleString()} cr</span>
        </div>
        <div className="srow">
          <span className="srl">Research Analyst</span>
          <span className="srv">{rc.toLocaleString()} cr</span>
        </div>
        <div className="stotal">
          <span>Monthly estimate</span>
          <span className="stv">{tot.toLocaleString()} cr</span>
        </div>
      </div>
    </div>
  );
}
