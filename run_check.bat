@echo off
cd /d "c:\Users\姚\Documents\trae_projects\48moniqi\deploy"
"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" --headless --disable-gpu --no-sandbox --hide-scrollbars --window-size=900,600 --screenshot=check.png --virtual-time-budget=5000 "http://localhost:8765/syntax_check.html"
echo Exit: %ERRORLEVEL%
dir check.png
