@echo off
rem Starts the Desimer exhibition server and screens by running run-exhibition.sh in Git Bash.
rem Usage: run-exhibition.cmd [--no-open | --stop]
rem Keep this file ASCII-only with CRLF line endings. cmd.exe reads a batch file with LF-only endings or
rem multibyte comment text in the wrong places and runs pieces of the comments as commands.
rem Ctrl+C stops only what this script started; run-exhibition.cmd --stop stops it from another window.
setlocal
cd /d "%~dp0"
set "BASH=%ProgramFiles%\Git\bin\bash.exe"
if not exist "%BASH%" set "BASH=bash"
"%BASH%" run-exhibition.sh %*
if errorlevel 1 pause
