#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$REPO_ROOT"

RUNS="${1:-5}"
OUTPUT_LOG="${BENCH_LOG:-$REPO_ROOT/bench_results.raw.txt}"

rm -f "$OUTPUT_LOG"

echo "=== Benchmark Suite Starting ($(date)) ===" | tee -a "$OUTPUT_LOG"
echo "Target iterations: $RUNS per target" | tee -a "$OUTPUT_LOG"
echo "WAYLAND_DISPLAY=${WAYLAND_DISPLAY:-unset} DISPLAY=${DISPLAY:-unset}" | tee -a "$OUTPUT_LOG"

run_target() {
    local target_name="$1"
    local command_prefix="$2"
    local target_arg="$3"

    echo "" | tee -a "$OUTPUT_LOG"
    echo "--- Target: $target_name ---" | tee -a "$OUTPUT_LOG"
    for i in $(seq 1 "$RUNS"); do
        echo -n "  Run $i/$RUNS: " | tee -a "$OUTPUT_LOG"
        # Run measure.sh
        output=$(eval "$command_prefix $SCRIPT_DIR/measure.sh $target_arg")
        echo "$output" | tee -a "$OUTPUT_LOG"
        echo "$target_name,$i,$output" >> "$OUTPUT_LOG.data"
        sleep 1
    done
}

rm -f "$OUTPUT_LOG.data"

# 1. Electron (minimal spike harness)
run_target "electron" "" "electron"

# 2. Electron App (real current app)
run_target "electron-app" "" "electron-app"

# 3. Tauri (Wayland)
run_target "tauri-wayland" "" "tauri"

# 4. Tauri (X11)
run_target "tauri-x11" "GDK_BACKEND=x11" "tauri"

echo "" | tee -a "$OUTPUT_LOG"
echo "=== Benchmark Suite Complete ===" | tee -a "$OUTPUT_LOG"

# Calculate medians via bun script
DATA_FILE="$OUTPUT_LOG.data" bun -e '
import fs from "fs"

const file = process.env.DATA_FILE
if (!file || !fs.existsSync(file)) {
  console.error("No data file found:", file)
  process.exit(1)
}

const lines = fs.readFileSync(file, "utf-8").trim().split("\n")
const data = {}

for (const line of lines) {
  if (!line) continue
  const [target, run, res] = line.split(",")
  if (!data[target]) data[target] = { startups: [], rsses: [] }
  const startupMatch = res.match(/startup_ms=([0-9.]+)/)
  const rssMatch = res.match(/idle_rss_mb=([0-9.]+)/)
  if (startupMatch) data[target].startups.push(parseFloat(startupMatch[1]))
  if (rssMatch) data[target].rsses.push(parseFloat(rssMatch[1]))
}

function median(arr) {
  if (arr.length === 0) return "N/A"
  const s = [...arr].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 !== 0 ? s[mid] : ((s[mid - 1] + s[mid]) / 2).toFixed(1)
}

console.log("\n### Summary Medians")
console.log("| Target | Startup (ms median) | Idle RSS (MB median) |")
console.log("| :--- | :--- | :--- |")
for (const [target, vals] of Object.entries(data)) {
  console.log(`| ${target} | ${median(vals.startups)} | ${median(vals.rsses)} |`)
}
' | tee -a "$OUTPUT_LOG"
