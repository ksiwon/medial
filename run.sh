#!/usr/bin/env bash
#
# 한 번에 띄우기: 시뮬레이터 서버(8010) + 프런트 개발 서버(5173) + 브라우저.
#
#   ./run.sh              띄우고 브라우저를 연다
#   ./run.sh --no-open    브라우저는 열지 않는다
#   ./run.sh --stop       띄워 둔 것을 내린다
#
# Ctrl+C 를 누르면 이 스크립트가 띄운 것만 정리한다. 이미 다른 창에서 돌고
# 있던 서버는 건드리지 않고 그대로 쓴다 - 이 스크립트를 두 번 실행해도 세션이
# 두 벌 생기거나 포트가 충돌하지 않는다.
set -u

cd "$(dirname "$0")"

API_PORT="${MEDIAL_SIM_PORT:-8010}"
WEB_PORT="${MEDIAL_WEB_PORT:-5173}"
LOG_DIR=".run"
API_LOG="$LOG_DIR/server.log"
WEB_LOG="$LOG_DIR/web.log"

open_browser=1
for arg in "$@"; do
  case "$arg" in
    --no-open) open_browser=0 ;;
    --stop) mode=stop ;;
    -h|--help) sed -n '3,10p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "모르는 옵션: $arg (사용법은 --help)"; exit 2 ;;
  esac
done

# --- 포트가 이미 쓰이고 있는가 -----------------------------------------------
# netstat 로 확인한다. Windows/Git Bash 에도 lsof 가 없는 경우가 많다.
listening() {
  netstat -ano 2>/dev/null | grep -E "[:.]$1[[:space:]]" | grep -qi listening
}
pid_on() {
  netstat -ano 2>/dev/null | grep -E "[:.]$1[[:space:]]" | grep -i listening |
    awk '{print $NF}' | grep -E '^[0-9]+$' | sort -u | head -1
}

if [ "${mode:-run}" = stop ]; then
  for port in "$API_PORT" "$WEB_PORT"; do
    pid="$(pid_on "$port")"
    if [ -n "$pid" ]; then
      echo "포트 $port (PID $pid) 정리"
      taskkill //F //PID "$pid" >/dev/null 2>&1 || kill -9 "$pid" 2>/dev/null
    else
      echo "포트 $port 는 비어 있음"
    fi
  done
  exit 0
fi

mkdir -p "$LOG_DIR"

# --- 준비물 -------------------------------------------------------------------
if [ ! -d node_modules ]; then
  echo "node_modules 가 없습니다. npm install 을 먼저 돌립니다."
  npm install || exit 1
fi

if ! python -c "import fastapi, uvicorn" >/dev/null 2>&1; then
  echo "시뮬레이터 서버 의존성이 없습니다:"
  echo "  python -m pip install -r server/requirements-sim.txt"
  exit 1
fi

# --- 정리 ---------------------------------------------------------------------
# 이 스크립트가 띄운 것만 죽인다. 붙여 쓴 남의 서버는 남긴다.
started_api=0
started_web=0
api_pid=""
web_pid=""

cleanup() {
  echo
  [ "$started_api" = 1 ] && [ -n "$api_pid" ] && {
    echo "서버 정리 (PID $api_pid)"
    taskkill //F //T //PID "$api_pid" >/dev/null 2>&1 || kill -9 "$api_pid" 2>/dev/null
  }
  [ "$started_web" = 1 ] && [ -n "$web_pid" ] && {
    echo "개발 서버 정리 (PID $web_pid)"
    taskkill //F //T //PID "$web_pid" >/dev/null 2>&1 || kill -9 "$web_pid" 2>/dev/null
  }
  exit 0
}
trap cleanup INT TERM

# --- 서버 환경변수 --------------------------------------------------------------
# 시뮬레이터는 키를 *프로세스 환경*에서만 읽는다. server/.env 는 git-ignored 이고
# 서버 쪽에서만 쓰인다. 없어도 된다 - 규칙 어댑터는 모델을 부르지 않는다.
if [ -f server/.env ]; then
  set -a
  # shellcheck disable=SC1091
  . ./server/.env
  set +a
  if [ -n "${ANTHROPIC_API_KEY:-}" ] || [ -n "${OPENAI_API_KEY:-}" ]; then
    echo "server/.env 읽음 · 온라인 어댑터를 고를 수 있는 키가 있습니다 (rule 어댑터는 모델을 부르지 않습니다)"
  else
    echo "server/.env 읽음 · 온라인 어댑터용 키는 없습니다 (규칙 어댑터로 전체 흐름이 돕니다)"
  fi
fi

# --- 시뮬레이터 서버 -----------------------------------------------------------
if listening "$API_PORT"; then
  echo "서버: 이미 $API_PORT 에서 돌고 있습니다. 그대로 씁니다."
else
  echo "서버 시작 ... (로그: $API_LOG)"
  MEDIAL_SIM_PORT="$API_PORT" python server/sim_main.py >"$API_LOG" 2>&1 &
  api_pid=$!
  started_api=1
fi

# 준비될 때까지 기다린다. 그냥 sleep 하면 느린 첫 기동에서 브라우저가 먼저 뜬다.
for _ in $(seq 1 60); do
  if curl -fs "http://127.0.0.1:$API_PORT/api/sim/health" >/dev/null 2>&1; then break; fi
  if [ "$started_api" = 1 ] && ! kill -0 "$api_pid" 2>/dev/null; then
    echo "서버가 시작하자마자 죽었습니다. $API_LOG 를 보세요:"
    tail -20 "$API_LOG"
    exit 1
  fi
  sleep 0.5
done

if ! curl -fs "http://127.0.0.1:$API_PORT/api/sim/health" >/dev/null 2>&1; then
  echo "서버가 30초 안에 응답하지 않습니다. $API_LOG 를 보세요."
  cleanup
fi

# 원자료를 읽었는지 합성 마을로 도는지 여기서 알려 준다. 화면 배지와 같은 값이다.
source_kind="$(curl -fs "http://127.0.0.1:$API_PORT/api/sim/village" 2>/dev/null |
  python -c 'import json,sys; v=json.load(sys.stdin); print(v.get("dataSource","?"))' 2>/dev/null)"
echo "서버 준비됨 · http://127.0.0.1:$API_PORT · 데이터: ${source_kind:-확인 못 함}"

# --- 프런트 --------------------------------------------------------------------
if listening "$WEB_PORT"; then
  echo "개발 서버: 이미 $WEB_PORT 에서 돌고 있습니다. 그대로 씁니다."
else
  echo "개발 서버 시작 ... (로그: $WEB_LOG)"
  npm run dev -- --port "$WEB_PORT" >"$WEB_LOG" 2>&1 &
  web_pid=$!
  started_web=1
fi

for _ in $(seq 1 60); do
  if curl -fs "http://localhost:$WEB_PORT/" >/dev/null 2>&1; then break; fi
  if [ "$started_web" = 1 ] && ! kill -0 "$web_pid" 2>/dev/null; then
    echo "개발 서버가 시작하자마자 죽었습니다. $WEB_LOG 를 보세요:"
    tail -20 "$WEB_LOG"
    cleanup
  fi
  sleep 0.5
done

url="http://localhost:$WEB_PORT/"
echo "화면 준비됨 · $url"

if [ "$open_browser" = 1 ]; then
  # Git Bash 는 start, 그 밖에는 xdg-open/open.
  (start "" "$url" 2>/dev/null || xdg-open "$url" 2>/dev/null || open "$url" 2>/dev/null) &
fi

# 둘 다 이미 떠 있었으면 감시할 것이 없다. 남의 서버에 Ctrl+C 를 걸어 둘 이유가
# 없으므로 주소만 알려 주고 끝낸다.
if [ "$started_api" = 0 ] && [ "$started_web" = 0 ]; then
  echo
  echo "둘 다 이미 떠 있었습니다. 이 창은 닫아도 됩니다."
  echo "내리려면: ./run.sh --stop"
  exit 0
fi

echo
echo "로그를 함께 흘립니다. Ctrl+C 로 이 스크립트가 띄운 것을 내립니다."
echo "----------------------------------------------------------------"

# 띄운 쪽의 로그만 따라간다. 없는 파일을 주면 tail 이 그대로 죽는다.
logs=""
[ "$started_api" = 1 ] && logs="$logs $API_LOG"
[ "$started_web" = 1 ] && logs="$logs $WEB_LOG"
# shellcheck disable=SC2086
tail -n 5 -f $logs &
tail_pid=$!

# 띄운 쪽이 끝나면 같이 끝난다.
if [ "$started_api" = 1 ]; then wait "$api_pid"
else wait "$web_pid"
fi
kill "$tail_pid" 2>/dev/null
cleanup
