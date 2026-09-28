#!/usr/bin/env bash
# MEDial sim 버전 — 미리 돌려 둔 기록을 재생한다. 모델을 부르지 않는다 (서버 8020 · 화면 5180)
#   ./run-sim.sh            띄우고 브라우저를 연다
#   ./run-sim.sh --no-open  브라우저는 열지 않는다
#   ./run-sim.sh --stop     띄워 둔 것을 내린다
# 하는 일은 scripts/launch.sh 에 있다.
exec "$(dirname "$0")/scripts/launch.sh" sim "$@"
