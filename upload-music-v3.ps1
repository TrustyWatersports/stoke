# upload-music-v3.ps1
# Correct wrangler syntax for R2 uploads to remote bucket

Set-Location "C:\Users\andre\stoke"

$bucket = "stoke-photos"
$downloads = "C:\Users\andre\Downloads"

$tracks = @(
    @{ file = "aberrantrealities-organic-flow-1015-remastered-485950.mp3"; key = "music/organic-flow.mp3" },
    @{ file = "alexgrohl-motivation-sport-rock-trailer-478796.mp3";        key = "music/sport-rock-trailer.mp3" },
    @{ file = "kornevmusic-upbeat-happy-corporate-487426.mp3";             key = "music/upbeat-corporate.mp3" },
    @{ file = "alexgrohl-energetic-action-sport-500409.mp3";               key = "music/energetic-action.mp3" },
    @{ file = "nveravetyanmusic-stylish-deep-electronic-262632.mp3";       key = "music/stylish-electronic.mp3" },
    @{ file = "alex_makemusic-gorila-315977.mp3";                          key = "music/gorila.mp3" },
    @{ file = "alex_makemusic-running-night-393139.mp3";                   key = "music/running-night.mp3" },
    @{ file = "bransboynd-fresh-457883.mp3";                               key = "music/fresh.mp3" }
)

foreach ($t in $tracks) {
    $src = Join-Path $downloads $t.file
    $r2path = "$bucket/$($t.key)"

    if (Test-Path $src) {
        Write-Host "Uploading $($t.key)..." -ForegroundColor Cyan
        # Note: no --remote flag, wrangler reads from wrangler.toml which has the binding
        # Use the full object path: bucket/key
        $result = & npx wrangler r2 object put $r2path --file=$src --content-type="audio/mpeg" 2>&1
        Write-Host $result
        if ($LASTEXITCODE -eq 0) {
            Write-Host "OK: $($t.key)" -ForegroundColor Green
        } else {
            Write-Host "FAILED: $($t.key)" -ForegroundColor Red
        }
    } else {
        Write-Host "NOT FOUND: $src" -ForegroundColor Red
    }
}

Write-Host "`nDone! Verify with:" -ForegroundColor Yellow
Write-Host "npx wrangler r2 object get stoke-photos/music/organic-flow.mp3 --file=test.mp3" -ForegroundColor Yellow
