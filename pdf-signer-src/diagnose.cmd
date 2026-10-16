@echo off
rem One-command self-test for DSC signing. Plug in the token first, then double-click this
rem file, or run it from a terminal:
rem     diagnose.cmd                          (picks the certificate, or asks which one)
rem     diagnose.cmd "VIREN MAHESH SHAH"      (a specific certificate)
rem     diagnose.cmd "VIREN MAHESH SHAH" --pin  (type the PIN here instead of in the token's dialog)
rem It signs a test PDF the same way the app does and writes logs\diagnose-*.log: send that file.
cd /d "%~dp0"
pdf-signer.exe --diagnose %*
set RESULT=%ERRORLEVEL%
echo.
if not "%RESULT%"=="0" echo The log file named above is the one to send.
pause
exit /b %RESULT%
