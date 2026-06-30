@echo off
chcp 65001 >nul
echo ====================================================
echo  F-14 Tomcat GLB downloader (Sketchfab)
echo ====================================================
echo.
echo  F-14 is NOT in the HuggingFace pack (unlike F-15/F-16/F-22).
echo  Download manually from Sketchfab (free account, CC-BY license).
echo.
echo  Steps:
echo   1) Browser opens the F-14 Gear UP model page.
echo   2) Click  Download 3D Model  ^>  glTF Binary (.glb)
echo   3) Save / rename the file as:
echo.
echo       %~dp0f14.glb
echo.
echo  Tip: Use "Gear UP" variant (landing gear retracted).
echo       The game hides gear parts automatically if present.
echo.
start "" "https://sketchfab.com/3d-models/f-14-tomcat-top-gun-gear-up-downloadable-9d2d0c87539046aa8c2198fcc47cdcf8#download"
pause
