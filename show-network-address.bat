@echo off
title Network Address
color 0B

echo ================================================
echo   Look for the line that says "IPv4 Address"
echo   under "Wireless LAN adapter Wi-Fi" or "Ethernet"
echo   Use that number on your phone browser like this:
echo   http://192.168.1.15:3000/admin/login.html
echo ================================================
echo.

ipconfig | findstr /i "IPv4"

echo.
pause
