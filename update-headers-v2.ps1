# update-headers-v2.ps1
# Precisely updates headers on all Stoke pages
# Run from C:\Users\andre\stoke

Set-Location "C:\Users\andre\stoke"

# Standard new header — logo is home link, clean nav
function New-Header($active) {
  $items = @(
    @("dashboard.html",  "🏠", "Home"),
    @("index.html",      "✍",  "Generate"),
    @("schedule.html",   "📅", "Posts"),
    @("reel-maker.html", "🎬", "Reels"),
    @("calendar.html",   "📆", "Calendar"),
    @("invoices.html",   "🧾", "Invoices")
  )
  $navPills = $items | ForEach-Object {
    $href = $_[0]; $icon = $_[1]; $label = $_[2]
    $cls = if ($href -like "*$active*") { ' class="nav-pill active"' } else { ' class="nav-pill"' }
    "      <a href=`"$href`"$cls>$icon $label</a>"
  }
  $navStr = $navPills -join "`n"

@"
  <div class="header">
    <a href="dashboard.html" class="header-home">
      <div class="logo"><svg viewBox="0 0 20 20" fill="none" width="20" height="20"><path d="M10 2C10 2 4 8 4 12a6 6 0 0012 0c0-4-6-10-6-10z" fill="white" opacity=".95"/><path d="M10 8c0 0-2 3-2 5a2 2 0 004 0c0-2-2-5-2-5z" fill="white" opacity=".45"/></svg></div>
      <span class="wordmark">Stoke</span>
    </a>
    <div class="header-divider"></div>
    <nav class="header-nav">
$navStr
      <div style="width:1px;height:16px;background:var(--border-2);margin:0 2px;flex-shrink:0"></div>
      <a href="settings.html" class="nav-pill-icon" title="Settings">&#9881;</a>
      <a href="voice-wizard.html" class="nav-pill-icon" title="Voice Profile">&#10024;</a>
      <span id="auth-indicator" class="auth-badge" style="display:none"></span>
    </nav>
  </div>
"@
}

# Per-page config: filename, active key, add app-wide class?
$pages = @(
  @{ f="dashboard.html";   a="dashboard";   wide=$true  },
  @{ f="index.html";       a="index";        wide=$false },
  @{ f="calendar.html";    a="calendar";     wide=$true  },
  @{ f="invoices.html";    a="invoices";     wide=$true  },
  @{ f="reel-maker.html";  a="reel-maker";   wide=$false },
  @{ f="schedule.html";    a="schedule";     wide=$false },
  @{ f="settings.html";    a="settings";     wide=$false },
  @{ f="voice-wizard.html";a="voice-wizard"; wide=$false }
)

foreach ($p in $pages) {
  $path = $p.f
  if (-not (Test-Path $path)) { Write-Host "SKIP: $path" -ForegroundColor Yellow; continue }

  $raw = [System.IO.File]::ReadAllText($path, [System.Text.Encoding]::UTF8)
  $newHeader = New-Header $p.a

  # Find start of header div
  $startToken = '  <div class="header">'
  $startIdx = $raw.IndexOf($startToken)
  if ($startIdx -lt 0) { Write-Host "No header found: $path" -ForegroundColor Red; continue }

  # Find matching closing </div> by counting depth
  $depth = 0; $i = $startIdx; $endIdx = -1
  while ($i -lt $raw.Length - 5) {
    if ($raw.Substring($i, [Math]::Min(5,$raw.Length-$i)) -like '<div*') { $depth++ }
    if ($raw.Substring($i, [Math]::Min(6,$raw.Length-$i)) -eq '</div>') {
      $depth--
      if ($depth -eq 0) { $endIdx = $i + 6; break }
    }
    $i++
  }

  if ($endIdx -lt 0) { Write-Host "Could not find end of header: $path" -ForegroundColor Red; continue }

  # Replace
  $newContent = $raw.Substring(0, $startIdx) + $newHeader + $raw.Substring($endIdx)

  # Add app-wide class if needed
  if ($p.wide -and $newContent -notlike '*class="app app-wide"*') {
    $newContent = $newContent -replace 'class="app"', 'class="app app-wide"'
  }

  [System.IO.File]::WriteAllText($path, $newContent, [System.Text.Encoding]::UTF8)
  Write-Host "OK: $path" -ForegroundColor Green
}

Write-Host "`nDone. Deploy:" -ForegroundColor Cyan
Write-Host "npx wrangler@3.99.0 pages deploy . --project-name=stoke --commit-dirty=true"
