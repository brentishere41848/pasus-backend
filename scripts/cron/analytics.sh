#!/usr/bin/env bash
set -euo pipefail

# Example cron runner for analytics. Run at 02:00 UTC daily:
# 0 2 * * * /path/to/analytics.sh >> /var/log/pasus-analytics.log 2>&1

cd "$(dirname "$0")/../.."

export ANALYTICS_ENABLED=${ANALYTICS_ENABLED:-true}

YEAR=${1:-$(date -u +%Y)}

echo "[$(date -u)] running daily aggregates..."
npm run --prefix backend analytics:daily

echo "[$(date -u)] running yearly aggregates for $YEAR..."
npm run --prefix backend analytics:yearly -- "$YEAR"

echo "[$(date -u)] building wrapped snapshots for $YEAR..."
npm run --prefix backend analytics:wrapped -- "$YEAR"

echo "[$(date -u)] done."

