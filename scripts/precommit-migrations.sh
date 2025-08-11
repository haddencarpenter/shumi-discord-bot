#!/usr/bin/env bash
set -euo pipefail

# Pre-commit hook: Check migrations for forbidden SQL
FILES=$(git diff --cached --name-only | grep -E '^migrations/.*\.sql' || true)
[ -z "$FILES" ] && exit 0

BAD=$(grep -inE '(^|[^A-Z])(DROP|TRUNCATE)\b' $FILES || true)
if [ -n "$BAD" ]; then
  echo "❌ Forbidden SQL (DROP/TRUNCATE) found in migrations:"
  echo "$BAD"
  echo ""
  echo "Production migrations must NEVER drop or truncate tables."
  echo "Use CREATE TABLE IF NOT EXISTS and ALTER TABLE instead."
  exit 1
fi

echo "✅ Migrations look safe."