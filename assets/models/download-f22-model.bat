@echo off
chcp 65001 >nul
echo ====================================================
echo  F-22 Raptor GLB downloader (Sketchfab manual)
echo ====================================================
echo.
echo  1) Sketchfab page will open in your browser.
echo  2) Click  Download 3D Model  ^>  glTF (.glb)
echo  3) Save the file as  f22.glb  into:
echo.
echo       %~dp0f22.glb
echo.
echo  4) Refresh the game page. The GLB will auto-load.
echo.
echo  (Tip) Look for free CC-BY F-22 models like:
echo       - "F-22 Raptor"  by various authors
echo       - filter: Downloadable + glTF
echo.
start "" "https://sketchfab.com/search?features=downloadable&q=f-22+raptor&type=models"
pause
