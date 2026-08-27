@echo off
rem =====================================================================
rem  一键构建"免安装 Node"离线发布包
rem  1) 编译 GUI exe  2) 下载可移植 Node 放入 node\  3) 组装并打包成 zip
rem  生成的 zip 解压到任意 Win10/11 电脑即可运行，无需安装 Node
rem  （本脚本需联网，用于下载 Node；若已存在 node\node.exe 则跳过下载）
rem =====================================================================
setlocal enableextensions
set ROOT=%~dp0
set NODE_VER=v22.12.0
set NODE_ZIP=node-%NODE_VER%-win-x64.zip
set NODE_URL=https://nodejs.org/dist/%NODE_VER%/%NODE_ZIP%
set OUT_ZIP=%ROOT%高校考试网学习助手-离线版-v1.0.0.zip

echo ==== 1/3  编译 GUI exe ====
call "%ROOT%build.bat"
if not exist "%ROOT%高校考试助手.exe" (
  echo [错误] exe 编译失败，请检查 csc。
  pause
  exit /b 1
)

echo ==== 2/3  准备离线 Node (%NODE_VER%) ====
if not exist "%ROOT%node\node.exe" (
  echo 下载可移植 Node ...
  powershell -NoProfile -ExecutionPolicy Bypass -Command "Invoke-WebRequest -Uri '%NODE_URL%' -OutFile '%ROOT%%NODE_ZIP%'"
  if not exist "%ROOT%%NODE_ZIP%" (
    echo [错误] 下载失败：请检查网络，或手动下载 %NODE_URL% 后解压，把 node.exe 放到 %ROOT%node\node.exe
    pause
    exit /b 1
  )
  echo 解压并提取 node.exe ...
  powershell -NoProfile -ExecutionPolicy Bypass -Command "Expand-Archive -Path '%ROOT%%NODE_ZIP%' -DestinationPath '%ROOT%_nodex' -Force"
  if not exist "%ROOT%node" mkdir "%ROOT%node"
  copy /y "%ROOT%_nodex\node-%NODE_VER%-win-x64\node.exe" "%ROOT%node\node.exe" >nul
  rmdir /s /q "%ROOT%_nodex"
  del "%ROOT%%NODE_ZIP%" >nul 2>&1
) else (
  echo 已存在 node\node.exe，跳过下载
)

echo ==== 3/3  组装并打包 ====
set STAGE=%ROOT%_release_setup2\gaoxiaokaoshi-assistant
if exist "%ROOT%_release_setup2" rmdir /s /q "%ROOT%_release_setup2"
mkdir "%STAGE%\lib" 2>nul
mkdir "%STAGE%\tools" 2>nul
mkdir "%STAGE%\node" 2>nul

rem 只打包运行必需的内容（不含源码/构建脚本/探测脚本）
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
echo 该 zip 解压到任意 Win10/11 电脑即可运行（无需安装 Node；
echo 浏览器用系统自带的 Edge 即可）。
echo ============================================================
pause
