@echo off
chcp 65001 >nul
echo ====================================================
echo  HuggingFace ??? GLB ?? ???? (F-14/F-A-18 ??)
echo  F-15, F-16, F-22, F-35, A-10, MiG-29, Su-35, Su-57, Su-57b
echo ====================================================
echo.
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$base='https://huggingface.co/spaces/cutechicken/3D-Airforce-Simulator/resolve/main/models';" ^
  "$dir='%~dp0';" ^
  "$map=@(@{hf='f-15.glb';local='f15.glb'},@{hf='f-16.glb';local='f16.glb'},@{hf='f-22.glb';local='f22.glb'},@{hf='f-35.glb';local='f35.glb'},@{hf='a-10.glb';local='a10.glb'},@{hf='mig-29.glb';local='mig29.glb'},@{hf='su-35.glb';local='su35.glb'},@{hf='su-57.glb';local='su57.glb'},@{hf='su-57b.glb';local='su57b.glb'});" ^
  "foreach ($m in $map) {" ^
  "  $u=\"$base/$($m.hf)\"; $o=Join-Path $dir $m.local;" ^
  "  if ((Test-Path $o) -and ((Get-Item $o).Length -gt 1000000)) { Write-Host ('SKIP ' + $m.local); continue };" ^
  "  $tmp=Join-Path $env:TEMP ($m.local + '_' + [guid]::NewGuid() + '.glb');" ^
  "  Write-Host ('Downloading ' + $m.hf + ' ...');" ^
  "  curl.exe -L --retry 8 --retry-all-errors --connect-timeout 30 --max-time 600 -H 'User-Agent: Mozilla/5.0' -o $tmp $u;" ^
  "  if (-not (Test-Path $tmp) -or (Get-Item $tmp).Length -lt 1000000) { Write-Host ('FAIL ' + $m.local); exit 1 };" ^
  "  Move-Item -Force $tmp $o; Write-Host ('OK ' + $m.local);" ^
  "}"
if errorlevel 1 (
  echo.
  echo Download failed.
  pause
  exit /b 1
)
echo.
echo HuggingFace download complete.
echo.
echo EU/Asia/Korea fighters need Sketchfab login — run download-sketchfab-fighters.bat
echo F-14 / F/A-18 — run download-f14-fa18-models.bat
pause
