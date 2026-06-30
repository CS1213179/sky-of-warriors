@echo off
chcp 65001 >nul
echo ====================================================
echo  Su-57 GLB downloader (HuggingFace)
echo ====================================================
echo.
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$u='https://huggingface.co/spaces/cutechicken/3D-Airforce-Simulator/resolve/main/models/su-57.glb';" ^
  "$o=Join-Path '%~dp0' 'su57.glb';" ^
  "$tmp=Join-Path $env:TEMP ('su57_' + [guid]::NewGuid().ToString() + '.glb');" ^
  "curl.exe -L --retry 8 --retry-all-errors --connect-timeout 30 --max-time 600 -H 'User-Agent: Mozilla/5.0' -o $tmp $u;" ^
  "if ((Test-Path $tmp) -and ((Get-Item $tmp).Length -gt 1000000)) { Move-Item -Force $tmp $o; Write-Host 'OK:' $o } else { Write-Host 'Download failed.'; exit 1 }"
if errorlevel 1 pause & exit /b 1
echo Done.
pause
