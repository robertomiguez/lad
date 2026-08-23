#!/usr/bin/env bash
# Delete one report and its D1/KV idempotency data.
#
# Usage:
#   ./scripts/delete-report.sh --local UUID
#   ./scripts/delete-report.sh --remote UUID

set -euo pipefail

readonly D1_DATABASE="damage-reporting-prod"
readonly KV_BINDING="IDEMPOTENCY"

usage() {
  echo "Usage: $0 --local|--remote UUID" >&2
  exit 2
}

[[ $# == 2 ]] || usage

case "$1" in
  --local|--remote) scope="$1" ;;
  *) usage ;;
esac

uuid="$2"
if [[ ! "$uuid" =~ ^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$ ]]; then
  echo "UUID must be in canonical UUID format." >&2
  exit 2
fi

echo "Report UUID: $uuid"
echo "Target:      $scope"

if [[ "$scope" == "--remote" ]]; then
  read -r -p "This permanently deletes remote data. Type the UUID to continue: " confirmation
  [[ "$confirmation" == "$uuid" ]] || { echo "Cancelled."; exit 1; }
fi

echo "Current D1 rows:"
npx wrangler d1 execute "$D1_DATABASE" "$scope" --command "
  SELECT 'reports' AS source, id FROM reports WHERE id = '$uuid'
  UNION ALL
  SELECT 'line_items', id FROM line_items WHERE report_id = '$uuid'
  UNION ALL
  SELECT 'photos', p.id FROM photos p JOIN line_items li ON li.id = p.line_item_id WHERE li.report_id = '$uuid'
  UNION ALL
  SELECT 'credit_notes', id FROM credit_notes WHERE report_id = '$uuid'
  UNION ALL
  SELECT 'idempotency_keys', key FROM idempotency_keys WHERE key = '$uuid';
"

npx wrangler d1 execute "$D1_DATABASE" "$scope" --command "
  DELETE FROM credit_notes WHERE report_id = '$uuid';
  DELETE FROM idempotency_keys WHERE key = '$uuid';
  DELETE FROM reports WHERE id = '$uuid';
"

for attempt in 1 2 3; do
  if npx wrangler kv key delete "report:$uuid" --binding="$KV_BINDING" "$scope"; then
    break
  fi
  if [[ "$attempt" == 3 ]]; then
    echo "D1 cleanup completed, but KV deletion failed after 3 attempts." >&2
    exit 1
  fi
  echo "KV service unavailable; retrying in $attempt second(s)..." >&2
  sleep "$attempt"
done

echo "D1 and KV cleanup completed."
echo "R2 photos and Durable Object storage are not cleared by this terminal script."
echo "To remove this report from the browser's IndexedDB, run scripts/remove-report-from-indexeddb.js in DevTools Console."
