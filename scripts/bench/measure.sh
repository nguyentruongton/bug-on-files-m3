#!/usr/bin/env bash
set -euo pipefail

# Scripts directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

PORT="${BENCH_PORT:-8787}"
IDLE_SECS="${BENCH_IDLE_SECS:-10}"

get_all_descendants() {
    local root=$1
    local all_pids=("$root")
    local queue=("$root")

    while [ ${#queue[@]} -gt 0 ]; do
        local current="${queue[0]}"
        queue=("${queue[@]:1}")

        local children
        children=$(pgrep -P "$current" 2>/dev/null || true)
        for child in $children; do
            if [ -n "$child" ] && [ -d "/proc/$child" ]; then
                local seen=0
                for seen_pid in "${all_pids[@]}"; do
                    if [ "$seen_pid" -eq "$child" ]; then
                        seen=1
                        break
                    fi
                done
                if [ "$seen" -eq 0 ]; then
                    all_pids+=("$child")
                    queue+=("$child")
                fi
            fi
        done
    done

    printf "%s\n" "${all_pids[@]}"
}

sum_rss_kb() {
    local pids="$1"
    local total_kb=0
    for p in $pids; do
        if [ -f "/proc/$p/status" ]; then
            local rss
            rss=$(awk '/VmRSS:/ {print $2}' "/proc/$p/status" 2>/dev/null || true)
            if [ -n "$rss" ]; then
                total_kb=$((total_kb + rss))
            fi
        fi
    done
    echo "$total_kb"
}

kill_process_tree() {
    local root=$1
    if [ -z "$root" ] || ! kill -0 "$root" 2>/dev/null; then
        return 0
    fi

    local pids
    pids=$(get_all_descendants "$root" 2>/dev/null || echo "$root")

    # Send SIGTERM first
    for p in $pids; do
        kill -TERM "$p" 2>/dev/null || true
    done
    sleep 0.2

    # Send SIGKILL to any remaining
    for p in $pids; do
        if kill -0 "$p" 2>/dev/null; then
            kill -KILL "$p" 2>/dev/null || true
        fi
    done
    wait "$root" 2>/dev/null || true
}

# Unit test mode
if [ "${1:-}" = "--test" ]; then
    echo "Running self-tests for measure.sh..."
    # Test 1: Self RSS measurement
    self_rss=$(sum_rss_kb "$$")
    if [ "$self_rss" -le 0 ]; then
        echo "FAIL: sum_rss_kb returned non-positive for self ($self_rss)"
        exit 1
    fi

    # Test 2: Descendants tree discovery
    ( bash -c "bash -c 'sleep 2' & wait" ) &
    TEST_ROOT=$!
    sleep 0.1
    tree_pids=$(get_all_descendants "$TEST_ROOT")
    tree_count=$(echo "$tree_pids" | wc -l)
    kill_process_tree "$TEST_ROOT"
    if [ "$tree_count" -lt 2 ]; then
        echo "FAIL: get_all_descendants did not find all children (count=$tree_count)"
        exit 1
    fi

    echo "PASS: measure.sh self-tests ok"
    exit 0
fi

# Allow sourcing helper functions
if [ "${BASH_SOURCE[0]}" != "$0" ]; then
    return 0 2>/dev/null || true
fi

TARGET="${1:-}"
if [ -z "$TARGET" ]; then
    echo "Usage: $0 <tauri|electron|electron-app>" >&2
    exit 1
fi

cd "$REPO_ROOT"

# Ensure dist exists
if [ ! -f "dist/spike.html" ]; then
    bun run build:web
fi

# Ensure tauri release binary exists before timing starts
TAURI_BIN="$REPO_ROOT/src-tauri/target/release/materials"
if [ "$TARGET" = "tauri" ] && [ ! -f "$TAURI_BIN" ]; then
    PATH="$HOME/.cargo/bin:$PATH" bun run tauri:build -- --no-bundle
fi

# Clean up any leftover processes on the benchmark port
fuser -k "${PORT}/tcp" 2>/dev/null || true

STARTUP_MS="N/A"
TARGET_PID=""
PING_PID=""
RESULT_FILE=$(mktemp /tmp/bench_result.XXXXXX)
T0_FILE=$(mktemp /tmp/bench_t0.XXXXXX)
PING_LOG=$(mktemp /tmp/bench_ping_log.XXXXXX)

cleanup() {
    if [ -n "$TARGET_PID" ]; then
        kill_process_tree "$TARGET_PID"
    fi
    if [ -n "$PING_PID" ]; then
        kill -KILL "$PING_PID" 2>/dev/null || true
        wait "$PING_PID" 2>/dev/null || true
    fi
    rm -f "$RESULT_FILE" "$T0_FILE" "$PING_LOG"
}
trap cleanup EXIT INT TERM

if [ "$TARGET" = "electron-app" ]; then
    # Make sure app is built
    if [ ! -f "dist-electron/main.js" ]; then
        bun run build
        node scripts/set-cjs.cjs
    fi

    NODE_ENV=production ./node_modules/.bin/electron . > /dev/null 2>&1 &
    TARGET_PID=$!

    # Wait for app to settle
    sleep "$IDLE_SECS"

    PIDS=$(get_all_descendants "$TARGET_PID")
    TOTAL_KB=$(sum_rss_kb "$PIDS")
    IDLE_RSS_MB=$(awk -v kb="$TOTAL_KB" 'BEGIN { printf "%.1f", kb / 1024 }')

    echo "startup_ms=N/A idle_rss_mb=${IDLE_RSS_MB}"
    exit 0
fi

# Start ping server
BENCH_PORT="$PORT" BENCH_RESULT_FILE="$RESULT_FILE" BENCH_T0_FILE="$T0_FILE" \
    bun "$SCRIPT_DIR/ping-server.ts" --port "$PORT" > "$PING_LOG" 2>&1 &
PING_PID=$!

# Wait for ping server to listen
for _ in $(seq 1 50); do
    if grep -q "READY_LISTENING" "$PING_LOG" 2>/dev/null; then
        break
    fi
    sleep 0.05
done

# Timestamp immediately before spawn
T0=$(date +%s%3N)
echo "$T0" > "$T0_FILE"

case "$TARGET" in
    tauri)
        MATERIALS_SPIKE_URL="spike.html?ping=http://127.0.0.1:${PORT}/ready" \
            "$TAURI_BIN" > /dev/null 2>&1 &
        TARGET_PID=$!
        ;;

    electron)
        MATERIALS_SPIKE_URL="http://127.0.0.1:${PORT}/ready" \
            ./node_modules/.bin/electron "$SCRIPT_DIR/electron-harness.cjs" > /dev/null 2>&1 &
        TARGET_PID=$!
        ;;

    *)
        echo "Unknown target: $TARGET. Expected tauri, electron, or electron-app" >&2
        exit 1
        ;;
esac

# Wait for ping to be received
wait "$PING_PID" || true
PING_PID=""

if [ -f "$RESULT_FILE" ] && grep -q "startup_ms=" "$RESULT_FILE"; then
    STARTUP_MS=$(grep "startup_ms=" "$RESULT_FILE" | head -n 1 | cut -d= -f2)
else
    echo "Warning: no startup ping received" >&2
fi

# Wait 10 seconds after ping to measure idle RSS
sleep "$IDLE_SECS"

# Measure RSS across root and all descendant processes
PIDS=$(get_all_descendants "$TARGET_PID")
TOTAL_KB=$(sum_rss_kb "$PIDS")
IDLE_RSS_MB=$(awk -v kb="$TOTAL_KB" 'BEGIN { printf "%.1f", kb / 1024 }')

echo "startup_ms=${STARTUP_MS} idle_rss_mb=${IDLE_RSS_MB}"
