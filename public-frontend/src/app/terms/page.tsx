import type { Metadata } from "next";
import PageShell from "@/components/PageShell";

export const metadata: Metadata = {
  title: "Terms and Conditions — Pushable.ai",
  description:
    "Read the Pushable.ai Terms and Conditions covering use of service, user responsibilities, and platform policies.",
};

export default function TermsPage() {
  return (
    <PageShell>
      <div className="page-header">
        <div className="ey rev">Legal</div>
        <h1 className="rev d1">Terms and Conditions</h1>
        <p className="page-date rev d2">
          Last updated: [Add Date]
        </p>
      </div>

      <div className="prose rev">
        <p>
          Welcome to Pushable (<a href="https://pushable.ai">https://pushable.ai</a>).
          By using our platform, you agree to the following terms:
        </p>

        <h2>Use of Service</h2>
        <p>
          Pushable provides workflow automation and integrations with third-party
          services including Google Drive, Gmail, and Google Calendar.
        </p>
        <p>
          You agree to use the service in compliance with all applicable laws and
          regulations.
        </p>

        <h2>User Responsibilities</h2>
        <p>You are responsible for:</p>
        <ul>
          <li>Maintaining the confidentiality of your account</li>
          <li>
            Ensuring that your use of the platform does not violate any laws
          </li>
        </ul>

        <h2>Google Integration</h2>
        <p>
          Pushable integrates with Google services to provide functionality. By
          using these features, you grant permission to access relevant data as
          required.
        </p>
        <p>
          We only use this data to deliver the requested functionality.
        </p>

        <h2>Third-Party Services</h2>
        <p>
          We may use third-party platforms (such as Composio) to enable
          integrations and automation features.
        </p>

        <h2>Limitation of Liability</h2>
        <p>Pushable is not liable for:</p>
        <ul>
          <li>Data loss caused by third-party services</li>
          <li>Interruptions or downtime</li>
          <li>Misuse of the platform by users</li>
        </ul>

        <h2>Termination</h2>
        <p>
          We reserve the right to suspend or terminate access if terms are
          violated.
        </p>

        <h2>Changes to Terms</h2>
        <p>
          We may update these terms at any time. Continued use of the platform
          constitutes acceptance of the updated terms.
        </p>

        <h2>Contact</h2>
        <p>
          For any queries, contact:{" "}
          <a href="mailto:support@pushable.ai">support@pushable.ai</a>
        </p>
      </div>
    </PageShell>
  );
}
