// The full mutation run, sharded across git worktrees.
//
//   node scripts/mutate_all.mjs            (from mobile/, 6 shards)
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
import { existsSync, mkdirSync, rmSync, symlinkSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = resolve(fileURLToPath(import.meta.url), "../../..");
const SHEDS = resolve(REPO, "..", ".mutate-shards");
const git = (...a) => execFileSync("git", ["-C", REPO, ...a], { encoding: "utf8" }).trim();

const shards = Number(process.argv[process.argv.indexOf("--shards") + 1]) || 6;
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
  const { out } = await (async () => {
    const { execFileSync: run } = await import("node:child_process");
    return { out: run("npx", ["jest", "--verbose"], { cwd: resolve(REPO, "mobile"), encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024 }) };
  })().catch((e) => ({ out: String(e.stdout ?? "") }));
  const all = [...out.matchAll(/[✓✕] (.+?)(?: \(\d+ ms\))?$/gm)].map((m) => m[1].trim());
  const never = all.filter((t) => !killedBy.has(t));
  console.log(never.length
    ? `\nNO MUTATION KILLED THESE — each is unverified until one is written:\n  ${never.join("\n  ")}`
    : `\nAll ${all.length} renderer tests die to at least one mutation.`);
} else {
  console.log('\n"Which tests can nothing kill" is not answered: the run is incomplete.');
}

for (const dir of dirs) { try { git("worktree", "remove", "--force", dir); } catch { /* leave it for a look */ } }
rmSync(SHEDS, { recursive: true, force: true });
process.exit(survived.length === 0 && complete() ? 0 : 1);
