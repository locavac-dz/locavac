@echo off
cd /d "%~dp0"
title Locavac — Plateforme de location de vacances
echo Démarrage de Locavac...
start "" http://localhost:3000
node server/index.js
