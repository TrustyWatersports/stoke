@echo off
echo.
echo  =====================================
echo   Stoke Deploy
echo  =====================================
cd /d C:\Users\andre\stoke

echo  [1/3] Committing changes...
git add -A
git commit -m "Deploy %date% %time%" 2>nul || echo  (nothing new to commit)

echo  [2/3] Pushing to GitHub...
git push origin main

echo  [3/3] Deploying to Cloudflare Pages...
wrangler pages deploy . --project-name=stoke --commit-dirty=true

echo.
echo  =====================================
echo   Live at: https://stoke-1jn.pages.dev
echo  =====================================
pause
