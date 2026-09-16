@echo off
title Set Static IP - Mesakhen Server
color 0E

echo ================================================
echo   Mesakhen Menu - Set Static IP for Server PC
echo ================================================
echo.
echo This script sets a FIXED IP address on this PC so
echo that the QR/NFC table links always work, even if
echo the router restarts.
echo.
echo IMPORTANT: The QR/NFC codes are PERMANENT and are
echo printed/engraved on the tables once. Set this fixed
echo IP BEFORE printing the codes and never change it,
echo otherwise printed codes will stop working.
echo.
echo Current router gateway is usually: 192.168.1.1
echo (check the label under your TOTOLINK ND300)
echo.
echo IMPORTANT: Choose an IP that is NOT used by any
echo other device and is OUTSIDE the DHCP range of the
echo router if possible.
echo.

set /p PICKIP=Enter the static IP to use (e.g. 192.168.1.10): 
if "%PICKIP%"=="" goto :badip

set /p GATEWAY=Enter router gateway IP (e.g. 192.168.1.1): 
if "%GATEWAY%"=="" set GATEWAY=192.168.1.1

echo.
echo Connect to Wi-Fi or Ethernet on the network that
echo the TOTOLINK router uses, then press any key...
pause >nul

netsh interface ipv4 show interfaces
echo.
echo Type the Interface Name shown above EXACTLY as listed
echo (e.g. "Wi-Fi" or "Ethernet" or "Wireless Network Connection").

set /p IFNAME=Interface name: 
if "%IFNAME%"=="" goto :badif

echo.
echo Setting %PICKIP% on interface "%IFNAME%" with gateway %GATEWAY% ...
netsh interface ip set address name="%IFNAME%" static %PICKIP% 255.255.255.0 %GATEWAY% 1
if errorlevel 1 goto :fail

netsh interface ip set dns name="%IFNAME%" static %GATEWAY%
echo.
echo ================================================
echo   DONE. Your PC address is now: %PICKIP%
echo.
echo   The QR/NFC codes are PERMANENT and generated only
echo   once at table creation. The print page uses .env
echo   LAN_IP. Make sure LAN_IP in .env matches %PICKIP%.
echo   Do NOT change the IP after printing codes.
echo ================================================
pause
exit /b

:badip
echo [ERROR] No IP entered.
pause
exit /b

:badif
echo [ERROR] Interface name is required.
pause
exit /b

:fail
echo.
echo [ERROR] Failed to set the static IP.
echo Tips:
echo   - Run this file as Administrator (right-click - Run as administrator)
echo   - Make sure the interface name is correct
echo     (from "netsh interface ipv4 show interfaces")
echo   - Make sure the IP is free and in the same subnet
echo.
pause
exit /b