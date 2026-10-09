import type { ReactNode } from 'react';
import { Wordmark } from '../components/AppShell';
import { useHealth } from '../lib/demo';

const UPDATED = '9 October 2026';

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-7">
      <h2 className="text-[17px] font-semibold tracking-[-0.01em]">{title}</h2>
      <div className="mt-2 space-y-2.5 text-[15px] leading-relaxed text-secondary">{children}</div>
    </section>
  );
}

/**
 * Privacy and terms for the beta, in plain words. Open to anyone (linked from the sign-in page), so testers can read it
 * before accepting an invite.
 */
export function PrivacyPage() {
  const contact = useHealth().data?.supportEmail;
  const reach = contact ? (
    <a className="link-ember" href={`mailto:${contact}`}>
      {contact}
    </a>
  ) : (
    'the person who invited you'
  );
  return (
    <main className="min-h-dvh bg-page px-4 py-10">
      <article className="mx-auto max-w-[680px]">
        <a href="/" className="mb-8 inline-flex items-center gap-2.5 rounded-md">
          <span className="h-2.5 w-2.5 rounded-full bg-ember" aria-hidden />
          <Wordmark className="text-[18px]" />
        </a>
        <h1 className="text-[28px] leading-tight">Privacy and terms</h1>
        <p className="mt-2 text-sm text-muted">For the TradeTime beta. Last updated {UPDATED}.</p>

        <Section title="The short version">
          <p>
            TradeTime is a private journal, time log and expense record for your trading. Your data is yours: only you can see it in
            the app, you can download all of it at any time, and you can delete your account whenever you like. Nothing is sold or
            shared, and there are no ads or tracking.
          </p>
        </Section>

        <Section title="What’s stored">
          <ul className="list-disc space-y-1.5 pl-5">
            <li>Your email address, for signing in.</li>
            <li>What you enter: trades and fills, Plays, journal notes and check-ins, sessions, calendar events, expenses, payouts and settings.</li>
            <li>Files you add, such as chart screenshots and receipts.</li>
            <li>For notifications, an address your browser gives us for each device where you turn them on. It identifies the browser, not you.</li>
            <li>Feedback you send, with your email so a reply can reach you.</li>
          </ul>
          <p>The app uses one cookie, to keep you signed in. There are no analytics or advertising cookies.</p>
        </Section>

        <Section title="Where it’s kept">
          <p>
            Data and files are stored with Supabase, and the app runs on Vercel, both in Sydney, Australia. If an error happens,
            a report with the error, the page and your account’s ID (not your email or data) may go to Sentry so it can be fixed.
            Each of these companies only processes data to run the service.
          </p>
        </Section>

        <Section title="Who can see it">
          <p>
            <strong className="font-medium text-text">In the app, only you.</strong> Every request is checked against your sign-in,
            and the database itself refuses to return anyone else’s records.
          </p>
          <p>
            The person running the beta can see the database through Supabase’s admin tools. They’ll only look when needed to fix a
            problem you’ve reported or to keep the service running, and won’t share what they see.
          </p>
        </Section>

        <Section title="Your control">
          <ul className="list-disc space-y-1.5 pl-5">
            <li>
              <strong className="font-medium text-text">Download:</strong> Settings → Your data → Download my data gives you everything,
              files included, as a zip.
            </li>
            <li>
              <strong className="font-medium text-text">Delete:</strong> Settings → Your data → Delete my account removes your records,
              files and sign-in straight away. Copies in the nightly database backups expire within 30 days.
            </li>
          </ul>
        </Section>

        <Section title="It’s a beta">
          <p>
            TradeTime is free during the beta and offered as it is. Things may change or break, and the beta may end. It’s backed up
            nightly, but please keep your own copy of anything important with Download my data, especially records you need for tax.
          </p>
        </Section>

        <Section title="Not advice">
          <p>
            TradeTime is a record-keeping tool. Nothing in it is financial, investment or tax advice. Statistics, grades and
            "claimable" amounts are calculated from what you enter, so check them with a qualified accountant before relying on them.
          </p>
        </Section>

        <Section title="Questions">
          <p>Ask {reach}, or use Send feedback in the app.</p>
        </Section>
      </article>
    </main>
  );
}
