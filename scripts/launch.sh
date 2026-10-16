#!/usr/bin/env bash
#
# MEDial 띄우기 - 두 버전 중 하나. 직접 부르지 말고 저장소 루트의 진입점을 쓴다.
#
#   run-sim   미리 돌려 둔 기록을 재생한다. 모델을 부르지 않고 키를 읽지 않는다.
#             서버 8020 · 화면 5180 · 기록 local-data/runs/sim.sqlite3
#   run-real  실시간으로 생성한다. server/.env 의 키로 모델을 부른다.
#             서버 8010 · 화면 5173 · 기록 local-data/runs/real.sqlite3
#
#   옵션  --no-open   브라우저는 열지 않는다
#         --stop      이 버전으로 띄워 둔 것을 내린다
#
# 두 버전은 포트와 기록이 달라서 동시에 띄워 둘 수 있다. Ctrl+C 는 이 스크립트가
# 띄운 것만 정리한다. 포트에 이미 같은 버전의 MEDial 이 떠 있으면 그대로 쓰고, 다른
# 프로그램(또는 다른 버전)이 쓰고 있으면 다음 빈 포트로 옮겨 띄운다. 위 포트는 첫
# 후보이고, 실제로 쓴 포트는 .run/<버전>/ports 에 적어 --stop 이 읽는다.
set -u

cd "$(dirname "$0")/.."

MODE="${1:-}"
shift || true
case "$MODE" in
  sim)
    TITLE="sim · 미리 돌려 둔 기록"
    API_PORT="${MEDIAL_SIM_PORT:-8020}"
    WEB_PORT="${MEDIAL_WEB_PORT:-5180}"
    ;;
  real)
    TITLE="real · 실시간 생성"
    API_PORT="${MEDIAL_SIM_PORT:-8010}"
    WEB_PORT="${MEDIAL_WEB_PORT:-5173}"
    ;;
  *)
    echo "사용법: run-sim 또는 run-real (scripts/launch.sh sim|real)"
    exit 2
    ;;
esac

LOG_DIR=".run/$MODE"
API_LOG="$LOG_DIR/server.log"
WEB_LOG="$LOG_DIR/web.log"
PORTS_FILE="$LOG_DIR/ports"
# 첫 후보부터 몇 개까지 볼지. 그 안에 빈 포트가 없으면 멈추고 말한다.
PORT_TRIES=20
# 화면이 MEDial 의 것인지 알아보는 표시. index.html 의 <title> 과 같아야 한다.
WEB_MARK="MEDial 연구 시뮬레이터"

case "$API_PORT:$WEB_PORT" in
  *[!0-9:]*) echo "포트는 숫자여야 합니다: API=$API_PORT WEB=$WEB_PORT"; exit 2 ;;
esac

open_browser=1
mode_action=run
for arg in "$@"; do
  case "$arg" in
    --no-open) open_browser=0 ;;
    --stop) mode_action=stop ;;
    -h|--help) sed -n '3,16p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
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
# 000 = 아직 안 떴다(연결 자체가 안 됨). 그 밖에는 뜬 채로 그 코드를 돌려준 것이다.
# 둘을 구분해야 "기다린다"와 "터졌으니 로그를 보여 준다"를 나눌 수 있다.
http_status() {
  if command -v curl >/dev/null 2>&1; then
    # 연결이 안 되면 curl 은 000 을 찍고도 실패로 끝난다. 거기에 000 을 또 붙이면
    # "000000" 이 되어 "아직 안 떴다"로 읽히지 않는다.
    code="$(curl -s -o /dev/null -m 5 -w '%{http_code}' "$1" 2>/dev/null)"
    echo "${code:-000}"
  elif command -v powershell.exe >/dev/null 2>&1; then
    powershell.exe -NoProfile -Command \
      "try { (Invoke-WebRequest -UseBasicParsing -TimeoutSec 5 -Uri '$1').StatusCode }
       catch { if (\$_.Exception.Response) { [int]\$_.Exception.Response.StatusCode } else { 0 } }" \
      2>/dev/null | tr -d '\r' | tr -d ' ' | head -1
  else
    echo 000
  fi
}
http_body() {
  if command -v curl >/dev/null 2>&1; then
    curl -fs "$1" 2>/dev/null
  else
    powershell.exe -NoProfile -Command \
      "(Invoke-WebRequest -UseBasicParsing -Uri '$1').Content" 2>/dev/null | tr -d '\r'
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

# --- 이 포트에 떠 있는 것이 이 버전의 MEDial 인가 -------------------------------
# 포트가 쓰이고 있다는 것만으로는 모른다. 다른 프로젝트의 vite 가 5180 에 떠 있을 때
# 그것을 MEDial 로 여기고 붙은 적이 있다(2026-09-29).
mode_of() {
  http_body "$1" | sed -n 's/.*"mode" *: *"\([a-z]*\)".*/\1/p' | head -1
}
api_is_ours() {
  [ "$(mode_of "http://127.0.0.1:$1/api/sim/health")" = "$MODE" ]
}
web_is_medial() {
  http_body "http://localhost:$1/" | grep -qF "$WEB_MARK"
}
# 붙여 쓰려면 화면이 MEDial 이고, 그 프록시 너머가 이 버전의 서버여야 한다.
web_is_ours() {
  web_is_medial "$1" && [ "$(mode_of "http://localhost:$1/api/sim/health")" = "$MODE" ]
}

# 첫 후보부터 보며 "포트 상태"를 찍는다. 상태는 free(비어 있음) 또는 ours(이 버전이
# 이미 떠 있음). 남의 것이 쓰는 포트는 건너뛴다.
pick_port() {
  local port="$1" check="$2" i
  for i in $(seq 1 "$PORT_TRIES"); do
    if ! listening "$port"; then echo "$port free"; return 0; fi
    if "$check" "$port"; then echo "$port ours"; return 0; fi
    port=$((port + 1))
  done
  return 1
}

if [ "$mode_action" = stop ]; then
  # 지난 실행이 실제로 쓴 포트. 없으면 첫 후보.
  if [ -f "$PORTS_FILE" ]; then read -r API_PORT WEB_PORT <"$PORTS_FILE"; fi
  # MEDial 인 것만 내린다. 같은 포트를 남의 프로그램이 쓰고 있으면 건드리지 않는다.
  for pair in "$API_PORT:api_is_ours:서버" "$WEB_PORT:web_is_medial:화면"; do
    port="${pair%%:*}"; rest="${pair#*:}"; check="${rest%%:*}"; name="${rest#*:}"
    pid="$(pid_on "$port")"
    if [ -z "$pid" ]; then
      echo "$name 포트 $port 는 비어 있음"
    elif "$check" "$port"; then
      echo "$name 포트 $port (PID $pid) 정리"
      stop_pid "$pid"
    else
      echo "$name 포트 $port 는 MEDial $MODE 이 아닌 프로그램(PID $pid)이 쓰고 있어 두었습니다"
    fi
  done
  rm -f "$PORTS_FILE"
  exit 0
fi

echo "MEDial $TITLE"
mkdir -p "$LOG_DIR"

# --- 이 버전이 설 수 있는가 ----------------------------------------------------
# 서버도 같은 것을 확인하지만, 창을 열기 전에 여기서 무엇을 하라고 말해 준다.
if [ "$MODE" = sim ]; then
  if [ ! -f local-data/runs/sim.sqlite3 ] && [ -z "${MEDIAL_SIM_DB:-}" ]; then
    echo "sim 버전이 재생할 기록이 없습니다 (local-data/runs/sim.sqlite3)."
    echo "real 버전에서 돌린 것을 얼려 두면 sim 이 그것을 재생합니다:"
    echo "  python scripts/freeze_sim.py"
    exit 1
  fi
  echo "모델을 부르지 않습니다 · 키를 읽지 않습니다 · 새 실행을 만들지 않습니다"
else
  # 키의 값은 읽지 않고 있는지만 본다. 값을 읽어 넣는 것은 서버 프로세스다.
  if ! grep -Eq '^[[:space:]]*OPENAI_API_KEY[[:space:]]*=[[:space:]]*[^[:space:]#]' server/.env 2>/dev/null; then
    echo "real 버전은 모델 키가 있어야 합니다. server/.env 에 OPENAI_API_KEY 를 적으세요"
    echo "(양식은 server/.env.example). 미리 돌려 둔 기록을 보려면 run-sim 을 쓰세요."
    exit 1
  fi
  echo "server/.env 의 키로 모델을 부릅니다 · 실행마다 호출이 기록되고 비용이 듭니다"
fi

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
    echo "Windows Python 환경을 사용합니다."
  else
    echo "시뮬레이터 서버 의존성이 없습니다:"
    echo "  python -m pip install -r server/requirements-sim.txt"
    echo "  다른 Python을 쓰려면 MEDIAL_PYTHON=/path/to/python"
    exit 1
  fi
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
  exit "${1:-0}"
}
trap cleanup INT TERM

# --- 시뮬레이터 서버 -----------------------------------------------------------
# 버전·포트는 인자와 환경변수로 넘긴다. 키는 넘기지 않는다 - real 서버가
# server/.env 를 스스로 읽고, sim 서버는 읽지 않는다.
wanted="$API_PORT"
if ! picked="$(pick_port "$API_PORT" api_is_ours)"; then
  echo "서버 포트 $wanted 부터 $PORT_TRIES 개가 모두 다른 프로그램에 쓰이고 있습니다."
  echo "MEDIAL_SIM_PORT 로 다른 첫 후보를 고르세요."
  exit 1
fi
API_PORT="${picked% *}"
[ "$API_PORT" != "$wanted" ] && echo "서버: 포트 $wanted 는 다른 프로그램이 쓰고 있어 $API_PORT 을 씁니다."
if [ "${picked#* }" = ours ]; then
  echo "서버: 이미 $API_PORT 에서 $MODE 버전이 돌고 있습니다. 그대로 씁니다."
else
  echo "서버 시작 ... (로그: $API_LOG)"
  if [ "$PYTHON_MODE" = "powershell" ]; then
    powershell.exe -NoProfile -Command \
      "\$env:MEDIAL_SIM_PORT='$API_PORT'; python server/sim_main.py --mode $MODE" >"$API_LOG" 2>&1 &
  else
    MEDIAL_SIM_PORT="$API_PORT" "$PYTHON_BIN" server/sim_main.py --mode "$MODE" >"$API_LOG" 2>&1 &
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
      cleanup 1
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
    cleanup 1
    ;;
esac

# 다른 버전의 서버에는 붙지 않는다 - pick_port 가 health 의 mode 로 걸렀다. sim 화면이
# real 서버에 붙으면 "미리 돌려 둔 것"이라는 말이 거짓이 된다.
source_kind="$(http_body "$api_health" | sed -n 's/.*"dataSource" *: *"\([^"]*\)".*/\1/p')"
echo "서버 준비됨 · http://127.0.0.1:$API_PORT · $MODE · 데이터: ${source_kind:-확인 못 함}"

# --- 프런트 --------------------------------------------------------------------
wanted="$WEB_PORT"
if ! picked="$(pick_port "$WEB_PORT" web_is_ours)"; then
  echo "화면 포트 $wanted 부터 $PORT_TRIES 개가 모두 다른 프로그램에 쓰이고 있습니다."
  echo "MEDIAL_WEB_PORT 로 다른 첫 후보를 고르세요."
  cleanup 1
fi
WEB_PORT="${picked% *}"
[ "$WEB_PORT" != "$wanted" ] && echo "화면: 포트 $wanted 는 다른 프로그램이 쓰고 있어 $WEB_PORT 을 씁니다."
if [ "${picked#* }" = ours ]; then
  echo "화면: 이미 $WEB_PORT 에서 돌고 있습니다. 그대로 씁니다."
else
  echo "화면 시작 ... (로그: $WEB_LOG)"
  if [ "$PYTHON_MODE" = "powershell" ]; then
    powershell.exe -NoProfile -Command \
      "\$env:MEDIAL_SIM_URL='http://127.0.0.1:$API_PORT'; npx vite --port $WEB_PORT --strictPort" >"$WEB_LOG" 2>&1 &
  else
    MEDIAL_SIM_URL="http://127.0.0.1:$API_PORT" npx vite --port "$WEB_PORT" --strictPort >"$WEB_LOG" 2>&1 &
  fi
  web_pid=$!
  started_web=1
fi

web_status=000
for _ in $(seq 1 60); do
  web_status="$(http_status "http://localhost:$WEB_PORT/")"
  case "$web_status" in
    2*) break ;;
    000) : ;;
    *) die_with_log "화면 서버가 $web_status 를 돌려줍니다." "$WEB_LOG"; cleanup 1 ;;
  esac
  if [ "$started_web" = 1 ] && ! kill -0 "$web_pid" 2>/dev/null; then
    die_with_log "화면 서버가 시작하자마자 죽었습니다." "$WEB_LOG"
    cleanup 1
  fi
  sleep 0.5
done

url="http://localhost:$WEB_PORT/"
echo "화면 준비됨 · $url"
echo "$API_PORT $WEB_PORT" >"$PORTS_FILE"

# 두 화면 전시: iPad가 비출 QR을 터미널에도 찍는다(모니터 화면에도 같은 QR이 뜬다). 실패해도 서버는 계속 돈다.
if command -v node >/dev/null 2>&1; then
  node scripts/two_screens.cjs qr "$WEB_PORT" || true
fi

if [ "$open_browser" = 1 ]; then
  # Git Bash 는 start, 그 밖에는 xdg-open/open.
  (start "" "$url" 2>/dev/null || xdg-open "$url" 2>/dev/null || open "$url" 2>/dev/null) &
fi

# 둘 다 이미 떠 있었으면 감시할 것이 없다. 남의 서버에 Ctrl+C 를 걸어 둘 이유가
# 없으므로 주소만 알려 주고 끝낸다.
if [ "$started_api" = 0 ] && [ "$started_web" = 0 ]; then
  echo
  echo "둘 다 이미 떠 있었습니다. 이 창은 닫아도 됩니다."
  echo "내리려면: run-$MODE --stop"
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
