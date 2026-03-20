# inject-voice.ps1
# Adds voice.js script tag to every Stoke page

$pages = @(
  "C:\Users\andre\stoke\dashboard.html",
  "C:\Users\andre\stoke\index.html",
  "C:\Users\andre\stoke\calendar.html",
  "C:\Users\andre\stoke\reel-maker.html",
  "C:\Users\andre\stoke\schedule.html",
  "C:\Users\andre\stoke\settings.html",
  "C:\Users\andre\stoke\voice-wizard.html"
)

$tag = '<script src="js/voice.js"></script>'

foreach ($page in $pages) {
  $content = [System.IO.File]::ReadAllText($page, [System.Text.Encoding]::UTF8)
  if ($content -notlike "*voice.js*") {
    $content = $content.Replace('</body>', "$tag`n</body>")
    [System.IO.File]::WriteAllText($page, $content, [System.Text.Encoding]::UTF8)
    Write-Host "Added voice.js to $([System.IO.Path]::GetFileName($page))" -ForegroundColor Green
  } else {
    Write-Host "Already present in $([System.IO.Path]::GetFileName($page))" -ForegroundColor Yellow
  }
}

Write-Host "`nDone! Now deploy:" -ForegroundColor Cyan
Write-Host "npx wrangler@3.99.0 pages deploy . --project-name=stoke --commit-dirty=true" -ForegroundColor White
