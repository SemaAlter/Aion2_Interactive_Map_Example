#!/usr/bin/env bash
set -Eeuo pipefail

repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
tool_root="$repo_root/tools/aion2-map-viewer"
server_path="$tool_root/server.mjs"
log_root="$repo_root/development_logs"
port=4179
open_browser=true
while (($#)); do
    case "$1" in
        --no-browser) open_browser=false; shift ;;
        --port)
            [[ $# -ge 2 && "$2" =~ ^[0-9]{1,5}$ ]] || { echo 'Use --port with a number from 1 to 65535.' >&2; exit 1; }
            port=$((10#$2)); shift 2 ;;
        --help) echo 'Usage: bash Build-Deploy-Website.sh [--no-browser] [--port 4179]'; exit 0 ;;
        *) echo "Unknown option: $1" >&2; exit 1 ;;
    esac
done
((port >= 1 && port <= 65535)) || { echo 'Port must be between 1 and 65535.' >&2; exit 1; }
command -v node >/dev/null || { echo 'Install Node.js 22 or newer first.' >&2; exit 1; }
node -e 'if (Number(process.versions.node.split(".")[0]) < 22) process.exit(1)' || { echo 'Node.js 22 or newer is required.' >&2; exit 1; }
[[ "$(uname -s)" == Linux ]] || { echo 'Use Build-Deploy-Website.bat on Windows.' >&2; exit 1; }

cd -- "$tool_root"
mkdir -p -- "$log_root"
pid_file="$log_root/map-viewer-$port.pid"
old_pid=0
old_start=''
started_pid=0
started_start=''
old_stopped=false
packaged=false

# PID plus kernel start time prevents killing a different process after PID reuse.
process_start() {
    local stat fields
    [[ -r "/proc/$1/stat" ]] || return 1
    stat=$(<"/proc/$1/stat")
    read -r -a fields <<< "${stat##*) }"
    printf '%s' "${fields[19]}"
}
is_map_process() {
    local args=() current_start
    [[ "$1" =~ ^[1-9][0-9]*$ && -r "/proc/$1/cmdline" ]] || return 1
    current_start=$(process_start "$1") || return 1
    [[ "$current_start" == "$2" ]] || return 1
    mapfile -d '' -t args < "/proc/$1/cmdline"
    [[ ${#args[@]} -eq 2 && "${args[1]}" == "$server_path" ]]
}
if [[ -f "$pid_file" ]]; then
    read -r candidate_pid candidate_start < "$pid_file" || true
    if is_map_process "${candidate_pid:-}" "${candidate_start:-}"; then
        old_pid=$candidate_pid
        old_start=$candidate_start
    fi
fi
if ((old_pid == 0)); then
    # Refuse an unknown listener; do not use pkill, killall or require lsof.
    node --input-type=module - "$port" <<'JS'
import net from 'node:net';
const server = net.createServer();
server.on('error', error => { console.error(`Port ${process.argv[2]} is unavailable: ${error.message}. Stop its owner or use --port.`); process.exitCode = 1; });
server.listen(Number(process.argv[2]), '127.0.0.1', () => server.close());
JS
fi

start_server() {
    local stamp
    stamp=$(date -u +%Y%m%d-%H%M%S)-$$
    output_log="$log_root/map-viewer-$stamp.stdout.log"
    error_log="$log_root/map-viewer-$stamp.stderr.log"
    nohup env HOST=127.0.0.1 PORT="$port" node "$server_path" >"$output_log" 2>"$error_log" </dev/null &
    started_pid=$!
    started_start=$(process_start "$started_pid") || true
}
on_failure() {
    local result=${1:-1}
    trap - ERR INT TERM
    if ((started_pid > 0)) && is_map_process "$started_pid" "$started_start"; then kill -TERM "$started_pid" 2>/dev/null || true; fi
    if $old_stopped && ! $packaged && [[ -f dist/index.html ]]; then
        start_server
        printf '%s %s\n' "$started_pid" "$(process_start "$started_pid")" > "$pid_file"
        echo 'Restarted the retained release.' >&2
    fi
    echo 'Website deployment failed. Check the output above and development_logs.' >&2
    exit "${result:-1}"
}
trap 'on_failure $?' ERR
trap 'on_failure 130' INT
trap 'on_failure 143' TERM
echo 'Testing website...'
node --test tests/*.test.mjs
if ((old_pid > 0)); then
    is_map_process "$old_pid" "$old_start" || { echo 'Server identity changed; nothing was stopped.' >&2; exit 1; }
    kill -TERM "$old_pid"
    for ((attempt=0; attempt<100; attempt++)); do
        is_map_process "$old_pid" "$old_start" || break
        sleep .1
    done
    if is_map_process "$old_pid" "$old_start"; then echo 'Server did not stop. Refusing to rebuild while it is running.' >&2; exit 1; fi
    old_stopped=true
fi
echo 'Building and deploying dist...'
node build-site.mjs
packaged=true
start_server
node --input-type=module - "$port" "$started_pid" <<'JS'
const [port, pid] = process.argv.slice(2).map(Number);
const deadline = Date.now() + 30_000;
while (true) {
    process.kill(pid, 0);
    try {
        const response = await fetch(`http://127.0.0.1:${port}/healthz`, { signal: AbortSignal.timeout(2000) });
        if (response.ok && await response.text() === 'ok') break;
    } catch {}
    if (Date.now() >= deadline) throw new Error('Map server did not become ready; check development_logs.');
    await new Promise(resolve => setTimeout(resolve, 250));
}
JS
printf '%s %s\n' "$started_pid" "$(process_start "$started_pid")" > "$pid_file"
trap - ERR INT TERM
url="http://127.0.0.1:$port/"
echo "Website deployed: $url"
echo "Server PID: $started_pid. Logs: $output_log"
if $open_browser && [[ -n "${DISPLAY:-}${WAYLAND_DISPLAY:-}" ]] && command -v xdg-open >/dev/null; then
    xdg-open "$url" >/dev/null 2>&1 &
fi
