@echo off
setlocal enabledelayedexpansion
REM Cari Python 32-bit di lokasi instalasi umum, tanpa menyentuh PATH sistem
REM (supaya Python 64-bit yang sudah ada tidak terganggu).

set PY32=
for %%P in (
  "%LocalAppData%\Programs\Python\Python310-32\python.exe"
  "%LocalAppData%\Programs\Python\Python311-32\python.exe"
  "%LocalAppData%\Programs\Python\Python312-32\python.exe"
  "%LocalAppData%\Programs\Python\Python313-32\python.exe"
  "%LocalAppData%\Programs\Python\Python314-32\python.exe"
  "C:\Python310-32\python.exe"
  "C:\Python311-32\python.exe"
  "C:\Python314-32\python.exe"
) do (
  if exist %%P set PY32=%%P
)

if "%PY32%"=="" (
  echo Python 32-bit tidak ditemukan.
  echo Install dulu dari python.org ^(pilih "Windows installer ^(32-bit^)"^),
  echo JANGAN centang "Add python.exe to PATH" saat instalasi.
  pause
  exit /b 1
)

echo Memakai: %PY32%
%PY32% -c "import struct; print('Arsitektur:', struct.calcsize('P')*8, 'bit')"

%PY32% -m pip install -r requirements.txt pyinstaller
%PY32% -m PyInstaller --noconfirm --onefile --windowed --name SplitSkripsi split_skripsi.py

echo Selesai: dist\SplitSkripsi.exe ^(32-bit^)
pause