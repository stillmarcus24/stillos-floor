# stillos-floor

**What is your dependency floor standing on?**

```bash
npx github:stillmarcus24/stillos-floor
```

No account. No API key. No config. No signup. It reads your lockfile and prints the dormant, single-maintainer packages your project transitively depends on — the ones nobody chose and everybody has.

---

## The output

Run against a real 94-package MCP server:

```
  DEPENDENCY FLOOR  tradingview-mcp
  94 packages resolved from package-lock.json (lockfileVersion 3)

  You are standing on 15 dormant single-maintainer packages,
  controlled by 9 people.

  package                  reach        maintainer   dormant
  escape-html             79.91%        dougwilson     11.1y
  wrappy                  81.23%            isaacs     10.4y
  once                    81.23%            isaacs      10.1y
  safer-buffer            80.11%           chalker      8.5y
  ...

  Concentration:
    isaacs controls 3 of your floor: once, wrappy, inherits
    sindresorhus controls 3 of your floor: path-key, shebang-regex, merge-descriptors
```

Nine people. Not nine companies, not nine orgs — nine individual npm accounts, under a server that talks to a language model.

## The rule

A package is flagged only if **all three** are true:

1. **reach ≥ 10%** of measured MCP servers
2. **exactly 1** npm maintainer
3. **≥ 2 years** since the last publish

That is the xz-utils precondition: everywhere, one person, quiet.

## Negative controls ship in the data

A rule that flags everything measures nothing. These have the **same reach and the same single maintainer** and are deliberately **not** flagged, because they are actively published:

| package | reach | maintainer | last publish |
|---|---|---|---|
| `zod` | 84.74% | colinhacks | 2026-09-13 |
| `jose` | 80.53% | panva | 2026-09-05 |
| `@hono/node-server` | 80.76% | yusukebe | 2026-09-29 |

`zod` has the highest reach in the entire measured set and one maintainer. It does not fire. That is the rule working.

And it discriminates between projects — measured on four real trees: **15, 6, 6, 0** chokepoints. A 431-dependency project scored *better* than a 94-dependency one. Dependency count is not the finding.

## `--seal`: a receipt a stranger can check

```bash
npx github:stillmarcus24/stillos-floor --seal
```

Commits a SHA-256 of your report to a public, append-only, Ed25519-signed notary chain and gives you a badge that links to it:

[![dependency floor](https://img.shields.io/badge/dependency%20floor-15%20chokepoints-critical)](https://stillosdigitalholdings.com/notary/verify?hash=59454f426b65a63a805922479c2d446cdc100726c940361f5412677d7b4e49dc)

Anyone can verify it without trusting us or this tool:

```bash
curl "https://stillosdigitalholdings.com/notary/verify?hash=<your hash>"
# {"found":true,"hash_intact":true,"signature_valid":true}
```

**Your lockfile never leaves your machine.** `--seal` transmits a SHA-256 of the report plus a one-line summary — never the dependency list. A lockfile is a fingerprint of a private codebase and does not need to be uploaded for a receipt to be verifiable. Without `--seal`, the tool makes **no network calls at all**.

## Honest scope

- **Reach is measured across 8,534 public MCP servers**, not across npm as a whole. "80% of servers" means 80% of that population. Census date ships in every report.
- **A dormant single-maintainer package is a vulnerability, not a crime**, and this is not an accusation against any maintainer. Several of these are dormant because they are *finished*. `escape-html` has not needed a commit since 2015 because it does one thing correctly. The risk is structural — a quiet account is a quieter target — not a judgment about the person.
- **No lockfile, no answer.** Given only a `package.json`, the tool **refuses to run** rather than report a clean bill of health, because a direct-dependency read would miss the transitive floor entirely and print a false all-clear. `pnpm`/`yarn`/`bun` lockfiles are named as unsupported rather than silently under-read.
- This checks **who and when**, not whether any specific version is compromised. It is a map of where a compromise would be most effective.

## Why this exists

Supply-chain scanners grade a package *as it is now*. The xz backdoor was not visible that way: the package was fine, the **maintainer situation** was the vulnerability — one burned-out person, a patient stranger, three years. This measures that shape instead.

Measured 2026-10-06: the leading MCP trust index grades **40,541 servers** and surfaces **0 of these 15** chokepoints. Not because it is bad — because it is answering a different question.

```bash
npx github:stillmarcus24/stillos-floor --list    # the whole floor, with the negative controls
npx github:stillmarcus24/stillos-floor --json    # machine-readable
```

MIT. Node ≥ 18. Zero dependencies.
