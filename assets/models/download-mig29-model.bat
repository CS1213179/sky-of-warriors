@echo off
chcp 65001 >nul
echo ====================================================
echo  MiG-29 GLB downloader (HuggingFace - same pack as F-15/F-16)
echo ====================================================
echo.
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$u='https://huggingface.co/spaces/cutechicken/3D-Airforce-Simulator/resolve/main/models/mig-29.glb';" ^
  "$o=Join-Path '%~dp0' 'mig29.glb';" ^
  "$tmp=Join-Path $env:TEMP ('mig29_' + [guid]::NewGuid().ToString() + '.glb');" ^
  "curl.exe -L --retry 8 --retry-all-errors --connect-timeout 30 --max-time 600 -H 'User-Agent: Mozilla/5.0' -o $tmp $u;" ^
  "if ((Test-Path $tmp) -and ((Get-Item $tmp).Length -gt 1000000)) { Move-Item -Force $tmp $o; Write-Host 'OK:' $o } else { Write-Host 'Download failed.'; exit 1 }"
if errorlevel 1 pause & exit /b 1
echo Done.
pause
