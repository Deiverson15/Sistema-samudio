@echo off
TITLE Servidor de Inventario
COLOR 0B
echo ==========================================
echo   INICIANDO SISTEMA DE INVENTARIO
echo ==========================================
echo.

:: Cambiar al directorio donde esta este archivo
cd /d "%~dp0"

:: Verificar si Node.js esta instalado
node -v >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Node.js no esta instalado. Por favor instalalo desde nodejs.org
    pause
    exit
)

:: Verificar si existe la carpeta node_modules
if not exist node_modules (
    echo [INFO] No se encontraron dependencias. Instalando ahora...
    call npm install
    echo.
)

:: Iniciar el servidor
echo Iniciando el servidor en http://localhost:3000...
echo Presiona CTRL + C para detenerlo.
echo.
node index.js

:: Si falla, mantener la ventana abierta para ver el error
if %errorlevel% neq 0 (
    echo.
    echo [ALERTA] Hubo un problema al iniciar el servidor.
    pause
)