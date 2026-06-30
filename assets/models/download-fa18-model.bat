@echo off
chcp 65001 >nul
echo ====================================================
echo  F/A-18E Super Hornet GLB downloader (Sketchfab)
echo ====================================================
echo.
echo  F/A-18 is NOT in the HuggingFace pack (unlike F-15/F-16/F-22).
echo  Download manually from Sketchfab (free account, CC-BY license).
echo.
echo  Steps:
echo   1) Browser opens the Super Hornet model page.
echo   2) Click  Download 3D Model  ^>  glTF Binary (.glb)
echo   3) Save / rename the file as:
echo.
echo       %~dp0fa18.glb
echo.
start "" "https://sketchfab.com/3d-models/boeing-fa-18ef-super-hornet-f71e9fea01e24fea9b1b380161d21d38#download"
pause
