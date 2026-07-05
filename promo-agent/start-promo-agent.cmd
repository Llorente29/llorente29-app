@echo off
cd /d C:\folvy-promo-agent
:loop
echo [%date% %time%] arrancando folvy-promo-agent >> robot.log
node agent.js >> robot.log 2>&1
echo [%date% %time%] robot caido (codigo %errorlevel%), reinicio en 10s >> robot.log
timeout /t 10 /nobreak > nul
goto loop
