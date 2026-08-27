@echo off
chcp 65001 >nul
rem ============================================================
rem  一键构建"免安装 Node"离线发布包
rem  1) 编译GUI exe  2) 下载可移植Node到 node\  3) 打包成zip
rem  注意：本bat须以 CRLF 换行保存（Windows cmd 要求）
rem ============================================================
setlocal
set "ROOT=%~dp0"
set "NODE_VER=v22.12.0"
set "NODE_ZIP=node-%NODE_VER%-win-x64.zip"
set "NODE_URL=https://nodejs.org/dist/%NODE_VER%/%NODE_ZIP%"
set "OUT_ZIP=%ROOT%高校考试网学习助手-离线版-v1.0.0.zip"

echo ==== 1/3  编译GUI exe ====
call "%ROOT%build.bat"
if not exist "%ROOT%高校考试助手.exe" (
  echo [错误] exe 编译失败，请检查 csc.exe 是否存在。
  pause
  exit /b 1
)

echo ==== 2/3  准备离线Node (%NODE_VER%) ====
if not exist "%ROOT%node\node.exe" (
  echo 正在下载可移植Node ...
  powershell -NoProfile -ExecutionPolicy Bypass -Command "Invoke-WebRequest -Uri '%NODE_URL%' -OutFile '%ROOT%%NODE_ZIP%'"
  if not exist "%ROOT%%NODE_ZIP%" (
    echo [错误] 下载失败：请检查网络。也可手动下载 %NODE_URL% 解压后，把 node.exe 放到 %ROOT%node\node.exe
    pause
    exit /b 1
  )
  echo 正在解压并提取 node.exe ...
  powershell -NoProfile -ExecutionPolicy Bypass -Command "Expand-Archive -Path '%ROOT%%NODE_ZIP%' -DestinationPath '%ROOT%_nodex' -Force"
  if not exist "%ROOT%node" mkdir "%ROOT%node"
  copy /y "%ROOT%_nodex\node-%NODE_VER%-win-x64\node.exe" "%ROOT%node\node.exe" >nul
  rmdir /s /q "%ROOT%_nodex"
  del "%ROOT%%NODE_ZIP%" >nul 2>&1
) else (
  echo 已存在 node\node.exe，跳过下载。
)

echo ==== 3/3  组装并打包 ====
set "STAGE=%ROOT%_release_setup2\gaoxiaokaoshi-assistant"
if exist "%ROOT%_release_setup2" rmdir /s /q "%ROOT%_release_setup2"
mkdir "%STAGE%\lib" 2>nul
mkdir "%STAGE%\tools" 2>nul
mkdir "%STAGE%\node" 2>nul

copy "%ROOT%高校考试助手.exe" "%STAGE%\" >nul
copy "%ROOT%main.mjs" "%STAGE%\" >nul
copy "%ROOT%README.md" "%STAGE%\" >nul
copy "%ROOT%LICENSE" "%STAGE%\" >nul
copy "%ROOT%lib\*.mjs" "%STAGE%\lib\" >nul
copy "%ROOT%tools\cdp.mjs" "%STAGE%\tools\" >nul
copy "%ROOT%node\node.exe" "%STAGE%\node\" >nul

powershell -NoProfile -ExecutionPolicy Bypass -Command "Compress-Archive -Path '%ROOT%_release_setup2\*' -DestinationPath '%OUT_ZIP%' -CompressionLevel Optimal"
rmdir /s /q "%ROOT%_release_setup2"

echo.
echo ============================================================
echo 完成：%OUT_ZIP%
echo 解压到任意Win10/11即可运行（无需安装Node，浏览器用系统自带Edge）。
echo ============================================================
pause
