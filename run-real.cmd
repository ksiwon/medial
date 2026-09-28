@echo off
chcp 65001 >nul
rem MEDial real 버전 — 실시간으로 생성한다. server/.env 의 키로 모델을 부른다 (서버 8010 · 화면 5173)
rem 더블클릭하거나: run-real.cmd [--no-open ^| --stop]. 하는 일은 scripts\launch.sh 에 있다.
rem 창을 UTF-8로 바꾼다: 스크립트의 한글 출력이 949 코드 페이지 창에서 깨지지 않게.
rem 끝낼 때는 Ctrl+C. 창을 그냥 닫았으면 다음 실행이 떠 있는 서버를 그대로 쓰고, run-real.cmd --stop 으로 내린다.
setlocal
cd /d "%~dp0"
set "BASH=%ProgramFiles%\Git\bin\bash.exe"
if not exist "%BASH%" set "BASH=bash"
"%BASH%" scripts/launch.sh real %*
if errorlevel 1 pause
