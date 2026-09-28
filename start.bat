@echo off
rem One command to run the whole app (API + website) on this computer.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start.ps1"
if errorlevel 1 pause
