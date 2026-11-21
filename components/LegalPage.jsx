// Shared layout for the public Privacy Policy and Terms pages (app/privacy, app/terms).
// Google asks for both before an app that reads Gmail can be published.
import Link from "next/link";

export const LEGAL_UPDATED = "21 November 2026";
export const LEGAL_CONTACT = "inovixco@gmail.com";

export default function LegalPage({ title, children }) {
  return (
    <div className="legal">
      <header className="legal-head">
        <Link href="/" className="legal-brand">Inoverse</Link>
        <nav>
          <Link href="/privacy">Privacy</Link>
          <Link href="/terms">Terms</Link>
        </nav>
      </header>
      <main className="legal-body">
        <h1>{title}</h1>
        <p className="legal-updated">Last updated {LEGAL_UPDATED}</p>
        {children}
      </main>
      <footer className="legal-foot">
        © 2026 Inovix &amp; Co · Faisalabad, Pakistan · <a href={`mailto:${LEGAL_CONTACT}`}>{LEGAL_CONTACT}</a>
      </footer>
    </div>
  );
}
