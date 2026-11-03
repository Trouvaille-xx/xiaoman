@echo off
setlocal
rem Gradle 8 + JDK 17 on Windows may fail with "Unable to establish loopback connection"
rem because the JDK uses AF_UNIX pipes under the temp directory. A short ASCII temp
rem directory avoids the issue. This wrapper keeps builds reproducible on this machine.
if not exist "C:\Temp" mkdir "C:\Temp"
set "TEMP=C:\Temp"
set "TMP=C:\Temp"
set "JAVA_TOOL_OPTIONS=-Djava.io.tmpdir=C:/Temp"
call "%~dp0gradlew.bat" %*
exit /b %ERRORLEVEL%
