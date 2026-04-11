# Security Audit: npm audit CI policy for path-to-regexp ReDoS

**Date:** 2026-04-01
**Scope:** Exploitability of GHSA-j3q9-mxjg-w52f and GHSA-27v5-c462-wpq7 against easy-notion-mcp; CI policy recommendation

## Summary

The path-to-regexp ReDoS vulnerabilities are **not exploitable** against this project. All Express routes are simple static strings with no parameterized segments, optional groups, or wildcards. The CI should be unblocked with a targeted exclusion, not a blanket severity downgrade.

## Exploitability Assessment

### What the vulnerabilities require

Both advisories are ReDoS (Regular Expression Denial of Service) in `path-to-regexp`, the library Express uses to compile route pattern strings into regexes:

- **GHSA-j3q9-mxjg-w52f** (HIGH, CVSS 7.5): Triggered by route patterns containing *sequential optional groups* (e.g., `/:a?/:b?/:c?`). The compiled regex backtracks catastrophically when matching crafted URL paths.
- **GHSA-27v5-c462-wpq7** (MODERATE, CVSS 5.9): Triggered by route patterns containing *multiple wildcards* (e.g., `/*/:param/*`). Same class of issue, different pattern trigger.

**Critical distinction:** The vulnerability is in how complex *route patterns* compile to regex, not in URL input parsing against simple patterns. A static route like `/mcp` compiles to a trivial regex that matches the literal string — there is no backtracking, no matter what URL an attacker sends.

### This project's routes

Every route registered in the Express app is a simple static path:

**Direct routes in `src/http.ts`:**
- `GET /` (health check, line 119)
- `POST /mcp`, `GET /mcp`, `DELETE /mcp` (lines 182-184 or 192-194)
- `GET /callback` (line 168)

**Routes from `mcpAuthRouter` (MCP SDK `dist/cjs/server/auth/router.js`):**
- `/.well-known/oauth-protected-resource`
- `/.well-known/oauth-authorization-server`
- `/authorize`
- `/token`
- `/register`
- `/revoke` (if enabled)

**None of these contain:**
- Route parameters (`:param`)
- Optional segments (`:param?`)
- Wildcards (`*`)
- Regex patterns

**Verdict: Not exploitable.** An attacker cannot trigger catastrophic backtracking against literal string routes regardless of what URL they send. The compiled regexes are simple string comparisons.

### Even if routes changed

For this vulnerability to become exploitable, someone would need to add a route with multiple sequential optional groups or multiple wildcards — an unusual pattern for an MCP server. The risk of future exposure is low.

## CI Recommendation

### Option 2 is correct: Advisory-specific exclusion

**Do not** lower the audit level to `--audit-level=critical` (Option 1). That's a blanket downgrade that would also hide future HIGH-severity findings that *are* exploitable.

**Do not** leave CI failing (Option 3). A permanently red CI desensitizes the team and blocks legitimate work.

**Use `npm audit` with an allowlist** for the specific advisory IDs:

```yaml
- name: Security audit
  if: matrix.node-version == 20
  run: |
    npm audit --audit-level=moderate --omit=dev 2>&1 || {
      # Check if the only failures are the known path-to-regexp advisories
      # that are not exploitable against our static routes.
      # See: .meta/audits/npm-audit-ci-policy-2026-04-01.md
      AUDIT_JSON=$(npm audit --json --omit=dev 2>/dev/null)
      VULN_COUNT=$(echo "$AUDIT_JSON" | jq '[.vulnerabilities | to_entries[] | select(.value.severity == "high" or .value.severity == "critical")] | length')
      KNOWN_COUNT=$(echo "$AUDIT_JSON" | jq '[.vulnerabilities | to_entries[] | select(.key == "path-to-regexp")] | length')
      if [ "$VULN_COUNT" -eq "$KNOWN_COUNT" ]; then
        echo "::warning::npm audit: path-to-regexp ReDoS (not exploitable against static routes). Waiting for upstream fix in 8.4.0+."
        exit 0
      else
        echo "::error::npm audit found new high/critical vulnerabilities beyond the known path-to-regexp advisory"
        npm audit --audit-level=moderate --omit=dev
        exit 1
      fi
    }
```

This approach:
1. Passes cleanly when path-to-regexp is the only HIGH finding
2. Fails immediately if any *new* HIGH/CRITICAL vulnerability appears
3. Emits a CI warning so the exclusion stays visible
4. Automatically resolves itself once Express ships a fixed router dependency

**Also add `--omit=dev`** to the audit. Dev dependencies (vitest/vite toolchain) don't ship to users and shouldn't block CI. The picomatch issue was dev-only and is already fixed.

### Also update `dependency-review-action`

The `dependency-review-action` at line 38 has `fail-on-severity: moderate`. This will also flag path-to-regexp on PRs. Add an `allow-ghsas` parameter:

```yaml
- uses: actions/dependency-review-action@v4
  with:
    fail-on-severity: moderate
    deny-licenses: GPL-3.0, AGPL-3.0
    allow-ghsas: GHSA-j3q9-mxjg-w52f, GHSA-27v5-c462-wpq7
```

This is cleaner than the npm audit workaround — the action natively supports advisory allowlists.

## Application-Level Mitigations

**None needed.** The vulnerability is not exploitable against static routes. Adding request timeout middleware or URL length limits would be defense-in-depth against a non-existent attack surface — unnecessary complexity.

If you later add parameterized routes (unlikely for an MCP server), you could add:
- Request timeout middleware (`express-timeout-handler` or similar)
- URL path length limits

But don't add these preemptively.

## General Policy: Handling Unfixable Audit Findings

For future reference, the right approach for any "unfixable" npm audit finding:

1. **Assess exploitability** against your actual code — most transitive dependency CVEs aren't exploitable in your specific context
2. **If not exploitable:** Add a time-boxed, advisory-specific exclusion with a comment linking to the analysis. Set a calendar reminder to check for the upstream fix monthly.
3. **If exploitable but no fix exists:** Evaluate application-level mitigations. If the dependency is direct, consider alternatives. If transitive, consider overrides (with testing).
4. **Never lower the global audit level** as a workaround — it hides future findings
5. **Never leave CI red** — it trains everyone to ignore failures
6. **Always `--omit=dev`** in CI audit steps — dev toolchain vulns don't affect shipped code

## Positive Patterns

- Adding `npm audit` to CI at all is good practice — many projects skip this
- Running the audit only on one Node version (matrix.node-version == 20) avoids duplicate noise
- The `dependency-review-action` on PRs catches new vulnerabilities at the PR stage, which is the right time

## Session Chain

- Audit conducted directly (no sub-agent delegation needed — scope was narrow and specific)
- Advisory data from: `npm audit --json`, npm registry (`npm view path-to-regexp versions`), route inspection of `src/http.ts` and `node_modules/@modelcontextprotocol/sdk/dist/cjs/server/auth/router.js`
