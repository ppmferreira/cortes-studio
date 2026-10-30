@echo off
cd /d "%~dp0"
call .venv\Scripts\activate.bat
rem Para a GPU: adiciona as DLLs CUDA instaladas via pip ao PATH
for /d %%D in (".venv\Lib\site-packages\nvidia\*") do set "PATH=%%~fD\bin;%PATH%"
python cortes.py tudo %*
pause
