@echo off
cd /d "%~dp0"
call .venv\Scripts\activate.bat
if not exist frontend\dist (
  echo Compilando o painel React pela primeira vez...
  pushd frontend
  call npm install
  call npm run build
  popd
)
if not exist logs mkdir logs
python -X faulthandler servidor.py 2>> logs\servidor.err.log
pause
