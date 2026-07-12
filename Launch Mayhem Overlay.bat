@echo off
rem Launches the Mayhem Overlay without keeping a console open.
start "" "%~dp0node_modules\electron\dist\electron.exe" "%~dp0."
