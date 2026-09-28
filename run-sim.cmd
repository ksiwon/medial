@echo off
rem MEDial sim 버전 — 미리 돌려 둔 기록을 재생한다. 모델을 부르지 않는다 (서버 8020 · 화면 5180)
rem 더블클릭하거나: run-sim.cmd [--no-open ^| --stop]. 하는 일은 scripts\launch.sh 에 있다.
setlocal
cd /d "%~dp0"
set "BASH=%ProgramFiles%\Git\bin\bash.exe"
if not exist "%BASH%" set "BASH=bash"
"%BASH%" scripts/launch.sh sim %*
if errorlevel 1 pause
