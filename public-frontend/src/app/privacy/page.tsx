import type { Metadata } from "next";
import PageShell from "@/components/PageShell";

export const metadata: Metadata = {
  title: "Privacy Policy — Pushable.ai",
  description:
    "Learn how Pushable.ai collects, uses, and protects your data. Your privacy is important to us.",
};

export default function PrivacyPage() {
  return (
    <PageShell>
      <div className="page-header">
        <div className="ey rev">Legal</div>
        <h1 className="rev d1">Privacy Policy</h1>
        <p className="page-date rev d2">
          Last updated: June 2024
        </p>
      </div>

      <div className="prose rev">
        <p>
          Welcome to Pushable (<a href="https://pushable.ai">https://pushable.ai</a>).
          Your privacy is important to us. This Privacy Policy explains how we
          collect, use, and protect your information when you use our platform.
        </p>

        <h2>Information We Collect</h2>
        <p>
          We may collect the following information when you use our services:
        </p>
        <ul>
          <li>
            Personal information such as your name and email address
          </li>
          <li>
            Google account information authorized by you, including access to
            Google Drive, Gmail, and Google Calendar data
          </li>
          <li>Usage data and interaction with our platform</li>
        </ul>

        <h2>How We Use Information</h2>
        <p>We use the collected data to:</p>
        <ul>
          <li>Provide and improve our services</li>
          <li>
            Enable integrations with Google services such as Drive, Gmail, and
            Calendar
          </li>
          <li>Automate workflows and enhance user experience</li>
          <li>Communicate with users regarding updates or support</li>
        </ul>

        <h2>Google User Data</h2>
        <p>
          Pushable accesses Google user data only with your explicit consent. We
          use this data strictly to provide core functionality of our platform.
        </p>
        <p>
          We do not sell, rent, or share your Google user data with third
          parties.
        </p>

        <h2>Third-Party Services</h2>
        <p>
          We use third-party integration providers such as Composio to securely
          process and interact with Google services (Google Drive, Gmail, Google
          Calendar) on your behalf.
        </p>
        <p>
          These services comply with applicable data protection and security
          standards.
        </p>

        <h2>Data Storage and Security</h2>
        <p>
          We implement appropriate technical and organizational measures to
          protect your data from unauthorized access, loss, or misuse.
        </p>

        <h2>Data Sharing</h2>
        <p>
          We do not sell or share your personal data with third parties except:
        </p>
        <ul>
          <li>When required by law</li>
          <li>To provide essential services through trusted partners</li>
        </ul>

        <h2>User Control</h2>
        <p>
          You can revoke access to your Google account at any time through your
          Google account permissions settings.
        </p>

        <h2>Changes to This Policy</h2>
        <p>
          We may update this Privacy Policy from time to time. Updates will be
          posted on this page.
        </p>

        <h2>Contact Us</h2>
        <p>
          If you have any questions, contact us at:{" "}
          <a href="mailto:support@pushable.ai">support@pushable.ai</a>
        </p>
      </div>
    </PageShell>
  );
}
