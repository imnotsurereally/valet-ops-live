#!/usr/bin/env bash

# Audit helper to collect quick diagnostics into audit_report.txt.

set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPORT="$ROOT/audit_report.txt"

section() {
  echo -e "\n=== $1 ===" >>"$REPORT"
}

# start fresh
{
  echo "Valet Ops audit report generated on $(date)"
  echo "Root: $ROOT"
} >"$REPORT"

section "Git status"
(cd "$ROOT" && git status --short --branch >>"$REPORT" 2>&1 || true)

section "Modified or untracked files"
(cd "$ROOT" && git status --porcelain >>"$REPORT" 2>&1 || true)

section "Grep for crash patterns in JS"
PATTERN='ReferenceError|is not defined|Unhandled|Uncaught \(in promise\)'
if command -v rg >/dev/null 2>&1; then
  (cd "$ROOT" && rg -n --glob '*.js' --glob '*.ts' "$PATTERN" >>"$REPORT" 2>&1 || true)
elif command -v grep >/dev/null 2>&1; then
  (cd "$ROOT" && grep -R -nE "$PATTERN" --include='*.js' --include='*.ts' . >>"$REPORT" 2>&1 || true)
else
  echo "Neither rg nor grep found on PATH" >>"$REPORT"
fi

section "Node syntax check (*.js)"
if command -v node >/dev/null 2>&1; then
  (cd "$ROOT" && while IFS= read -r file; do
    echo "node --check $file" >>"$REPORT"
    node --check "$file" >>"$REPORT" 2>&1 || true
  done < <(find "$ROOT" -type f \( -name '*.js' -o -name '*.mjs' \))) || true
else
  echo "node not installed; skipping syntax checks" >>"$REPORT"
fi

section "Supabase migrations"
if [ -d "$ROOT/supabase/migrations" ]; then
  (cd "$ROOT/supabase/migrations" && ls -1 >>"$REPORT" 2>&1 || true)
else
  echo "supabase/migrations not found" >>"$REPORT"
fi

section "Local Supabase status (make sb-status)"
if command -v make >/dev/null 2>&1; then
  (cd "$ROOT" && make sb-status >>"$REPORT" 2>&1 || true)
else
  echo "make not available" >>"$REPORT"
fi

echo -e "\nAudit complete. Report saved to $REPORT" >>"$REPORT"
