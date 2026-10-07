#!/usr/bin/env node
/**
 * stillos-floor — what your project's dependency floor is standing on.
 *
 * ONE COMMAND. NO ACCOUNT. NO KEY. NO CONFIG. NO NETWORK (unless you ask).
 *
 * Why this shape and not another dashboard: measured 2026-10-07, Heretic
 * (p-e-w/heretic) does 15,277,659 downloads/30d while every package StillOS has
 * ever published does 1,119 combined — a 13,653x gap. Reading its repo, the
 * difference is not the algorithm. It is that (a) it installs and runs in one
 * command, (b) it needs no expertise, and (c) **it hands the user an artifact
 * they publish under their own name**. 7,965 models exist because 7,965 strangers
 * each made one and uploaded it to their own account. The users did the
 * distributing. This tool is built to that shape deliberately.
 *
 * WHAT IT DOES: your project depends on packages. Those packages depend on others.
 * At the very bottom sit a handful of tiny, ancient, single-maintainer packages
 * that almost everything transitively needs. That is your floor. This prints which
 * of those YOU are standing on, who maintains each one, and how long it has been
 * since anyone published it.
 *
 * THE RULE, stated so you can disagree with it:
 *   reach >= 10% of measured MCP servers  AND  exactly 1 npm maintainer
 *   AND  >= 2 years since the last publish
 * All three. That is the xz-utils precondition: a dependency that is everywhere,
 * controlled by one person, and quiet.
 *
 * NEGATIVE CONTROLS ARE SHIPPED IN THE DATA, which is what makes it a measurement
 * and not a scare. `zod` has 84.74% reach and ONE maintainer and does NOT fire,
 * because it published 18 days before the census. If a rule flags everything, it
 * measures nothing.
 *
 * HONEST SCOPE — read before quoting a number out of this:
 *   - Reach percentages are measured across 8,534 public MCP servers, NOT across
 *     npm as a whole. "80% of servers" means 80% of that population.
 *   - A dormant single-maintainer package is a VULNERABILITY, not a crime, and
 *     not an accusation against any maintainer. Several of these are dormant
 *     because they are finished. `escape-html` has not needed a commit since 2015
 *     because it does one thing correctly.
 *   - This reads your lockfile. It does not execute your code, phone home, or
 *     transmit anything anywhere unless you explicitly pass --seal.
 *
 * Usage:
 *   npx stillos-floor                 # audit the project in the current directory
 *   npx stillos-floor --json          # machine-readable
 *   npx stillos-floor --badge         # print README markdown you can paste
 *   npx stillos-floor --seal          # ALSO publish a verifiable receipt (network)
 *   npx stillos-floor --list          # show the whole floor, not just your exposure
 *   npx stillos-floor --self-test
 */

'use strict';

const fs = require('fs');
const path = require('path');

const DATA = require('./floor-data.json');
const VERSION = require('./package.json').version;
const SEAL_ENDPOINT = 'https://stillosdigitalholdings.com/provenance';
const VERIFY_BASE = 'https://stillosdigitalholdings.com/notary/verify?hash=';

// ───────────────────────────── dependency discovery ─────────────────────────────

/**
 * Collect every package name the project actually resolves, from the lockfile.
 *
 * The lockfile is the only honest source: package.json lists what you ASKED for,
 * and the whole point of this tool is the floor you never asked for. A
 * package.json-only read would report ~0 chokepoints for almost every project and
 * look like a clean bill of health — a false all-clear, which is worse than no
 * tool. So if there is no lockfile we say so and refuse to pretend.
 */
function collectDependencies(dir) {
  const npmLock = path.join(dir, 'package-lock.json');
  if (fs.existsSync(npmLock)) {
    let j;
    try { j = JSON.parse(fs.readFileSync(npmLock, 'utf8')); }
    catch (e) { return { ok: false, reason: `package-lock.json is not valid JSON: ${e.message}` }; }
    const names = new Set();
    // lockfileVersion 2/3: `packages` keyed by install path.
    for (const k of Object.keys(j.packages || {})) {
      if (!k) continue;                                   // "" is the root project itself
      const m = k.lastIndexOf('node_modules/');
      if (m === -1) continue;                             // a workspace/link entry, not a dep
      names.add(k.slice(m + 'node_modules/'.length));
    }
    // lockfileVersion 1: `dependencies`, nested.
    const walk = (o) => {
      for (const [n, v] of Object.entries(o || {})) { names.add(n); if (v && v.dependencies) walk(v.dependencies); }
    };
    if (names.size === 0) walk(j.dependencies);
    return { ok: true, source: `package-lock.json (lockfileVersion ${j.lockfileVersion ?? 1})`, transitive: true, names };
  }

  // Other lockfile formats are NAMED as unsupported rather than silently
  // falling back to a direct-dependency read that would under-report.
  for (const [f, tool] of [['pnpm-lock.yaml', 'pnpm'], ['yarn.lock', 'yarn'], ['bun.lockb', 'bun']]) {
    if (fs.existsSync(path.join(dir, f))) {
      return { ok: false, reason: `found ${f} — ${tool} lockfiles are not supported yet. Run \`npm install --package-lock-only\` to generate a package-lock.json without touching node_modules, then re-run.` };
    }
  }
  if (fs.existsSync(path.join(dir, 'package.json'))) {
    return { ok: false, reason: 'no lockfile found. A package.json-only read would miss the transitive floor entirely and report a false all-clear. Run `npm install --package-lock-only` first.' };
  }
  return { ok: false, reason: `no package.json in ${dir} — is this a Node project?` };
}

// ───────────────────────────── the audit ─────────────────────────────

function audit(dir = process.cwd()) {
  const deps = collectDependencies(dir);
  if (!deps.ok) return { ok: false, ...deps };

  const hit = DATA.chokepoints.filter((c) => deps.names.has(c.pkg));
  const controls = DATA.negative_controls.filter((c) => deps.names.has(c.pkg));
  const maintainers = [...new Set(hit.map((c) => c.maintainer))];

  // Concentration is the finding people miss: not "15 risky packages" but
  // "N people". If one maintainer owns several of your floor, your real
  // single-point-of-failure count is smaller than the package count suggests.
  const byMaintainer = {};
  for (const c of hit) (byMaintainer[c.maintainer] ||= []).push(c.pkg);

  let projectName = path.basename(dir);
  try { projectName = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).name || projectName; } catch { /* keep dir name */ }

  return {
    ok: true,
    project: projectName,
    tool: `stillos-floor@${VERSION}`,
    dependency_source: deps.source,
    dependencies_resolved: deps.names.size,
    floor_universe: DATA.universe_packages,
    servers_measured: DATA.servers_measured,
    census_as_of: DATA.as_of,
    rule: DATA.rule,
    exposure_count: hit.length,
    distinct_maintainers: maintainers.length,
    exposures: hit.sort((a, b) => b.dormant_years - a.dormant_years),
    by_maintainer: Object.entries(byMaintainer).map(([m, pkgs]) => ({ maintainer: m, packages: pkgs }))
      .sort((a, b) => b.packages.length - a.packages.length),
    // Shipped in every report so the rule can be checked, not just trusted.
    negative_controls_in_your_tree: controls,
    oldest_dormancy_years: hit.length ? Math.max(...hit.map((c) => c.dormant_years)) : 0,
  };
}

// ───────────────────────────── output ─────────────────────────────

const B = (s) => (process.stdout.isTTY ? `\x1b[1m${s}\x1b[0m` : s);
const DIM = (s) => (process.stdout.isTTY ? `\x1b[2m${s}\x1b[0m` : s);

function render(r) {
  if (!r.ok) {
    console.log(`\n  ${B('stillos-floor')} — cannot audit this directory.\n\n  ${r.reason}\n`);
    return 2;
  }
  const L = [];
  L.push('');
  L.push(`  ${B('DEPENDENCY FLOOR')}  ${r.project}`);
  L.push(DIM(`  ${r.dependencies_resolved} packages resolved from ${r.dependency_source}`));
  L.push('');

  if (r.exposure_count === 0) {
    L.push(`  ${B('0')} floor chokepoints in your tree.`);
    L.push(DIM(`  Checked against ${r.floor_universe} packages measured across ${r.servers_measured.toLocaleString()} MCP servers (census ${r.census_as_of}).`));
    L.push(DIM('  This is a real zero, not an empty check: the same rule fires on 15 packages elsewhere.'));
  } else {
    L.push(`  You are standing on ${B(r.exposure_count)} dormant single-maintainer ${r.exposure_count === 1 ? 'package' : 'packages'},`);
    L.push(`  controlled by ${B(r.distinct_maintainers)} ${r.distinct_maintainers === 1 ? 'person' : 'people'}.`);
    L.push('');
    L.push(DIM(`  ${'package'.padEnd(22)}${'reach'.padStart(8)}${'maintainer'.padStart(18)}${'dormant'.padStart(10)}`));
    for (const c of r.exposures) {
      L.push(`  ${c.pkg.padEnd(22)}${(c.pct + '%').padStart(8)}${c.maintainer.padStart(18)}${(c.dormant_years + 'y').padStart(10)}`);
    }
    if (r.by_maintainer.length && r.by_maintainer[0].packages.length > 1) {
      L.push('');
      L.push(`  ${B('Concentration:')}`);
      for (const m of r.by_maintainer.filter((x) => x.packages.length > 1)) {
        L.push(`    ${m.maintainer} controls ${m.packages.length} of your floor: ${m.packages.join(', ')}`);
      }
    }
  }

  if (r.negative_controls_in_your_tree.length) {
    L.push('');
    L.push(DIM(`  Not flagged (same reach, same single maintainer, but actively published):`));
    L.push(DIM(`    ${r.negative_controls_in_your_tree.map((c) => `${c.pkg} (${c.last_publish})`).join(', ')}`));
  }

  L.push('');
  L.push(DIM(`  Rule: ${r.rule}`));
  L.push(DIM('  A dormant package is a vulnerability, not a crime, and not an accusation.'));
  L.push(DIM('  Several are dormant because they are finished.'));
  L.push('');
  console.log(L.join('\n'));
  return r.exposure_count > 0 ? 1 : 0;
}

/** The artifact the user owns and publishes. This is the distribution surface. */
function badge(r, receiptHash) {
  if (!r.ok) return '';
  const colour = r.exposure_count === 0 ? 'brightgreen' : (r.exposure_count >= 10 ? 'critical' : 'orange');
  const label = r.exposure_count === 0 ? 'clear' : `${r.exposure_count}%20chokepoints`;
  const img = `https://img.shields.io/badge/dependency%20floor-${label}-${colour}`;
  const link = receiptHash ? `${VERIFY_BASE}${receiptHash}` : 'https://www.npmjs.com/package/stillos-floor';
  const lines = [
    `[![dependency floor](${img})](${link})`,
    '',
    `<!-- generated by stillos-floor@${VERSION} — census ${r.census_as_of}, ${r.servers_measured.toLocaleString()} MCP servers -->`,
  ];
  if (receiptHash) lines.push(`<!-- verifiable receipt: ${VERIFY_BASE}${receiptHash} -->`);
  return lines.join('\n');
}

/**
 * Optional, explicit, opt-in: commit a hash of this report to a public
 * append-only notary chain so the badge links to something a stranger can
 * recompute. Nothing is sent unless --seal is passed, and what is sent is named
 * below rather than described vaguely.
 */
async function seal(r) {
  const payload = {
    tool: r.tool, project: r.project, census_as_of: r.census_as_of,
    exposure_count: r.exposure_count, distinct_maintainers: r.distinct_maintainers,
    exposures: r.exposures.map((c) => c.pkg),
  };
  // The endpoint's real contract is `{ token | token_sha256, answer? }` — checked
  // against the live GET /provenance contract rather than assumed. We send ONLY a
  // SHA-256 of the report plus the one-line summary, never the raw dependency
  // list: a lockfile is a fingerprint of a private codebase and does not need to
  // leave the user's machine for the receipt to be verifiable.
  const canonical = JSON.stringify(payload);
  const token_sha256 = require('crypto').createHash('sha256').update(canonical).digest('hex');
  const answer = `stillos-floor ${VERSION}: ${r.exposure_count} dormant single-maintainer chokepoints controlled by ${r.distinct_maintainers} maintainers, census ${r.census_as_of}`;
  try {
    const res = await fetch(SEAL_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'user-agent': `stillos-floor/${VERSION}` },
      body: JSON.stringify({ token_sha256, answer, agent: 'stillos-floor' }),
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) return { ok: false, reason: `HTTP ${res.status}` };
    const j = await res.json();
    // Field location checked against a real live response, not guessed: the hash
    // is at `receipt.receipt_hash`. The first version of this guessed `j.hash` and
    // correctly reported FAILURE rather than printing a dead link — which is the
    // only reason the wrong path was caught at all.
    const hash = (j.receipt && (j.receipt.receipt_hash || j.receipt.hash)) || j.receipt_hash || j.hash;
    if (!hash) return { ok: false, reason: 'response carried no receipt hash', body: j };

    // A seal is NOT confirmed by "nothing threw" and not by a hash coming back —
    // the badge links a stranger to this URL, so this round-trips the PUBLIC
    // verifier before claiming success. A badge pointing at an unverifiable
    // receipt is worse than no badge.
    try {
      const v = await fetch(VERIFY_BASE + hash, { signal: AbortSignal.timeout(15000) });
      const vj = await v.json();
      if (!(vj.found && vj.hash_intact && vj.signature_valid)) {
        return { ok: false, reason: `receipt did not verify publicly (found=${vj.found} intact=${vj.hash_intact} sig=${vj.signature_valid})` };
      }
      return { ok: true, hash, verify: VERIFY_BASE + hash, verified: true };
    } catch (e) {
      return { ok: false, reason: `receipt created but public verification failed: ${String(e.message || e)}` };
    }
  } catch (e) {
    return { ok: false, reason: String(e.message || e) };
  }
}

function listFloor() {
  console.log(`\n  ${B('THE FLOOR')} — ${DATA.chokepoints.length} packages meeting all three conditions`);
  console.log(DIM(`  measured across ${DATA.servers_measured.toLocaleString()} public MCP servers, census ${DATA.as_of}\n`));
  console.log(DIM(`  ${'package'.padEnd(24)}${'reach'.padStart(8)}${'servers'.padStart(9)}${'maintainer'.padStart(16)}${'dormant'.padStart(10)}`));
  for (const c of DATA.chokepoints) {
    console.log(`  ${c.pkg.padEnd(24)}${(c.pct + '%').padStart(8)}${String(c.servers).padStart(9)}${c.maintainer.padStart(16)}${(c.dormant_years + 'y').padStart(10)}`);
  }
  console.log(`\n  ${B('Negative controls')} — same reach, same single maintainer, NOT flagged:`);
  console.log(DIM(`  ${'package'.padEnd(24)}${'reach'.padStart(8)}${'maintainer'.padStart(16)}${'last publish'.padStart(14)}`));
  for (const c of DATA.negative_controls) {
    console.log(DIM(`  ${c.pkg.padEnd(24)}${(c.pct + '%').padStart(8)}${c.maintainer.padStart(16)}${c.last_publish.padStart(14)}`));
  }
  console.log(DIM('\n  If a rule flags everything, it measures nothing. These are why the rule is a rule.\n'));
}

// ───────────────────────────── self-test ─────────────────────────────
function selfTest() {
  let pass = 0, fail = 0;
  const ok = (n, c) => { if (c) pass++; else { fail++; console.log(`  FAIL ${n}`); } };
  const os = require('os');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'floor-'));

  ok('data ships chokepoints', DATA.chokepoints.length > 0);
  ok('data ships NEGATIVE CONTROLS (a rule with none is a scare)', DATA.negative_controls.length > 0);
  ok('every chokepoint satisfies all three conditions',
    DATA.chokepoints.every((c) => c.pct >= 10 && c.dormant_years >= 2 && c.maintainer));
  ok('every negative control FAILS the dormancy condition',
    DATA.negative_controls.every((c) => c.dormant_years < 2));
  ok('chokepoints and controls are disjoint',
    !DATA.chokepoints.some((c) => DATA.negative_controls.some((n) => n.pkg === c.pkg)));

  // no lockfile -> must REFUSE, never return a clean bill of health
  fs.writeFileSync(path.join(tmp, 'package.json'), JSON.stringify({ name: 'p', dependencies: { once: '^1.4.0' } }));
  const noLock = audit(tmp);
  ok('package.json without a lockfile is REFUSED, not reported as 0 exposures', noLock.ok === false);
  ok('refusal names the fix', /package-lock-only/.test(noLock.reason));

  // lockfile v3 -> transitive names, including nested ones
  fs.writeFileSync(path.join(tmp, 'package-lock.json'), JSON.stringify({
    lockfileVersion: 3,
    packages: {
      '': { name: 'p' },
      'node_modules/once': { version: '1.4.0' },
      'node_modules/wrappy': { version: '1.0.2' },
      'node_modules/zod': { version: '4.6.5' },
      'node_modules/foo/node_modules/escape-html': { version: '1.0.3' },
      'node_modules/@scope/thing': { version: '1.0.0' },
    },
  }));
  const r = audit(tmp);
  ok('lockfile v3 parsed', r.ok && /lockfileVersion 3/.test(r.dependency_source));
  ok('finds top-level chokepoints', r.exposures.some((c) => c.pkg === 'once'));
  ok('finds NESTED transitive chokepoints', r.exposures.some((c) => c.pkg === 'escape-html'));
  ok('scoped package name parsed correctly', r.dependencies_resolved === 5);
  ok('root "" entry is not counted as a dependency', !r.exposures.some((c) => c.pkg === ''));
  ok('zod appears as a NEGATIVE CONTROL, not an exposure',
    !r.exposures.some((c) => c.pkg === 'zod') && r.negative_controls_in_your_tree.some((c) => c.pkg === 'zod'));
  ok('maintainer concentration computed', r.by_maintainer.find((m) => m.maintainer === 'isaacs').packages.length === 2);
  ok('distinct maintainers < package count when one person owns several',
    r.distinct_maintainers < r.exposure_count);
  ok('oldest dormancy reported', r.oldest_dormancy_years > 10);

  // a clean tree is a REAL zero and says so
  const clean = fs.mkdtempSync(path.join(os.tmpdir(), 'floor-clean-'));
  fs.writeFileSync(path.join(clean, 'package.json'), JSON.stringify({ name: 'c' }));
  fs.writeFileSync(path.join(clean, 'package-lock.json'), JSON.stringify({ lockfileVersion: 3, packages: { '': {}, 'node_modules/zod': {} } }));
  const cr = audit(clean);
  ok('clean tree reports 0 exposures', cr.ok && cr.exposure_count === 0);
  ok('clean tree still reports its negative control', cr.negative_controls_in_your_tree.length === 1);

  // unsupported lockfiles are NAMED, not silently under-reported
  const pn = fs.mkdtempSync(path.join(os.tmpdir(), 'floor-pnpm-'));
  fs.writeFileSync(path.join(pn, 'package.json'), '{}');
  fs.writeFileSync(path.join(pn, 'pnpm-lock.yaml'), 'lockfileVersion: 9');
  ok('pnpm lockfile refused by name, not silently skipped', audit(pn).ok === false && /pnpm/.test(audit(pn).reason));

  // badge
  const b = badge(r);
  ok('badge is pasteable markdown', b.startsWith('[![dependency floor]('));
  ok('badge encodes the real count', b.includes(`${r.exposure_count}%20chokepoints`));
  ok('badge carries census provenance', b.includes(DATA.as_of));
  ok('badge links to a verifiable receipt when sealed', badge(r, 'abc123').includes('notary/verify?hash=abc123'));
  ok('clean tree badge says clear, not a count', badge(cr).includes('clear'));

  ok('malformed lockfile is refused with a reason, not a crash', (() => {
    const bad = fs.mkdtempSync(path.join(os.tmpdir(), 'floor-bad-'));
    fs.writeFileSync(path.join(bad, 'package.json'), '{}');
    fs.writeFileSync(path.join(bad, 'package-lock.json'), '{not json');
    const x = audit(bad); return x.ok === false && /not valid JSON/.test(x.reason);
  })());
  ok('missing project dir refused', audit(path.join(tmp, 'nope')).ok === false);

  console.log(`\nself-test: ${pass} passed, ${fail} failed`);
  return fail === 0;
}

// ───────────────────────────── main ─────────────────────────────
async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--self-test')) process.exit(selfTest() ? 0 : 1);
  if (argv.includes('--version')) return console.log(VERSION);
  if (argv.includes('--list')) return listFloor();

  const dirArg = argv.find((a) => !a.startsWith('--'));
  const r = audit(dirArg ? path.resolve(dirArg) : process.cwd());

  if (argv.includes('--json')) {
    console.log(JSON.stringify(r, null, 2));
    return process.exit(r.ok ? 0 : 2);
  }

  const code = render(r);
  if (!r.ok) return process.exit(code);

  let receipt = null;
  if (argv.includes('--seal')) {
    process.stdout.write('  sealing a public receipt... ');
    const s = await seal(r);
    if (s.ok) { receipt = s.hash; console.log(`done\n  ${B('verify:')} ${s.verify}\n`); }
    else console.log(`FAILED (${s.reason}) — badge will link to the package instead\n`);
  }
  if (argv.includes('--badge') || argv.includes('--seal')) {
    console.log(`  ${B('Paste into your README:')}\n`);
    console.log(badge(r, receipt).split('\n').map((l) => '  ' + l).join('\n'));
    console.log('');
  } else if (r.ok) {
    console.log(DIM('  --badge for a README badge · --seal for a verifiable receipt · --list for the whole floor\n'));
  }
  process.exit(code);
}

if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });
module.exports = { audit, collectDependencies, badge, selfTest, DATA };
