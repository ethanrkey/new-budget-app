// The full mutation run, sharded across git worktrees.
//
//   node scripts/mutate_all.mjs            (from mobile/, 2 shards)
//   node scripts/mutate_all.mjs --shards 4
//
// WHY THIS EXISTS. The catalog is 415 mutations and each one costs a
// jest run plus eighteen node suites — about two and a half minutes,
// so a serial full run is most of a day. Build 12's took eight hours
// across two laptop sleeps and reached 103 of 202 before it was
// stopped, which is why mutate.mjs has a thirty-minute cap and why
// its header has said "the thing to try is worktrees" ever since.
// This is that.
//
// A MUTATION WRITES TO A FILE, so the shards cannot share a checkout:
// six processes editing one tree would restore each other's work and
// report whatever was left. Each shard gets `git worktree add` — its
// own copy at the same commit — and node_modules is SYMLINKED rather
// than installed, because six real installs is twenty minutes and a
// gigabyte for no benefit.
//
// IT REFUSES A DIRTY TREE. A worktree is made from a commit, so
// uncommitted work would simply not be in the thing being tested,
// and the run would describe a codebase that does not exist.
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = resolve(fileURLToPath(import.meta.url), "../../..");
const SHEDS = resolve(REPO, "..", ".mutate-shards");
const git = (...a) => execFileSync("git", ["-C", REPO, ...a], { encoding: "utf8" }).trim();

// TWO, AND NO MORE (2026-10-31). Six shards and then four crashed the
// owner's Mac on consecutive nights — each shard is a jest run plus, for
// the drive-backed mutations, Vite and Chrome, and macOS logged memory
// pressure (JetsamEvent) both times. Both runs were lost outright, since
// results are merged only at the end. The default is the safe number so
// that a bare invocation is not the dangerous one; asking for more is
// refused rather than trusted.
const MAX_SHARDS = 2;
const asked = Number(process.argv[process.argv.indexOf("--shards") + 1]) || MAX_SHARDS;
if (asked > MAX_SHARDS) {
  console.log(`--shards ${asked} refused: at most ${MAX_SHARDS}. More crashed the machine twice (2026-10-30/31).`);
  process.exit(1);
}
const shards = asked;
const capMinutes = Number(process.argv[process.argv.indexOf("--cap") + 1]) || 600;

if (git("status", "--porcelain")) {
  console.log("The tree is dirty. A worktree is made from a commit, so anything");
  console.log("uncommitted would not be in the run — commit or stash first.");
  process.exit(1);
}
const head = git("rev-parse", "HEAD");
console.log(`full mutation run at ${head.slice(0, 7)}, ${shards} shards, cap ${capMinutes} min each\n`);

mkdirSync(SHEDS, { recursive: true });
const dirs = [];
for (let i = 1; i <= shards; i++) {
  const dir = resolve(SHEDS, `s${i}`);
  if (existsSync(dir)) { try { git("worktree", "remove", "--force", dir); } catch { rmSync(dir, { recursive: true, force: true }); } }
  git("worktree", "add", "--detach", dir, head);
  // SYMLINKED, not installed. The shard runs the same dependencies
  // the real tree runs, which is also the point.
  symlinkSync(resolve(REPO, "node_modules"), resolve(dir, "node_modules"));
  symlinkSync(resolve(REPO, "mobile/node_modules"), resolve(dir, "mobile/node_modules"));
  // AND .env.local, WHICH IS GITIGNORED AND SO NOT IN A WORKTREE.
  // The browser drives read one line out of it — the Supabase origin
  // to intercept — and without it scripts/fixtureApp.mjs throws
  // before Chrome opens. On 2026-10-21 that killed two of four
  // shards inside the first hour, each reported as a broken harness,
  // which it was. SYMLINKED rather than copied: one copy of a file
  // holding a service role key is the only acceptable number.
  const env = resolve(REPO, ".env.local");
  if (existsSync(env)) symlinkSync(env, resolve(dir, ".env.local"));
  dirs.push(dir);
}

const started = Date.now();
const results = await Promise.all(dirs.map((dir, idx) => new Promise((done) => {
  const label = `${idx + 1}/${shards}`;
  const p = spawn("node", ["scripts/mutate.mjs", "--shard", label, "--cap", String(capMinutes)],
    { cwd: resolve(dir, "mobile"), encoding: "utf8" });
  let out = "";
  p.stdout.on("data", (d) => {
    out += d;
    // One line per mutation is six times too much; a survivor is
    // the only thing worth interrupting for.
    for (const line of String(d).split("\n")) {
      if (line.startsWith("SURVIVED")) console.log(`  [shard ${label}] ${line}`);
    }
  });
  p.stderr.on("data", (d) => { out += d; });
  p.on("close", (code) => {
    const m = /^SHARD-RESULT (.+)$/m.exec(out);
    console.log(`  [shard ${label}] finished, exit ${code}`);
    if (m) return done(JSON.parse(m[1]));
    // NO RESULT LINE MEANS THE SHARD STOPPED EARLY — and what it
    // managed before that is still true. The first version threw it
    // away, so a run that printed ten survivors live ended by
    // reporting four: the six from the three shards that died were
    // simply dropped. Salvaged from the shard's own output here, and
    // the shard is STILL marked broken, because a partial shard must
    // not make the run look complete.
    const lines = [...out.matchAll(/^(SURVIVED|killed) +\d*\s*(.+)$/gm)];
    done({
      shard: label,
      ran: lines.length,
      survived: lines.filter((x) => x[1] === "SURVIVED").map((x) => x[2].trim()),
      capped: null, killedBy: [], broken: out.slice(-800),
    });
  });
})));

const mins = Math.round((Date.now() - started) / 60000);
// Hoisted, because the survivor count is worded differently when the
// run did not finish: four out of a partial run is not four.
const complete = () => !capped.length && !results.some((r) => r.broken);
const ran = results.reduce((n, r) => n + r.ran, 0);
const survived = results.flatMap((r) => r.survived);
const capped = results.filter((r) => r.capped);
const killedBy = new Map();
for (const r of results) for (const [t, n] of r.killedBy) killedBy.set(t, (killedBy.get(t) ?? 0) + n);

console.log(`\n${ran} mutations ran across ${shards} shards in ${mins} minutes.`);

// THE MERGED RESULT, ON DISK. An hour of compute used to live only
// in a terminal: when the last step of the 2026-10-21 run turned out
// to be reading the wrong stream, the kill counts behind it were
// already gone and the only way back to them was to run the whole
// thing again. Written before anything is printed, so a crash in the
// reporting below cannot take the data with it.
const RESULT = resolve(REPO, ".mutation-run.json");
writeFileSync(RESULT, JSON.stringify({
  head, shards, mins, ran,
  survived, capped: capped.map((r) => ({ shard: r.shard, before: r.capped })),
  broken: results.filter((r) => r.broken).map((r) => r.shard),
  killedBy: [...killedBy],
}, null, 1));
console.log(`merged result written to ${RESULT}`);
for (const r of results.filter((x) => x.broken)) console.log(`\nSHARD ${r.shard} PRODUCED NO RESULT:\n${r.broken}`);
if (capped.length) {
  console.log(`\n${capped.length} SHARD(S) HIT THE CAP — the run is NOT complete:`);
  for (const r of capped) console.log(`  shard ${r.shard} stopped before: ${r.capped}`);
}
console.log(survived.length
  ? `\n${survived.length} MUTATION(S) SURVIVED${complete() ? "" : " — of the ones that ran"}:`
  : "\nEvery mutation that ran was caught.");
survived.forEach((l) => console.log(`  ${l}`));

// THE SECOND QUESTION, and only a complete run may answer it: which
// tests nothing can kill. Answered here rather than per shard —
// each shard sees a sixth of the kills and would accuse most of the
// suite of being decoration.
if (complete()) {
  // `2>&1`, AND THAT IS THE WHOLE POINT. jest prints its per-test
  // lines to STDERR, and this read only stdout — so the list of
  // tests came back empty, nothing was missing from an empty list,
  // and the run's last word was "All 0 renderer tests die to at
  // least one mutation". A check with no input must never be able
  // to print a pass, so the count is asserted below as well.
  const out = execFileSync("sh", ["-c", "npx jest --verbose 2>&1"],
    { cwd: resolve(REPO, "mobile"), encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  // LINE-ANCHORED, for the reason mutate.mjs is: one of this
  // project's own tests is CALLED "the ✕ removes a bill row, and the
  // rest close up", so an unanchored match invents a test name out
  // of the middle of a passing one.
  const all = [...out.matchAll(/^\s*[✓✕] (.+?)(?: \(\d+ ms\))?$/gm)].map((m) => m[1].trim());
  const never = all.filter((t) => !killedBy.has(t));
  if (all.length === 0) {
    console.log("\nCOULD NOT READ THE TEST LIST — jest printed no per-test lines.");
    console.log('"Which tests can nothing kill" is unanswered, not answered yes.');
  } else console.log(never.length
    ? `\nNO MUTATION KILLED THESE — each is unverified until one is written:\n  ${never.join("\n  ")}`
    : `\nAll ${all.length} renderer tests die to at least one mutation.`);
} else {
  console.log('\n"Which tests can nothing kill" is not answered: the run is incomplete.');
}

for (const dir of dirs) { try { git("worktree", "remove", "--force", dir); } catch { /* leave it for a look */ } }
rmSync(SHEDS, { recursive: true, force: true });
process.exit(survived.length === 0 && complete() ? 0 : 1);
