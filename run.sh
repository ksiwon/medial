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

case "$API_PORT:$WEB_PORT" in
  *[!0-9:]*) echo "포트는 숫자여야 합니다: API=$API_PORT WEB=$WEB_PORT"; exit 2 ;;
esac

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
  if command -v netstat >/dev/null 2>&1 && netstat -ano >/dev/null 2>&1; then
    netstat -ano 2>/dev/null | grep -E "[:.]$1[[:space:]]" | grep -qi listening
  else
    powershell.exe -NoProfile -Command \
      "if (Get-NetTCPConnection -State Listen -LocalPort $1 -ErrorAction SilentlyContinue) { exit 0 } else { exit 1 }" \
      >/dev/null 2>&1
  fi
}
pid_on() {
  if command -v netstat >/dev/null 2>&1 && netstat -ano >/dev/null 2>&1; then
    netstat -ano 2>/dev/null | grep -E "[:.]$1[[:space:]]" | grep -i listening |
      awk '{print $NF}' | grep -E '^[0-9]+$' | sort -u | head -1
  else
    powershell.exe -NoProfile -Command \
      "Get-NetTCPConnection -State Listen -LocalPort $1 -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty OwningProcess" \
      2>/dev/null | tr -d '\r'
  fi
}
stop_pid() {
  if command -v taskkill >/dev/null 2>&1; then
    taskkill //F //T //PID "$1" >/dev/null 2>&1 || kill -9 "$1" 2>/dev/null
  else
    powershell.exe -NoProfile -Command "taskkill /F /T /PID $1 | Out-Null" >/dev/null 2>&1
  fi
}
http_ok() {
  if command -v curl >/dev/null 2>&1; then
    curl -fs "$1" >/dev/null 2>&1
  elif command -v powershell.exe >/dev/null 2>&1; then
    powershell.exe -NoProfile -Command \
      "try { Invoke-WebRequest -UseBasicParsing -Uri '$1' | Out-Null; exit 0 } catch { exit 1 }" \
      >/dev/null 2>&1
  else
    return 1
  fi
}
# 000 = 아직 안 떴다(연결 자체가 안 됨). 그 밖에는 뜬 채로 그 코드를 돌려준 것이다.
# 둘을 구분해야 "기다린다"와 "터졌으니 로그를 보여 준다"를 나눌 수 있다.
http_status() {
  if command -v curl >/dev/null 2>&1; then
    curl -s -o /dev/null -m 5 -w '%{http_code}' "$1" 2>/dev/null || echo 000
  elif command -v powershell.exe >/dev/null 2>&1; then
    powershell.exe -NoProfile -Command \
      "try { (Invoke-WebRequest -UseBasicParsing -TimeoutSec 5 -Uri '$1').StatusCode }
       catch { if (\$_.Exception.Response) { [int]\$_.Exception.Response.StatusCode } else { 0 } }" \
      2>/dev/null | tr -d '\r' | tr -d ' ' | head -1
  else
    echo 000
  fi
}

# 로그 끝을 보여 주고 끝낸다. 원인이 이미 파일에 적혀 있는데 "로그를 보세요"로
# 끝내면 사용자가 한 단계 더 움직여야 한다.
die_with_log() {
  echo "$1"
  echo "----- $2 (마지막 25줄) -----"
  tail -25 "$2" 2>/dev/null || echo "(로그가 없습니다)"
  echo "---------------------------------"
}

http_body() {
  if command -v curl >/dev/null 2>&1; then
    curl -fs "$1" 2>/dev/null
  else
    powershell.exe -NoProfile -Command \
      "(Invoke-WebRequest -UseBasicParsing -Uri '$1').Content" 2>/dev/null | tr -d '\r'
  fi
}

if [ "${mode:-run}" = stop ]; then
  for port in "$API_PORT" "$WEB_PORT"; do
    pid="$(pid_on "$port")"
    if [ -n "$pid" ]; then
      echo "포트 $port (PID $pid) 정리"
      stop_pid "$pid"
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

PYTHON_BIN="${MEDIAL_PYTHON:-python}"
PYTHON_MODE="direct"

if ! "$PYTHON_BIN" -c "import fastapi, uvicorn" >/dev/null 2>&1; then
  # Windows의 bash.exe(WSL 호환 환경)는 Linux Python을 먼저 찾는다. 반면
  # 프로젝트 의존성이 Windows Python에 설치된 경우가 흔하므로 PowerShell을
  # 명시적인 브리지로 사용한다. 사용자가 MEDIAL_PYTHON을 지정했다면 그 값을
  # 존중하며 다른 환경으로 자동 전환하지 않는다.
  if [ -z "${MEDIAL_PYTHON:-}" ] \
    && command -v powershell.exe >/dev/null 2>&1 \
    && powershell.exe -NoProfile -Command "python -c \"import fastapi, uvicorn\"" >/dev/null 2>&1; then
    PYTHON_MODE="powershell"
  else
    echo "시뮬레이터 서버 의존성이 없습니다:"
    echo "  python -m pip install -r server/requirements-sim.txt"
    echo "  다른 Python을 쓰려면 MEDIAL_PYTHON=/path/to/python ./run.sh"
    exit 1
  fi
fi

if [ "$PYTHON_MODE" = "powershell" ]; then
  echo "Windows Python 환경을 사용합니다."
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
    running_pid="$(pid_on "$API_PORT")"
    echo "서버 정리 (PID ${running_pid:-$api_pid})"
    stop_pid "${running_pid:-$api_pid}"
  }
  [ "$started_web" = 1 ] && [ -n "$web_pid" ] && {
    running_pid="$(pid_on "$WEB_PORT")"
    echo "개발 서버 정리 (PID ${running_pid:-$web_pid})"
    stop_pid "${running_pid:-$web_pid}"
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
  . <(sed 's/\r$//' ./server/.env)
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
  if [ "$PYTHON_MODE" = "powershell" ]; then
    MEDIAL_SIM_PORT="$API_PORT" powershell.exe -NoProfile -Command "python server/sim_main.py" >"$API_LOG" 2>&1 &
  else
    MEDIAL_SIM_PORT="$API_PORT" "$PYTHON_BIN" server/sim_main.py >"$API_LOG" 2>&1 &
  fi
  api_pid=$!
  started_api=1
fi

# 준비될 때까지 기다린다. 그냥 sleep 하면 느린 첫 기동에서 브라우저가 먼저 뜬다.
#
# 세 가지를 구분한다. 프로세스가 죽었다 / 아직 안 떴다 / 떴는데 요청이 터진다.
# 세 번째를 30초 동안 말없이 기다린 적이 있는데, 그때 원인은 이미 로그 끝에
# 적혀 있었다(스키마 충돌). 뜬 서버가 5xx를 주면 그 자리에서 로그를 보여 준다.
api_health="http://127.0.0.1:$API_PORT/api/sim/health"
api_status=000
for _ in $(seq 1 60); do
  api_status="$(http_status "$api_health")"
  case "$api_status" in
    2*) break ;;
    000) : ;;   # 아직 안 떴다
    *)
      die_with_log "서버는 떴는데 $api_health 가 $api_status 를 돌려줍니다." "$API_LOG"
      cleanup
      ;;
  esac
  if [ "$started_api" = 1 ] && ! kill -0 "$api_pid" 2>/dev/null; then
    die_with_log "서버가 시작하자마자 죽었습니다." "$API_LOG"
    exit 1
  fi
  sleep 0.5
done

case "$api_status" in
  2*) : ;;
  *)
    die_with_log "서버가 30초 안에 응답하지 않습니다." "$API_LOG"
    cleanup
    ;;
esac

# 원자료를 읽었는지 합성 마을로 도는지 여기서 알려 준다. 화면 배지와 같은 값이다.
if command -v curl >/dev/null 2>&1; then
  source_kind="$(http_body "http://127.0.0.1:$API_PORT/api/sim/village" |
    python -c 'import json,sys; v=json.load(sys.stdin); print(v.get("dataSource","?"))' 2>/dev/null)"
else
  source_kind="$(powershell.exe -NoProfile -Command \
    "(Invoke-RestMethod -Uri 'http://127.0.0.1:$API_PORT/api/sim/village').dataSource" \
    2>/dev/null | tr -d '\r')"
fi
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

web_status=000
for _ in $(seq 1 60); do
  web_status="$(http_status "http://localhost:$WEB_PORT/")"
  case "$web_status" in
    2*) break ;;
    000) : ;;
    *) die_with_log "개발 서버가 $web_status 를 돌려줍니다." "$WEB_LOG"; cleanup ;;
  esac
  if [ "$started_web" = 1 ] && ! kill -0 "$web_pid" 2>/dev/null; then
    die_with_log "개발 서버가 시작하자마자 죽었습니다." "$WEB_LOG"
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
