# update-headers.ps1
# Replaces the header on every Stoke page with the new clean unified header
# Run from C:\Users\andre\stoke

$pages = @(
  @{ file="dashboard.html";   active="dashboard"; wide=$true },
  @{ file="index.html";       active="generator"; wide=$false },
  @{ file="calendar.html";    active="calendar";  wide=$true },
  @{ file="invoices.html";    active="invoices";  wide=$true },
  @{ file="reel-maker.html";  active="reels";     wide=$false },
  @{ file="schedule.html";    active="posts";     wide=$false },
  @{ file="settings.html";    active="settings";  wide=$false },
  @{ file="voice-wizard.html";active="";          wide=$false }
)

# The new unified header template
# Uses header-home (logo+wordmark) as home link, header-nav for tools
function Get-Header($active, $wide) {
  $wideClass = if ($wide) { " app-wide" } else { "" }

  $nav = @(
    @{ href="dashboard.html"; icon="🏠"; label="Home";     key="dashboard" },
    @{ href="index.html";     icon="✍";  label="Generate"; key="generator" },
    @{ href="schedule.html";  icon="📅"; label="Posts";    key="posts" },
    @{ href="reel-maker.html";icon="🎬"; label="Reels";    key="reels" },
    @{ href="calendar.html";  icon="📆"; label="Calendar"; key="calendar" },
    @{ href="invoices.html";  icon="🧾"; label="Invoices"; key="invoices" }
  )

  $navHTML = ($nav | ForEach-Object {
    $activeClass = if ($_.key -eq $active) { " active" } else { "" }
    "      <a href=`"$($_.href)`" class=`"nav-pill$activeClass`">$($_.icon) $($_.label)</a>"
  }) -join "`n"

  return @"
  <div class="header">
    <a href="dashboard.html" class="header-home">
      <div class="logo"><svg viewBox="0 0 20 20" fill="none" width="20" height="20"><path d="M10 2C10 2 4 8 4 12a6 6 0 0012 0c0-4-6-10-6-10z" fill="white" opacity=".95"/><path d="M10 8c0 0-2 3-2 5a2 2 0 004 0c0-2-2-5-2-5z" fill="white" opacity=".45"/></svg></div>
      <span class="wordmark">Stoke</span>
    </a>
    <div class="header-divider"></div>
    <nav class="header-nav">
$navHTML
      <div style="width:1px;height:16px;background:var(--border-2);margin:0 2px;flex-shrink:0"></div>
      <a href="settings.html" class="nav-pill-icon" title="Settings">&#9881;</a>
      <a href="voice-wizard.html" class="nav-pill-icon" title="Voice Profile">&#10024;</a>
      <span id="auth-indicator" class="auth-badge" style="display:none"></span>
    </nav>
  </div>
"@
}

# Regex pattern to match the old header block
# Matches from <div class="header"> to the closing </div>
# We use a simple approach: find the first <div class="header"> and replace until its matching close

foreach ($page in $pages) {
  $filePath = "C:\Users\andre\stoke\$($page.file)"
  if (-not (Test-Path $filePath)) {
    Write-Host "SKIP (not found): $($page.file)" -ForegroundColor Yellow
    continue
  }

  $content = [System.IO.File]::ReadAllText($filePath, [System.Text.Encoding]::UTF8)

  # Update .app div to add wide class if needed
  if ($page.wide) {
    $content = $content -replace '<div class="app">', '<div class="app app-wide">'
  }

  # Build new header
  $newHeader = Get-Header $page.active $page.wide

  # Replace old header block using a pattern
  # Find <div class="header"> ... </div> (the header div)
  # We target the specific pattern we know exists across all pages
  $oldPatterns = @(
    # dashboard.html style
    '(?s)  <div class="header">.*?</div>\s*\n\s*(?=  <!-- |  <div class="greeting|  <div style="margin-bottom:1\.5rem|  <div style="display:flex|  <!-- Mode|  <div class="reel-layout|  <div class="cal-shell|  <div class="invoice-layout|  <div style="margin-bottom:1rem|  <div class="dash-grid|  <!-- Page header)'
  )

  $replaced = $false
  foreach ($pattern in $oldPatterns) {
    if ($content -match $pattern) {
      $content = $content -replace $pattern, "$newHeader`n"
      $replaced = $true
      break
    }
  }

  if (-not $replaced) {
    Write-Host "WARNING: Could not find header pattern in $($page.file) - skipping" -ForegroundColor Red
    continue
  }

  [System.IO.File]::WriteAllText($filePath, $content, [System.Text.Encoding]::UTF8)
  Write-Host "Updated: $($page.file)" -ForegroundColor Green
}

Write-Host "`nAll headers updated!" -ForegroundColor Cyan
Write-Host "Now deploy: npx wrangler@3.99.0 pages deploy . --project-name=stoke --commit-dirty=true"
