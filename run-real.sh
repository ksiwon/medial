#!/usr/bin/env bash
# MEDial real 버전 — 실시간으로 생성한다. server/.env 의 키로 모델을 부른다 (서버 8010 · 화면 5173)
#   ./run-real.sh            띄우고 브라우저를 연다
#   ./run-real.sh --no-open  브라우저는 열지 않는다
#   ./run-real.sh --stop     띄워 둔 것을 내린다
# 하는 일은 scripts/launch.sh 에 있다.
exec "$(dirname "$0")/scripts/launch.sh" real "$@"
