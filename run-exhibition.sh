#!/usr/bin/env bash
# Desimer 전시 서버와 화면을 띄운다. 미리 만들어 둔 한 주(fixtures/week)와 그림·음성만 읽는다.
# 모델을 부르지 않고 키를 읽지 않는다.
#
#   ./run-exhibition.sh            띄우고 브라우저를 연다
#   ./run-exhibition.sh --no-open  브라우저는 열지 않는다
#   ./run-exhibition.sh --stop     띄워 둔 것을 내린다
#
# 서버 http://127.0.0.1:8020 · 화면 http://localhost:5180 (MEDIAL_SIM_PORT · MEDIAL_WEB_PORT 로 바꾼다).
# 모니터는 /?role=wall, 태블릿은 모니터의 QR 코드로 연다. Ctrl+C 는 이 스크립트가 띄운 것만 정리한다.
set -u

cd "$(dirname "$0")"

API_PORT="${MEDIAL_SIM_PORT:-8020}"
WEB_PORT="${MEDIAL_WEB_PORT:-5180}"
LOG_DIR=".run/exhibition"
mkdir -p "$LOG_DIR"

stop_all() {
  for name in server web; do
    if [ -f "$LOG_DIR/$name.pid" ]; then
      pid="$(cat "$LOG_DIR/$name.pid")"
      kill "$pid" 2>/dev/null && echo "내림: $name ($pid)"
      rm -f "$LOG_DIR/$name.pid"
    fi
  done
}

if [ "${1:-}" = "--stop" ]; then
  stop_all
  exit 0
fi

up() { curl -s -o /dev/null --max-time 2 "$1"; }

if up "http://127.0.0.1:$API_PORT/api/sim/health"; then
  echo "서버는 이미 떠 있습니다 (:$API_PORT)"
else
  MEDIAL_SIM_PORT="$API_PORT" python server/sim_main.py > "$LOG_DIR/server.log" 2>&1 &
  echo $! > "$LOG_DIR/server.pid"
  echo "서버 시작 ... (로그: $LOG_DIR/server.log)"
  for _ in $(seq 1 40); do up "http://127.0.0.1:$API_PORT/api/sim/health" && break; sleep 0.5; done
  up "http://127.0.0.1:$API_PORT/api/sim/health" || { echo "서버가 뜨지 않았습니다. $LOG_DIR/server.log 를 보세요."; stop_all; exit 1; }
  echo "서버 준비됨 · http://127.0.0.1:$API_PORT"
fi

if up "http://localhost:$WEB_PORT/"; then
  echo "화면은 이미 떠 있습니다 (:$WEB_PORT)"
else
  MEDIAL_SIM_URL="http://127.0.0.1:$API_PORT" npx vite --port "$WEB_PORT" --strictPort > "$LOG_DIR/web.log" 2>&1 &
  echo $! > "$LOG_DIR/web.pid"
  echo "화면 시작 ... (로그: $LOG_DIR/web.log)"
  for _ in $(seq 1 40); do up "http://localhost:$WEB_PORT/" && break; sleep 0.5; done
  up "http://localhost:$WEB_PORT/" || { echo "화면이 뜨지 않았습니다. $LOG_DIR/web.log 를 보세요."; stop_all; exit 1; }
fi

echo "모니터: http://localhost:$WEB_PORT/?role=wall"
if [ "${1:-}" != "--no-open" ]; then
  (start "http://localhost:$WEB_PORT/?role=wall" 2>/dev/null || open "http://localhost:$WEB_PORT/?role=wall" 2>/dev/null || xdg-open "http://localhost:$WEB_PORT/?role=wall" 2>/dev/null) || true
fi

trap 'echo; stop_all; exit 0' INT TERM
echo "끝내려면 Ctrl+C"
wait
