import LegalPage, { LEGAL_CONTACT } from "@/components/LegalPage";

export const metadata = {
  title: "Privacy Policy · Inoverse",
  description: "How Inoverse collects, uses and protects your data, including data from Gmail and Google Calendar.",
};

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy Policy">
      <p>
        Inoverse is an AI cofounder made by Inovix &amp; Co (“we”, “us”). This policy explains what data Inoverse collects,
        why, who it is shared with, and how you can remove it.
      </p>

      <h2>What we collect</h2>
      <ul>
        <li><b>Your account:</b> your email address and sign-in details, handled by our login provider.</li>
        <li>
          <b>Your company’s workspace:</b> what you and your team add to Inoverse, such as the company profile, team, products,
          tasks, people and leads, evidence, tests, weekly reviews and your chats with Inovo.
        </li>
        <li>
          <b>Voice:</b> when you talk to Inovo, your audio is sent for transcription and the text is used to answer you. We do not
          keep the audio recording.
        </li>
        <li>
          <b>WhatsApp (if you link a number):</b> your phone number and the messages you exchange with Inovo on WhatsApp.
        </li>
        <li>
          <b>Usage:</b> how many AI requests each account and company makes, so we can apply fair-use limits.
        </li>
      </ul>

      <h2>Google user data (Gmail and Google Calendar)</h2>
      <p>If you choose to connect a Google account, Inoverse asks for read-only access:</p>
      <ul>
        <li>
          <b>Gmail (read-only):</b> Inoverse only looks for emails whose subject starts with “Inovo”, for example “Inovo: pitch on
          Friday 3pm”. From those emails it reads the subject, date and text to create a task in your workspace. It does not read,
          store or act on any other email, and it never sends, deletes or changes email.
        </li>
        <li>
          <b>Google Calendar (read-only):</b> Inoverse reads your events for the next 7 days (title, time, location and attendees)
          so Inovo knows your schedule. Events are held briefly in memory and are not saved to our database.
        </li>
        <li>
          <b>Your Google email address</b>, to show which account is connected, and a sign-in token that lets Inoverse keep reading
          the data above. The token is stored on our server and is never shown in the app.
        </li>
      </ul>
      <p>
        Inoverse checks Gmail only while you have the app open. You can disconnect Google at any time from the Tasks panel; this
        deletes the token and revokes Inoverse’s access at Google. You can also remove access from your Google Account settings.
      </p>
      <p>
        <b>Limited Use:</b> Inoverse’s use and transfer to any other app of information received from Google APIs will adhere to
        the{" "}
        <a href="https://developers.google.com/terms/api-services-user-data-policy" target="_blank" rel="noreferrer">
          Google API Services User Data Policy
        </a>
        , including the Limited Use requirements. We do not use Google user data for advertising, we do not sell it, and we do not
        use it to train AI models. People only read it when you ask us to help with your account, when it is needed for security,
        or when the law requires it.
      </p>

      <h2>How we use your data</h2>
      <ul>
        <li>To run Inoverse for you: answer your questions, keep your tasks and meetings in view, and send briefs you ask for.</li>
        <li>To keep the service safe, apply usage limits and fix problems.</li>
      </ul>
      <p>We do not sell your data and we do not show ads.</p>

      <h2>Who we share it with</h2>
      <p>Only the service providers Inoverse runs on, each processing data on our behalf to provide the service:</p>
      <ul>
        <li><b>Supabase</b>: database and sign-in (servers in Singapore).</li>
        <li><b>Vercel</b>: hosting of the app (servers in Singapore).</li>
        <li><b>Google</b>: the Gemini API that runs the AI model, speech and transcription, and the Gmail and Calendar APIs.</li>
        <li><b>Meta</b>: the WhatsApp Business API, only if you link WhatsApp.</li>
      </ul>
      <p>
        Inside Inoverse, a company’s data is visible only to the members of that company. We may disclose data if the law requires
        it.
      </p>

      <h2>Keeping and deleting data</h2>
      <p>
        We keep your workspace data while your account is active. Background job records are deleted after 7 days. To delete your
        account or your company’s data, email us at <a href={`mailto:${LEGAL_CONTACT}`}>{LEGAL_CONTACT}</a> and we will delete it
        within 30 days.
      </p>

      <h2>Security</h2>
      <p>
        Data is sent over encrypted connections (HTTPS). Each company’s data is separated by access rules in the database, and
        connection tokens are only used on our server.
      </p>

      <h2>Children</h2>
      <p>Inoverse is for businesses and is not meant for anyone under 16.</p>

      <h2>Changes</h2>
      <p>If we change this policy, we will update the date at the top of this page.</p>

      <h2>Contact</h2>
      <p>
        Questions or requests: <a href={`mailto:${LEGAL_CONTACT}`}>{LEGAL_CONTACT}</a>
      </p>
    </LegalPage>
  );
}
