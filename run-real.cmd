@echo off
rem MEDial real 버전 — 실시간으로 생성한다. server/.env 의 키로 모델을 부른다 (서버 8010 · 화면 5173)
rem 더블클릭하거나: run-real.cmd [--no-open ^| --stop]. 하는 일은 scripts\launch.sh 에 있다.
setlocal
cd /d "%~dp0"
set "BASH=%ProgramFiles%\Git\bin\bash.exe"
if not exist "%BASH%" set "BASH=bash"
"%BASH%" scripts/launch.sh real %*
if errorlevel 1 pause
