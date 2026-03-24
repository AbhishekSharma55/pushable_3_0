"use client";

import { useState } from "react";

export default function PricingSection() {
  const [annual, setAnnual] = useState(false);

  return (
    <div className="steps-bg" id="pricing">
      <div className="pricing-wrap" style={{ padding: "0 32px" }}>
        <div style={{ textAlign: "center", padding: "96px 0 0" }}>
          <div className="ey rev" style={{ display: "inline-block" }}>
            Pricing
          </div>
          <h2 className="st rev d1" style={{ textAlign: "center" }}>
            Simple, transparent pricing.
          </h2>
          <p
            className="rev d2"
            style={{
              textAlign: "center",
              color: "var(--text2)",
              fontSize: "15px",
              marginBottom: "40px",
            }}
          >
            Start free. Scale as you grow.
          </p>
          <div className="ptoggle rev d2">
            <span className={`tl ${!annual ? "on" : ""}`}>Monthly</span>
            <button
              className={`tbtn ${annual ? "on" : ""}`}
              onClick={() => setAnnual(!annual)}
            />
            <span className={`tl ${annual ? "on" : ""}`}>Annual</span>
            <span className="spill">Save 20%</span>
          </div>
        </div>
        <div className="pgrid rev" style={{ paddingBottom: "96px" }}>
          {/* Starter */}
          <div className="pc">
            <div className="pplan">Starter</div>
            <div className="pprice">
              $0<span className="pper">/mo</span>
            </div>
            <div className="pcred">100 credits / month</div>
            <a
              href={`${process.env.NEXT_PUBLIC_FRONTEND_URL || "https://platform.pushable.ai"}/register`}
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn-ghost"
              style={{
                width: "100%",
                justifyContent: "center",
                fontSize: "14px",
                padding: "10px",
              }}
            >
              Get started free
            </a>
            <hr className="pdiv" />
            <ul className="pfeats">
              <li className="pfeat">
                <span className="pck">✓</span>2 active agents
              </li>
              <li className="pfeat">
                <span className="pck">✓</span>Support + Research agents
              </li>
              <li className="pfeat">
                <span className="pck">✓</span>Basic analytics dashboard
              </li>
              <li className="pfeat pgray">
                <span className="pcx">—</span>Credit rollover
              </li>
              <li className="pfeat pgray">
                <span className="pcx">—</span>Priority support
              </li>
            </ul>
          </div>

          {/* Growth - Featured */}
          <div className="pc pcf">
            <div className="pc-pill">MOST POPULAR</div>
            <div className="pplan">Growth</div>
            <div className="pprice">
              {annual ? "$39" : "$49"}
              <span className="pper">/mo</span>
            </div>
            <div className="pcred">2,000 credits + rollover</div>
            <a
              href={`${process.env.NEXT_PUBLIC_FRONTEND_URL || "https://platform.pushable.ai"}/register`}
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn-green btn-lg"
              style={{
                width: "100%",
                justifyContent: "center",
                fontSize: "14px",
                padding: "10px",
                borderRadius: "var(--r)",
              }}
            >
              Start free trial →
            </a>
            <hr className="pdiv" />
            <ul className="pfeats">
              <li className="pfeat">
                <span className="pck">✓</span>All 6 agent types
              </li>
              <li className="pfeat">
                <span className="pck">✓</span>Credit rollover
              </li>
              <li className="pfeat">
                <span className="pck">✓</span>Priority support
              </li>
              <li className="pfeat">
                <span className="pck">✓</span>Advanced analytics
              </li>
              <li className="pfeat">
                <span className="pck">✓</span>Custom workflows
              </li>
            </ul>
          </div>

          {/* Enterprise */}
          <div className="pc">
            <div className="pplan">Enterprise</div>
            <div
              className="pprice"
              style={{
                fontSize: "36px",
                letterSpacing: "-0.03em",
                lineHeight: 1.15,
              }}
            >
              Custom
            </div>
            <div className="pcred">Unlimited credits</div>
            <a
              href={`${process.env.NEXT_PUBLIC_FRONTEND_URL || "https://platform.pushable.ai"}/login`}
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn-ghost"
              style={{
                width: "100%",
                justifyContent: "center",
                fontSize: "14px",
                padding: "10px",
              }}
            >
              Contact sales
            </a>
            <hr className="pdiv" />
            <ul className="pfeats">
              <li className="pfeat">
                <span className="pck">✓</span>Custom AI agents
              </li>
              <li className="pfeat">
                <span className="pck">✓</span>SSO / SAML
              </li>
              <li className="pfeat">
                <span className="pck">✓</span>99.9% SLA guarantee
              </li>
              <li className="pfeat">
                <span className="pck">✓</span>Dedicated success manager
              </li>
              <li className="pfeat">
                <span className="pck">✓</span>On-premise deployment
              </li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
