"use client";

import { useState, useEffect } from "react";

export default function CookieConsent() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const consent = localStorage.getItem("cookie-consent");
    if (!consent) {
      // Show banner after a short delay for smoother UX
      const timer = setTimeout(() => setVisible(true), 1200);
      return () => clearTimeout(timer);
    }
  }, []);

  const handleAccept = () => {
    localStorage.setItem("cookie-consent", "accepted");
    setVisible(false);
    // Re-enable GTM dataLayer if needed
    if (typeof window !== "undefined") {
      window.dataLayer = window.dataLayer || [];
      window.dataLayer.push({ event: "cookie_consent_granted" });
    }
  };

  const handleDecline = () => {
    localStorage.setItem("cookie-consent", "declined");
    setVisible(false);
  };

  if (!visible) return null;

  return (
    <div className={`cookie-banner ${visible ? "cookie-banner--visible" : ""}`}>
      <div className="cookie-inner">
        <div className="cookie-icon">🍪</div>
        <div className="cookie-content">
          <p className="cookie-title">We use cookies</p>
          <p className="cookie-text">
            We use cookies and similar technologies to enhance your experience, 
            analyze traffic, and serve personalized content. By clicking &quot;Accept&quot;, 
            you consent to our use of cookies.{" "}
            <a href="/privacy" className="cookie-link">
              Privacy Policy
            </a>
          </p>
        </div>
        <div className="cookie-actions">
          <button onClick={handleDecline} className="cookie-btn cookie-btn--decline">
            Decline
          </button>
          <button onClick={handleAccept} className="cookie-btn cookie-btn--accept">
            Accept
          </button>
        </div>
      </div>
    </div>
  );
}
