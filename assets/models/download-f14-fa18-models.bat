@echo off
chcp 65001 >nul
echo ====================================================
echo  F-14 + F/A-18 GLB download helper
echo ====================================================
echo.
echo  Both models require Sketchfab (free login).
echo  HuggingFace auto-download is NOT available for these two.
echo.
echo  This will open TWO browser tabs:
echo   1) F-14 Tomcat  -^> save as  f14.glb
echo   2) F/A-18E Hornet -^> save as  fa18.glb
echo.
echo  Save both into:
echo       %~dp0
echo.
pause
call "%~dp0download-f14-model.bat"
call "%~dp0download-fa18-model.bat"
