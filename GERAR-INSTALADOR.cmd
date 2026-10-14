@echo off
setlocal
cd /d "%~dp0"
where npm >nul 2>&1
if errorlevel 1 (
  echo Instale o Node.js no computador que vai gerar o instalador.
  pause
  exit /b 1
)
echo Preparando o Trend Ops...
call npm install
if errorlevel 1 (
  echo Nao foi possivel instalar as dependencias. Confira a internet e o erro acima.
  pause
  exit /b 1
)
call npm run build
if errorlevel 1 (
  echo Nao foi possivel gerar o instalador. Confira o erro acima.
  pause
  exit /b 1
)
echo Instalador pronto na pasta dist. Envie o arquivo Setup.exe para os outros PCs.
explorer "%~dp0dist"
pause
