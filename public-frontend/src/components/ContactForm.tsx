"use client";

import { useState } from "react";

export default function ContactForm() {
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState({
    name: "",
    email: "",
    subject: "general",
    message: "",
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      const res = await fetch("/api/public/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });

      if (!res.ok) {
        const json = await res.json().catch(() => null);
        throw new Error(
          json?.error?.message || "Failed to send message. Please try again."
        );
      }

      setSubmitted(true);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Something went wrong. Please try again."
      );
    } finally {
      setLoading(false);
    }
  };

  if (submitted) {
    return (
      <div className="form-wrap">
        <div className="form-success">
          <div className="form-success-icon">✓</div>
          <h3>Message sent!</h3>
          <p>
            Thanks for reaching out. We&apos;ll get back to you within 24 hours.
          </p>
        </div>
      </div>
    );
  }

  return (
    <form className="form-wrap" onSubmit={handleSubmit}>
      {error && (
        <div
          style={{
            padding: "12px 16px",
            marginBottom: "20px",
            borderRadius: "var(--r)",
            background: "rgba(239, 68, 68, 0.1)",
            border: "1px solid rgba(239, 68, 68, 0.3)",
            color: "#ef4444",
            fontSize: "14px",
          }}
        >
          {error}
        </div>
      )}
      <div className="form-group">
        <label className="form-label">Name</label>
        <input
          type="text"
          className="form-input"
          placeholder="Your name"
          required
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          disabled={loading}
        />
      </div>
      <div className="form-group">
        <label className="form-label">Email</label>
        <input
          type="email"
          className="form-input"
          placeholder="you@company.com"
          required
          value={form.email}
          onChange={(e) => setForm({ ...form, email: e.target.value })}
          disabled={loading}
        />
      </div>
      <div className="form-group">
        <label className="form-label">Subject</label>
        <select
          className="form-select"
          value={form.subject}
          onChange={(e) => setForm({ ...form, subject: e.target.value })}
          disabled={loading}
        >
          <option value="general">General Inquiry</option>
          <option value="sales">Sales &amp; Enterprise</option>
          <option value="support">Technical Support</option>
          <option value="partnership">Partnerships</option>
        </select>
      </div>
      <div className="form-group">
        <label className="form-label">Message</label>
        <textarea
          className="form-textarea"
          placeholder="How can we help?"
          required
          value={form.message}
          onChange={(e) => setForm({ ...form, message: e.target.value })}
          disabled={loading}
        />
      </div>
      <button
        type="submit"
        className="btn btn-green btn-lg"
        style={{ width: "100%", justifyContent: "center" }}
        disabled={loading}
      >
        {loading ? "Sending..." : "Send message →"}
      </button>
    </form>
  );
}
