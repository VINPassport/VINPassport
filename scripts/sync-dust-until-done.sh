#!/usr/bin/env bash
# Run scripts/sync-dust.mjs until the dust wallet is caught up.
#
# A full dust sync is over 1.6 million events on preprod, and the SDK's
# subscription client is built with `shouldRetry: () => false`: any transport
# error ends it, and the apply loop can also stop dead after the backpressure
# pause without raising anything at all. Both are resumable, because the
# wallet snapshot carries the cursor and the indexer serves a resume cursor
# correctly, so the supervision is this simple: restart it, and it carries on.
#
#   VINPASSPORT_SEED_FILE=/path/to/seed.env scripts/sync-dust-until-done.sh
#
# Stops on success, on a signal, or after MAX_RESTARTS consecutive attempts
# that make no progress - which would mean the problem is not one restarting
# can solve.
#
# SPDX-License-Identifier: Apache-2.0
set -u

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
state_dir="${DUST_SYNC_STATE_DIR:-$here/../../_local-tracking/dust-state}"
blob="$state_dir/dust.blob"
max_restarts="${MAX_RESTARTS:-8}"

# Node on Windows cannot open the `/c/...` paths Git Bash hands out, so convert
# when cygpath is there. Without this the offset always reads 0, every restart
# looks like it made no progress, and the loop gives up while it is working.
node_path() {
    if command -v cygpath >/dev/null 2>&1; then cygpath -m "$1"; else printf '%s' "$1"; fi
}

offset_now() {
    [ -f "$blob" ] || { echo 0; return; }
    BLOB_PATH="$(node_path "$blob")" node -e \
        "try{process.stdout.write(String(JSON.parse(require('fs').readFileSync(process.env.BLOB_PATH,'utf8')).offset??0))}catch{process.stdout.write('0')}"
}

attempt=0
stuck=0
while :; do
    attempt=$((attempt + 1))
    before="$(offset_now)"
    echo "=== attempt $attempt, resuming from offset $before ==="

    node --max-old-space-size=8192 "$here/sync-dust.mjs"
    code=$?

    after="$(offset_now)"
    echo "=== attempt $attempt exited $code, offset $before -> $after ==="

    case "$code" in
        0) echo "synced."; exit 0 ;;
        2 | 3 | 4) ;;                      # resumable: fall through and restart
        *) echo "unexpected exit $code; not restarting."; exit "$code" ;;
    esac

    # Only give up when restarting has stopped buying anything.
    if [ "$after" = "$before" ]; then
        stuck=$((stuck + 1))
        if [ "$stuck" -ge "$max_restarts" ]; then
            echo "$stuck attempts in a row made no progress; stopping."
            exit 1
        fi
    else
        stuck=0
    fi
    sleep 2
done
