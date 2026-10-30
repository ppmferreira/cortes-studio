@echo off
cd /d "%~dp0"
echo === Instalando ffmpeg ===
where ffmpeg >nul 2>nul || winget install --id Gyan.FFmpeg -e --accept-source-agreements --accept-package-agreements
echo === Criando ambiente Python ===
python -m venv .venv
call .venv\Scripts\activate.bat
python -m pip install --upgrade pip
pip install -r requirements.txt
echo === Bibliotecas CUDA para usar a placa NVIDIA (opcional, acelera a transcricao) ===
pip install nvidia-cublas-cu12 nvidia-cudnn-cu12==9.*
mkdir entrada 2>nul
mkdir saida 2>nul
echo.
echo Pronto. Coloque o episodio na pasta "entrada" e rode rodar.bat
pause
