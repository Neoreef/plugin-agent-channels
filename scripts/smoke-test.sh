#!/usr/bin/env bash
#
# smoke-test.sh — Reinstall re-verification for the Agent Channels plugin.
#
# Run this AFTER every plugin reinstall or Zoho API console change. It encodes
# the re-verification checklist from NEO-78 / the Agent Channels plan (NEO-72,
# item 4) as runnable assertions and EXITS NON-ZERO if any required check fails.
#
# Check categories
# ----------------
#   1. SOURCE   — static assertions against the repo (always run, no network).
#                 These catch regressions where a reinstall ships code whose
#                 manifest keys, webhook wiring, OAuth state, or callback URL
#                 drifted from what the live Zoho console expects.
#   2. LIVE     — HTTP probes against the deployed reverse-proxy endpoints.
#                 Run when SMOKE_LIVE=1 (or --live). If the host is unreachable
#                 they are skipped unless SMOKE_REQUIRE_LIVE=1 (then they fail).
#   3. MANUAL   — assertions a script cannot prove on its own (Zoho console
#                 redirect URI, full Connect → tokenValid round-trip). Printed
#                 as a checklist; with SMOKE_MANUAL=1 (or --manual) each is an
#                 interactive y/n prompt and a "no" fails the run.
#
# Usage
# -----
#   scripts/smoke-test.sh                # SOURCE checks only (CI-safe default)
#   SMOKE_LIVE=1 scripts/smoke-test.sh   # SOURCE + LIVE HTTP probes
#   scripts/smoke-test.sh --live --manual
#   SMOKE_BASE_URL=https://staging.example.com SMOKE_LIVE=1 scripts/smoke-test.sh
#
# Environment
# -----------
#   SMOKE_BASE_URL       Public base URL of the deployment (default below).
#   SMOKE_LIVE=1         Enable LIVE HTTP probes.
#   SMOKE_REQUIRE_LIVE=1 Treat an unreachable host as a failure (implies LIVE).
#   SMOKE_MANUAL=1       Turn MANUAL checks into interactive y/n prompts.
#
set -uo pipefail

BASE_URL="${SMOKE_BASE_URL:-https://cortex.neoreef.com}"
EXPECTED_CALLBACK_URL="${BASE_URL}/oauth/callback"
EXPECTED_CLIQ_URL="${BASE_URL}/cliq"

LIVE="${SMOKE_LIVE:-0}"
REQUIRE_LIVE="${SMOKE_REQUIRE_LIVE:-0}"
MANUAL="${SMOKE_MANUAL:-0}"

for arg in "$@"; do
  case "$arg" in
    --live) LIVE=1 ;;
    --require-live) LIVE=1; REQUIRE_LIVE=1 ;;
    --manual) MANUAL=1 ;;
    -h|--help)
      sed -n '2,40p' "$0" | sed 's/^# \{0,1\}//'
      exit 0 ;;
    *) echo "unknown argument: $arg" >&2; exit 2 ;;
  esac
done
[ "$REQUIRE_LIVE" = "1" ] && LIVE=1

# Resolve repo root from this script's location so it runs from anywhere.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

PASS=0; FAIL=0; SKIP=0
green() { printf '\033[32m%s\033[0m' "$1"; }
red()   { printf '\033[31m%s\033[0m' "$1"; }
yellow(){ printf '\033[33m%s\033[0m' "$1"; }

ok()   { PASS=$((PASS+1)); printf '  %s %s\n' "$(green '✓ PASS')" "$1"; }
bad()  { FAIL=$((FAIL+1)); printf '  %s %s\n' "$(red   '✗ FAIL')" "$1"; [ -n "${2:-}" ] && printf '         %s\n' "$2"; }
skip() { SKIP=$((SKIP+1)); printf '  %s %s\n' "$(yellow '— SKIP')" "$1"; [ -n "${2:-}" ] && printf '         %s\n' "$2"; }
section() { printf '\n%s\n' "$1"; }

# assert_grep <regex> <file> <description>
assert_grep() {
  local re="$1" file="$2" desc="$3"
  if [ ! -f "$REPO_ROOT/$file" ]; then
    bad "$desc" "missing file: $file"; return
  fi
  if grep -Eq "$re" "$REPO_ROOT/$file"; then
    ok "$desc"
  else
    bad "$desc" "pattern not found in $file: $re"
  fi
}

# ─────────────────────────────────────────────────────────────────────────────
section "SOURCE checks (repo assertions)"

# Check 4 — Manifest webhook keys present and registered.
assert_grep 'endpointKey:[[:space:]]*"cliq-message"'   src/manifest.ts  "manifest declares webhook 'cliq-message'"
assert_grep 'endpointKey:[[:space:]]*"oauth-callback"' src/manifest.ts  "manifest declares webhook 'oauth-callback'"
assert_grep 'cliq:[[:space:]]*"cliq-message"'           src/constants.ts "WEBHOOK_KEYS.cliq = 'cliq-message'"
assert_grep 'oauthCallback:[[:space:]]*"oauth-callback"' src/constants.ts "WEBHOOK_KEYS.oauthCallback = 'oauth-callback'"
# onWebhook dispatches oauth-callback directly and all channel webhooks (incl.
# cliq-message) through the channel registry (src/lib/channel-registry.ts).
assert_grep 'WEBHOOK_KEYS\.oauthCallback'         src/worker.ts            "worker.onWebhook routes oauth-callback (WEBHOOK_KEYS.oauthCallback)"
assert_grep 'getChannel\(input\.endpointKey\)'    src/worker.ts            "worker.onWebhook dispatches inbound webhooks via the channel registry"
assert_grep 'webhookKey:[[:space:]]*WEBHOOK_KEYS\.cliq' src/modules/cliq/index.ts "cliq channel module claims webhookKey WEBHOOK_KEYS.cliq"
assert_grep 'registerChannel\(cliqChannel\)'      src/channels.ts          "cliq channel registered into the webhook registry"

# Check 5 — state.pluginId includes 'agent-channels' in the connect-URL builder.
assert_grep 'pluginId:[[:space:]]*"agent-channels"' src/worker.ts "connect-url builder embeds state.pluginId = 'agent-channels'"

# Supporting — callback + Cliq webhook URLs are host-agnostic (NEO-273): the UI
# derives both from window.location.origin so it serves the correct host on live
# AND beta, rather than hardcoding the live host. The actual per-host URLs are
# verified against the deployment by the LIVE HTTP probes below.
assert_grep 'window\.location\.origin' src/ui/index.tsx "UI derives URLs from window.location.origin (host-agnostic)"
assert_grep 'originBase\(\)\}/oauth/callback' src/ui/index.tsx "UI default callback URL derived from origin (\${origin}/oauth/callback)"
assert_grep 'originBase\(\)\}/cliq'           src/ui/index.tsx "UI Cliq webhook URL derived from origin (\${origin}/cliq)"

# ─────────────────────────────────────────────────────────────────────────────
section "LIVE checks (HTTP probes against ${BASE_URL})"

# Number of attempts for a live probe — tolerate a single transient blip
# (the proxy occasionally returns a momentary 5xx mid-reinstall) but still fail
# if the endpoint is consistently unhealthy.
HTTP_ATTEMPTS="${SMOKE_HTTP_ATTEMPTS:-3}"

http_status() {
  # http_status <method> <url> [data] — returns the first 200, else the last code.
  local method="$1" url="$2" data="${3:-}" code="" i=1
  # Default to an empty JSON object. Note: do NOT inline this as "${data:-{}}" —
  # that ${var:-{}} expansion leaves a stray trailing '}', sending malformed JSON
  # like {"smoke":"test"}} which a strict /cliq handler rejects with HTTP 500.
  [ -n "$data" ] || data='{}'
  while [ "$i" -le "$HTTP_ATTEMPTS" ]; do
    if [ "$method" = "POST" ]; then
      code="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 15 \
        -X POST -H 'Content-Type: application/json' --data "$data" "$url" 2>/dev/null)"
    else
      code="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 15 "$url" 2>/dev/null)"
    fi
    [ "$code" = "200" ] && break
    i=$((i+1))
  done
  printf '%s' "$code"
}

if [ "$LIVE" != "1" ]; then
  skip "LIVE HTTP probes" "set SMOKE_LIVE=1 (or pass --live) to run them"
elif ! command -v curl >/dev/null 2>&1; then
  if [ "$REQUIRE_LIVE" = "1" ]; then bad "curl available for LIVE probes"; else skip "LIVE HTTP probes" "curl not installed"; fi
elif ! curl -sS -o /dev/null --max-time 10 "$BASE_URL" 2>/dev/null && [ "$REQUIRE_LIVE" != "1" ]; then
  skip "LIVE HTTP probes" "host unreachable: $BASE_URL (set SMOKE_REQUIRE_LIVE=1 to make this a failure)"
else
  # Check 1 — Cliq inbound route → 200.
  code="$(http_status POST "$EXPECTED_CLIQ_URL" '{"smoke":"test"}')"
  if [ "$code" = "200" ]; then ok "POST ${EXPECTED_CLIQ_URL} → 200"; else bad "POST ${EXPECTED_CLIQ_URL} → 200" "got HTTP ${code:-no-response}"; fi

  # Check 2 — OAuth landing page → 200.
  oauth_url="${EXPECTED_CALLBACK_URL}?code=x&state=%7B%22serviceId%22%3A%22smoke%22%2C%22pluginId%22%3A%22agent-channels%22%7D"
  code="$(http_status GET "$oauth_url")"
  if [ "$code" = "200" ]; then ok "GET ${EXPECTED_CALLBACK_URL}?code=x&state=... → 200"; else bad "GET ${EXPECTED_CALLBACK_URL}?code=x&state=... → 200" "got HTTP ${code:-no-response}"; fi
fi

# ─────────────────────────────────────────────────────────────────────────────
section "MANUAL checks (operator verification)"

# manual_check <description> <how-to-verify>
manual_check() {
  local desc="$1" how="$2"
  if [ "$MANUAL" = "1" ]; then
    printf '  ? %s\n    %s\n' "$desc" "$how"
    printf '    Confirmed? [y/N] '
    read -r ans </dev/tty || ans=""
    case "$ans" in
      y|Y|yes|YES) ok "$desc" ;;
      *) bad "$desc" "operator did not confirm" ;;
    esac
  else
    skip "$desc" "$how (set SMOKE_MANUAL=1 to confirm interactively)"
  fi
}

# Check 3 — Zoho console redirect URI unchanged.
manual_check "Zoho console redirect URI is ${EXPECTED_CALLBACK_URL}" \
  "In the Zoho API console (api-console.zoho.com), open the Agent Channels client → Redirect URIs."

# Check 6 — Token storage after reconnect → tokenValid: true.
manual_check "Full Connect flow yields tokenValid: true (connection-status)" \
  "In plugin Settings, run Connect → consent. The badge must read 'Token valid' (connection-status.tokenValid === true)."

# ─────────────────────────────────────────────────────────────────────────────
section "Summary"
printf '  %s passed, %s failed, %s skipped\n' "$(green "$PASS")" "$(red "$FAIL")" "$(yellow "$SKIP")"
if [ "$FAIL" -gt 0 ]; then
  printf '\n%s reinstall re-verification FAILED\n' "$(red '✗')"
  exit 1
fi
printf '\n%s reinstall re-verification passed\n' "$(green '✓')"
exit 0
