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
// — and, since Sign in with Apple landed, supabase/apple_tokens.sql and
// supabase/functions/apple-revoke, which are what makes the sentence
// about Apple's token true rather than aspirational.
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
            Key Budget runs on data you enter yourself. Connecting a bank is optional, off unless
            you turn it on, and all it ever reads is your checking balance — never your transactions.
            Your bank login goes to Plaid and your bank; Key Budget never sees it, and never has your
            account or card numbers either way.
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
            <li>
              If you sign in with Apple or Google, the sign-in happens with them and they tell me your
              email address and nothing else. Signing in with Apple also leaves one token here, kept
              for a single purpose: Apple requires that deleting your account ends Apple&apos;s side of
              the sign-in too, and that token is what does it. It is used for that and nothing else,
              and it is destroyed when your account is.
            </li>
            <li>
              If you connect your bank: your checking balance, the account&apos;s name and last four
              digits, and your bank&apos;s name. More on that below.
            </li>
            <li>Nothing else. No analytics, no tracking, no advertising, nothing sold to anyone.</li>
          </ul>

          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 pt-4">
            Connected accounts (optional)
          </h2>
          <p>
            Connecting a bank is off unless you turn it on, and the app is complete without it. If you
            do connect, Key Budget reads the balance of the one checking account you pick. It never asks
            for, receives or stores your transactions, and never your full account or routing number.
          </p>
          <p>
            Your bank login goes to Plaid and your bank, never to Key Budget. Plaid is the service that
            makes the connection, and the only other company that handles your banking information for
            this app. When you connect, Plaid&apos;s own screen says it can reach your account and
            balance info and your contact info. That is more than Key Budget uses: none of the contact
            info is ever requested from Plaid or stored here. What Plaid holds is covered by{" "}
            <a
              className="underline underline-offset-2"
              href="https://plaid.com/legal/#end-user-privacy-policy"
            >
              Plaid&apos;s privacy policy
            </a>
            , and you can see or delete it at{" "}
            <a className="underline underline-offset-2" href="https://my.plaid.com">
              my.plaid.com
            </a>
            .
          </p>
          <p>
            The key Plaid gives Key Budget for reading your balance is stored encrypted, apart from the
            rest of your data, and nothing in the app itself can read it.
          </p>
          <p>
            Disconnecting, in Settings, ends the connection at Plaid and deletes it here — the key, the
            bank name and the account details — rather than keeping it as inactive. If Plaid can&apos;t be
            reached at that moment, the app keeps trying every hour until it can. Balances already pulled
            stay in your history, the same as ones you typed, and are deleted with your account like
            everything else. Deleting your account ends the connection at Plaid too.
          </p>
          <p>
            Two records outlive a connection, and neither holds a balance. One notes each call to Plaid
            (when, what kind, and whether it worked), so I can see what the service costs. The other
            counts connections made, with the bank&apos;s name and no person attached, because
            Plaid&apos;s plan limits how many there can ever be.
          </p>

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
