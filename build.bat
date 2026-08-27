@echo off
chcp 65001 >nul
rem 一键编译 高校考试助手.exe（用 .NET Framework 自带 C# 编译器，无需联网）
rem 注意：本bat须以 CRLF 换行保存
setlocal
set "CSC=C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe"
if not exist "%CSC%" set "CSC=C:\Windows\Microsoft.NET\Framework\v4.0.30319\csc.exe"
if not exist "%CSC%" set "CSC=C:\Windows\Microsoft.NET\Framework\v4.0.30319\csc.exe"
if not exist "%CSC%" (
  echo [错误] 未找到 C# 编译器 csc.exe，请安装 .NET Framework 4.x 后重试。
  pause
  exit /b 1
)
echo 正在编译高校考试助手.exe ...
"%CSC%" /nologo /target:winexe /out:"%~dp0高校考试助手.exe" /r:System.Windows.Forms.dll /r:System.Drawing.dll "%~dp0gui\Program.cs"
if %errorlevel%==0 (
  echo.
  echo 编译成功：%~dp0高校考试助手.exe
) else (
  echo.
  echo [错误] 编译失败。
)
pause
