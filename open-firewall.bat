@echo off
title Add Firewall Rule - Run as Administrator
echo ================================================
echo   MUST run as ADMINISTRATOR (right-click > Run as admin)
echo ================================================
echo.

echo [1] Adding inbound rule for port 3000...
netsh advfirewall firewall add rule name="Mesakhen Menu 3000" dir=in action=allow protocol=TCP localport=3000 profile=any
echo.

echo [2] Verifying rule exists...
netsh advfirewall firewall show rule name="Mesakhen Menu 3000"
echo.

echo ================================================
echo   DONE. Test from phone now.
echo   Try: http://192.168.1.4:3000/menu?t=eeb90fde1d7fb689f823119c5dc786eb
echo ================================================
pause