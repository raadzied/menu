@echo off
title Mesakhen Menu System
color 0A

echo ================================================
echo         MESAKHEN MENU SYSTEM - STARTING
echo ================================================
echo.

cd /d "%~dp0"

if not exist "package.json" (
    echo [ERROR] package.json was not found in this folder:
    echo %cd%
    echo.
    echo This usually means the ZIP was extracted into a folder
    echo INSIDE another folder. Please check your extracted files:
    echo you should see package.json directly next to this .bat file.
    echo If you see a folder named "mexirest" here, open it and
    echo run the .bat file that is inside it instead.
    echo.
    pause
    exit /b
)

node -v >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Node.js was not found on this computer.
    echo Please install it first from: https://nodejs.org
    echo Then run this file again.
    echo.
    pause
    exit /b
)

echo [1/4] Node.js found successfully.
echo.

if not exist ".env" (
    echo [2/4] Creating settings file...
    copy ".env.example" ".env" >nul
    echo Created .env with default settings.
    echo You can edit it later with Notepad to change the admin password.
) else (
    echo [2/4] Settings file already exists.
)
echo.

if not exist "node_modules" (
    echo [3/4] Installing required packages, this needs internet
    echo and may take a minute or two, please wait...
    call npm install
    if errorlevel 1 (
        echo.
        echo [ERROR] Package installation failed.
        echo Please check your internet connection and try again.
        pause
        exit /b
    )
) else (
    echo [3/4] Packages already installed.
)
echo.

if not exist "server\db\restaurant.db" (
    echo [4/4] Setting up database, admin account, and demo menu...
    call npm run seed
) else (
    echo [4/4] Database already exists.
)
echo.

echo ================================================
echo   Starting the server now...
echo   DO NOT CLOSE THIS WINDOW while the restaurant
echo   is open and using the menu system.
echo ================================================
echo.

call npm start

pause
