import { useEffect } from "react";
import { applyTheme } from "../theme.js";

// The copy here is the user's, verbatim, and must stay that way: it is a
// privacy policy, and paraphrasing one is how a claim quietly stops being
// true. In particular "I have the capability to read users' self-entered
// data" is a deliberate admission that follows from choosing
// recoverability over end-to-end encryption, and softening it would make
// this page dishonest.
//
// One thing it asserts that the code has to keep true: "If you delete your
// account, your data is deleted with it." That is supabase/account_deletion.sql
// plus Settings -> Delete my account, and it shipped BEFORE this page did,
// deliberately — a privacy page that claims a feature which does not exist
// is the worst kind of wrong.
export default function Privacy() {
  useEffect(() => {
    applyTheme();
    document.title = "Privacy — Key Budget";
  }, []);

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900 dark:bg-gray-950 dark:text-gray-100">
      <header className="border-b border-gray-200 dark:border-gray-800 px-4 sm:px-6 py-4">
        <a href="/" className="text-lg font-semibold tracking-tight text-[#8e670b] dark:text-[#eebb4d]">
          Key Budget
        </a>
      </header>

      <main className="mx-auto max-w-2xl px-4 sm:px-6 py-10 sm:py-14">
        <h1 className="text-3xl font-semibold tracking-tight mb-8">Privacy</h1>

        <div className="space-y-5 text-[15px] leading-relaxed text-gray-700 dark:text-gray-300">
          <p>
            Key Budget runs entirely on data you enter yourself. It never connects to your bank, so
            there are no logins, account numbers, or card details at risk — because the app never has
            them.
          </p>
          <p>
            Your data is encrypted on the way to the server and on the server&apos;s disks. Nobody can
            read it off the network, and a stolen drive or leaked backup would be useless. The database
            is also set up so that no other user can reach your information.
          </p>
          <p>
            I have the capability to read users&apos; self-entered data. This must be the case so that
            you get your data back if you lose your phone or clear your browser. I don&apos;t read it,
            and it is never shared with or sold to anyone. The database is hosted by Supabase, so their
            systems hold the encrypted data too.
          </p>
          <p>
            You can download everything you&apos;ve entered at any time as a CSV, which opens in Excel
            or Google Sheets. If you delete your account, your data is deleted with it.
          </p>
          <p>This app will never show ads, and your data will never be sold.</p>

          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 pt-4">What I collect</h2>
          <ul className="list-disc pl-5 space-y-1.5">
            <li>Your email address, so you can sign in.</li>
            <li>
              The financial information you enter yourself — transactions, balances, categories.
            </li>
            <li>Nothing else. No analytics, no tracking, no third-party services.</li>
          </ul>

          <p className="pt-2">
            Questions:{" "}
            <a className="underline underline-offset-2" href="mailto:support@keybudget.app">
              support@keybudget.app
            </a>
          </p>
        </div>

        <div className="mt-12 pt-6 border-t border-gray-200 dark:border-gray-800 text-sm">
          <a href="/app" className="underline underline-offset-2">Open the app</a>
        </div>
      </main>
    </div>
  );
}
