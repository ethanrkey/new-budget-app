// The gate that keeps one real person's finances out of this repo.
//
// A CHECK NOBODY CAN TEST IS A CHECK THAT ROTS, and the way it rots
// is the way that is never noticed: it starts exiting 0 for
// everything and the gate reads green for ever. So this drives the
// real script, as a process, with a real term list.
//
// The list is a temp file handed over with PERSONAL_TERMS, never
// `.personal-terms` at the repo root — writing that file during a
// test would race any other run and could be left behind, which is
// the one file in this repo that must never appear by accident.
import { execFileSync } from "node:child_process";
import { writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SCRIPT = join(ROOT, "scripts", "check_personal.mjs");

let failures = 0, checks = 0;
function eq(label, got, want) {
  checks++;
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) { failures++; console.log(`FAIL  ${label}\n      got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`); }
  else console.log(`PASS  ${label}`);
}
const is = (label, v) => eq(label, !!v, true);

const dir = mkdtempSync(join(tmpdir(), "kb-personal-"));

/** Run the gate with `terms`, and report how it went. `terms === null`
 *  means no list at all, which is the CI case. */
function run(terms, args = []) {
  const env = { ...process.env };
  if (terms == null) env.PERSONAL_TERMS = join(dir, "does-not-exist");
  else {
    const f = join(dir, "terms");
    writeFileSync(f, terms);
    env.PERSONAL_TERMS = f;
  }
  try {
    const out = execFileSync("node", [SCRIPT, ...args], { cwd: ROOT, env, encoding: "utf8" });
    return { code: 0, out };
  } catch (e) {
    return { code: e.status, out: (e.stdout ?? "") + (e.stderr ?? "") };
  }
}

console.log("== the personal-terms gate ==");

// ---- THE DIRECTION THAT MATTERS: it catches something -----------------
//
// "Spotify" is a real string in several tracked files, so it stands in
// for a term that is genuinely present. A term nobody would ever add,
// used here precisely because it IS findable.
{
  const r = run("Spotify\n");
  eq("a term that is in the repo fails", r.code, 1);
  is("...and names the file", /src\/components\/Onboarding\.jsx:\d+/.test(r.out));
  is("...and names the term", /matches "Spotify"/.test(r.out));
  // The matching LINE is never printed: it would be copied into a
  // terminal, a CI log and a screenshot of the failure, which is most
  // of the way to committing it.
  is("...and never prints the line itself", !r.out.includes('placeholder="e.g. Spotify"'));
}

// ---- and the direction that must not be noisy -------------------------
//
// THE SENTINEL IS ASSEMBLED AT RUNTIME, which is not cleverness. This
// file is tracked, so a term written here as a literal is a term the
// gate finds IN THIS FILE — the first version of these two checks
// failed for exactly that reason, which is a small, exact
// demonstration that the gate reads what it says it reads.
const ABSENT = ["zzz", "no", "such", "term", "anywhere", "zzz"].join("-");
{
  const r = run(`${ABSENT}\n`);
  eq("a term that is absent passes", r.code, 0);
  is("...and says so", /PERSONAL TERMS OK/.test(r.out));
}

// ---- the shape of the list -------------------------------------------
{
  eq("comments and blank lines are ignored",
    run("# Spotify\n\n   \n").code, 0);
  is("...and an all-comment list says there is nothing to check",
    /nothing to check/.test(run("# Spotify\n").out));
  eq("matching is case-insensitive", run("sPoTiFy\n").code, 1);
  eq("a trailing newline is not a term", run(`${ABSENT}\n\n`).code, 0);
}

// ---- THE CI CASE: no list, no noise, no failure ----------------------
{
  const r = run(null);
  eq("no list at all exits clean", r.code, 0);
  // A skip is not a pass, and the line has to say which it was, or a
  // machine that silently lost its list reads as green for ever.
  is("...and says it SKIPPED rather than passed", /skipped/i.test(r.out));
  is("...and does not claim OK", !/PERSONAL TERMS OK/.test(r.out));
}

// ---- scoping to given paths, which is what the hook does -------------
{
  eq("a path with no match passes even though the repo has one",
    run("Spotify\n", ["package.json"]).code, 0);
  eq("...and a path WITH one fails",
    run("Spotify\n", ["src/components/Onboarding.jsx"]).code, 1);
}

// ---- the script's own comments must not trip it ----------------------
//
// check_personal.mjs and .gitignore both have to be able to NAME the
// thing they are protecting against. They are excluded, and this is
// the test that notices if that exclusion is ever dropped.
{
  const r = run("personal-terms\n");
  is("the gate does not trip on the files that describe it",
    !/scripts\/check_personal\.mjs|\.gitignore:/.test(r.out));
}

rmSync(dir, { recursive: true, force: true });
console.log(failures ? `\n${failures} FAILED (${checks} checks)` : `\nALL PASS (${checks} checks)`);
process.exit(failures ? 1 : 0);
