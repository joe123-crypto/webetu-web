import type { Metadata } from "next";
import { pageMetadata } from "@/src/lib/site-metadata";

export const metadata: Metadata = pageMetadata({
  title: "AWRS | Privacy & Policy",
  description: "How AWRS handles your data and your Webetu credentials.",
  path: "/privacy-policy",
});

export default function PrivacyPolicyPage() {
  return (
    <main className="app-main policy-page">
      <div className="shell">
        <a className="toplink" href="/login">Back</a>

        <section className="policy-card">
          <h1>Privacy &amp; Policy</h1>
          <p className="policy-updated">Last updated: September 29, 2026</p>
          <p>
            AWRS (Automatic Webetu Reservation System), a Genaie product,
            automates your student meal reservations on the Webetu platform.
            This page explains what we collect and how we use it.
          </p>
        </section>

        <section className="policy-card">
          <h2>The short version</h2>
          <ul>
            <li>Your Webetu username and password are used only to make meal reservations.</li>
            <li>They are encrypted and never sold or shared.</li>
            <li>You can remove them anytime in Settings.</li>
          </ul>
        </section>

        <section className="policy-card">
          <h2>What we collect</h2>
          <ul>
            <li>Account info: your email, name, and user ID from Google or email sign-in.</li>
            <li>Webetu credentials: the username and password used to reserve your meals.</li>
            <li>Preferences: your default restaurant and reservation settings.</li>
            <li>Notifications: whether you want reservation emails.</li>
            <li>Analytics: anonymous usage data.</li>
          </ul>
        </section>

        <section className="policy-card policy-card-highlight">
          <h2>Your Webetu credentials</h2>
          <p>
            Your Webetu username and password are used only to log in to the
            Webetu portal and reserve meals for you. Nothing else.
          </p>
          <ul>
            <li>They are encrypted (AES-256-GCM) and never stored in plain text.</li>
            <li>They are never sold, shared, or used for advertising.</li>
            <li>Only our reservation system uses them, and only to make your reservations.</li>
            <li>You can revoke them anytime in Settings. Once revoked, they are no longer used.</li>
          </ul>
        </section>

        <section className="policy-card">
          <h2>How we use your information</h2>
          <ul>
            <li>To reserve meals for you.</li>
            <li>To send reservation emails, if enabled.</li>
            <li>To keep your account secure and the service running.</li>
          </ul>
          <p>We do not sell your personal information.</p>
        </section>

        <section className="policy-card">
          <h2>Security</h2>
          <p>
            Sensitive credentials are encrypted (AES-256-GCM), sessions use
            secure cookies, and access is limited to the reservation system.
          </p>
        </section>

        <section className="policy-card">
          <h2>Your choices</h2>
          <ul>
            <li>Disconnect your Webetu credentials anytime in Settings.</li>
            <li>Turn off reservation emails in your settings.</li>
            <li>Contact us to remove your account or data.</li>
          </ul>
        </section>

        <section className="policy-card">
          <h2>Contact</h2>
          <p>
            Questions? Email us at{" "}
            <a href="mailto:genaie2027@gmail.com">genaie2027@gmail.com</a>.
          </p>
        </section>
      </div>
    </main>
  );
}
