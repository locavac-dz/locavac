@echo off
title Locavac - Serveur
color 0A

:: Se placer dans le dossier du script (important !)
cd /d "%~dp0"

echo.
echo  ================================================
echo     Locavac - Location de vacances en Algerie
echo  ================================================
echo.

:: Chercher Node.js
set "NODE="
if exist "C:\Program Files\nodejs\node.exe" set "NODE=C:\Program Files\nodejs\node.exe"
if "%NODE%"=="" (where node >nul 2>&1 && set "NODE=node")

if "%NODE%"=="" (
    echo  [ERREUR] Node.js introuvable.
    echo  Telechargez-le sur : https://nodejs.org
    echo.
    pause
    exit /b 1
)

echo  [OK] Node.js :
"%NODE%" --version

:: Installer les dependances si necessaire
if not exist "node_modules" (
    echo.
    echo  [INFO] Installation des dependances...
    if exist "C:\Program Files\nodejs\npm.cmd" (
        "C:\Program Files\nodejs\npm.cmd" install
    ) else (
        npm install
    )
)

:: Port d'ecoute du serveur (PORT dans .env, 3000 par defaut - voir server/index.js)
set "APP_PORT=3000"

:: Arreter une ancienne instance de Locavac encore a l'ecoute sur ce port
for /f "tokens=5" %%p in ('netstat -ano 2^>nul ^| findstr /R /C:":%APP_PORT% .*LISTENING"') do (
    taskkill /PID %%p /F >nul 2>&1
)
timeout /t 1 /nobreak >nul

:: Ouvrir le navigateur apres 2 secondes (en arriere-plan)
start "" /B cmd /c "timeout /t 2 /nobreak >nul && start http://localhost:%APP_PORT%"

echo.
echo  [OK] Serveur demarre sur http://localhost:%APP_PORT%
echo  Appuyez sur Ctrl+C pour arreter.
echo.

:: Lancer le serveur (au premier plan - une seule fois)
"%NODE%" server/index.js

echo.
echo  [INFO] Serveur arrete.
pause
