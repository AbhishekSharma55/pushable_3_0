"use client";

import { useState, useRef, useEffect } from "react";
import Logo from "./Logo";

const links = [
  { href: "/blog", label: "Blog" },
  { href: "/docs", label: "Docs" },
  { href: "/credits", label: "Credits" },
  { href: "/about", label: "About" },
  { href: "/contact", label: "Contact" },
];

export default function Navbar() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  return (
    <nav>
      <a href="/" className="nav-logo">
        <Logo />
        Pushable<span style={{ opacity: 0.35 }}>.ai</span>
      </a>

      <div className="nav-center">
        <a href="/agents" className="nl">Agents</a>
        <a href="/pricing" className="nl">Pricing</a>

        <div ref={ref} style={{ position: "relative" }}>
          <button
            className="nl"
            onClick={() => setOpen((v) => !v)}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
              background: "none",
              border: "none",
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            Resources
            <svg
              width="10"
              height="6"
              viewBox="0 0 10 6"
              fill="none"
              style={{
                transition: "transform 0.2s",
                transform: open ? "rotate(180deg)" : "none",
              }}
            >
              <path d="M1 1L5 5L9 1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>

          {open && (
            <div
              style={{
                position: "absolute",
                top: "calc(100% + 10px)",
                left: "50%",
                transform: "translateX(-50%)",
                background: "#16161a",
                border: "1px solid #27272a",
                borderRadius: 10,
                padding: "6px",
                minWidth: 170,
                zIndex: 200,
                boxShadow: "0 16px 48px rgba(0,0,0,0.5)",
              }}
            >
              {links.map((l) => (
                <a
                  key={l.href}
                  href={l.href}
                  onClick={() => setOpen(false)}
                  style={{
                    display: "block",
                    padding: "8px 14px",
                    borderRadius: 6,
                    fontSize: 13.5,
                    color: "#a1a1aa",
                    textDecoration: "none",
                    transition: "background 0.12s, color 0.12s",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = "rgba(255,255,255,0.06)";
                    e.currentTarget.style.color = "#fafafa";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = "transparent";
                    e.currentTarget.style.color = "#a1a1aa";
                  }}
                >
                  {l.label}
                </a>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="nav-right">
        <a href="#" className="btn btn-ghost">Log in</a>
        <a href="#" className="btn btn-white">Get started →</a>
      </div>
    </nav>
  );
}
