@echo off
chcp 65001 >nul
rem ============================================================
rem  打包"免安装 Node"离线发布包
rem  1) 编译GUI exe
rem  2) 确保存在 node\node.exe（有现成zip则自动解压，否则提示手动放置）
rem  3) 打包成 zip
rem  注意：本bat须以 CRLF 换行保存
rem ============================================================
setlocal
set "ROOT=%~dp0"
set "OUT_ZIP=%ROOT%高校考试网学习助手-离线版-v1.0.0.zip"

echo ==== 1/3  编译GUI exe ====
call "%ROOT%build.bat"
if not exist "%ROOT%高校考试助手.exe" (
  echo [错误] exe 编译失败，请检查 csc.exe 是否存在。
  pause
  exit /b 1
)

echo ==== 2/3  准备离线Node ====
if exist "%ROOT%node\node.exe" (
  echo 已找到 node\node.exe，跳过。
) else (
  echo 未找到 node\node.exe，尝试从项目里的 node-*-win-x64.zip 解压 ...
  set "ZIP="
  for %%f in ("%ROOT%node-v*-win-x64.zip") do set "ZIP=%%~ff"
  if defined ZIP (
    if not exist "%ROOT%node" mkdir "%ROOT%node"
    powershell -NoProfile -ExecutionPolicy Bypass -Command "Expand-Archive -Path '%ZIP%' -DestinationPath '%ROOT%_nodex' -Force"
    copy /y "%ROOT%_nodex\node-v*-win-x64\node.exe" "%ROOT%node\node.exe" >nul
    rmdir /s /q "%ROOT%_nodex"
  ) else (
    echo.
    echo [提示] 需要手动放置 node.exe，任选一种：
    echo   方法A：从 https://npmmirror.com/mirrors/node/v22.12.0/ 下载
    echo         node-v22.12.0-win-x64.zip，解压后把 node.exe 放到：
    echo         %ROOT%node\node.exe
    echo   方法B：直接下载 node.exe（单个文件）放到这个路径。
    echo 放好后重新运行本脚本即可。
    echo.
    pause
    exit /b 1
  )
  if not exist "%ROOT%node\node.exe" (
    echo [错误] 仍未找到 node.exe，请按上方提示手动放置。
    pause
    exit /b 1
  )
)

echo ==== 3/3  组装并打包 ====
set "STAGE=%ROOT%_release_setup2\gaoxiaokaoshi-assistant"
if exist "%ROOT%_release_setup2" rmdir /s /q "%ROOT%_release_setup2"
mkdir "%STAGE%\lib" 2>nul
mkdir "%STAGE%\node" 2>nul

copy "%ROOT%高校考试助手.exe" "%STAGE%\" >nul
copy "%ROOT%main.mjs" "%STAGE%\" >nul
copy "%ROOT%README.md" "%STAGE%\" >nul
copy "%ROOT%LICENSE" "%STAGE%\" >nul
copy "%ROOT%lib\*.mjs" "%STAGE%\lib\" >nul
copy "%ROOT%node\node.exe" "%STAGE%\node\" >nul

powershell -NoProfile -ExecutionPolicy Bypass -Command "Compress-Archive -Path '%ROOT%_release_setup2\*' -DestinationPath '%OUT_ZIP%' -CompressionLevel Optimal"
rmdir /s /q "%ROOT%_release_setup2"

echo.
echo ============================================================
echo 完成：%OUT_ZIP%
echo 解压到任意Win10/11即可运行（无需安装Node，浏览器用系统自带Edge）。
echo ============================================================
pause
