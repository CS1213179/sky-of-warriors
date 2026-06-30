@echo off
chcp 65001 >nul
echo ====================================================
echo  F-22 Raptor GLB downloader (HuggingFace - same pack as F-15/F-16)
echo ====================================================
echo.
echo  Downloading f22.glb (~4.9 MB)...
echo.
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$u='https://huggingface.co/spaces/cutechicken/3D-Airforce-Simulator/resolve/main/models/f-22.glb';" ^
  "$o=Join-Path '%~dp0' 'f22.glb';" ^
  "$tmp=Join-Path $env:TEMP ('f22_' + [guid]::NewGuid().ToString() + '.glb');" ^
  "curl.exe -L --retry 8 --retry-all-errors --connect-timeout 30 --max-time 600 -H 'User-Agent: Mozilla/5.0' -o $tmp $u;" ^
  "if ((Test-Path $tmp) -and ((Get-Item $tmp).Length -gt 1000000)) { Move-Item -Force $tmp $o; Write-Host 'OK:' $o } else { Write-Host 'Download failed. Open HuggingFace in browser.'; exit 1 }"
if errorlevel 1 (
  echo.
  echo  Manual fallback:
  echo  1) Open the URL below in your browser
  echo  2) Save as f22.glb into:
  echo       %~dp0f22.glb
  echo.
  start "" "https://huggingface.co/spaces/cutechicken/3D-Airforce-Simulator/tree/main/models"
  pause
  exit /b 1
)
echo.
echo  Done. Refresh the game page to load the new F-22 model.
pause
