@echo off
REM ============================================
REM Script untuk setting repo ke akunB (pribadi)
REM Author: Rochiyat
REM ============================================

SET REPO_PATH=D:\PROJECT\MYSELF\CODE\GITHUB\TOOLS\drive-sync-bun-production
SET GIT_USER_NAME="Rochiyat"
SET GIT_USER_EMAIL="rochiyat@gmail.com"
SET GITHUB_USER=rochiyat
SET REPO_NAME=google-drive-sync-bun

echo.
echo 🚀 Mengatur repo %REPO_NAME% di folder %REPO_PATH% untuk rochiyat (%GIT_USER_EMAIL%)...
echo.

cd %REPO_PATH%

REM Set user config khusus repo ini
git config user.name %GIT_USER_NAME%
git config user.email %GIT_USER_EMAIL%

REM Atur remote agar pakai SSH host github-rochiyat
git remote set-url origin git@github-rochiyat:%GITHUB_USER%/%REPO_NAME%.git

REM Tampilkan hasil konfigurasi
echo.
echo ✅ Konfigurasi selesai. Cek hasil:
git config user.name
git config user.email
git remote -v

pause
