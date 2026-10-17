@echo off
chcp 65001 >nul
rem Dially 전시 서버와 화면을 띄운다. 더블클릭하거나: run-exhibition.cmd [--no-open ^| --stop]
rem 창을 UTF-8로 바꾼다: 스크립트의 한글 출력이 949 코드 페이지 창에서 깨지지 않게.
rem 끝낼 때는 Ctrl+C. 창을 그냥 닫았으면 다음 실행이 떠 있는 서버를 그대로 쓰고, run-exhibition.cmd --stop 으로 내린다.
setlocal
cd /d "%~dp0"
set "BASH=%ProgramFiles%\Git\bin\bash.exe"
if not exist "%BASH%" set "BASH=bash"
"%BASH%" run-exhibition.sh %*
if errorlevel 1 pause
