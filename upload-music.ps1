# upload-music.ps1
# Run from C:\Users\andre\stoke
# Uploads all 8 tracks to R2 and prints the final URLs

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
    $src = "C:\Users\andre\Downloads\$($t.file)"
    if (Test-Path $src) {
        Write-Host "Uploading $($t.key)..." -ForegroundColor Cyan
        npx wrangler r2 object put "stoke-photos/$($t.key)" --file="$src" --content-type="audio/mpeg"
    } else {
        Write-Host "NOT FOUND: $src" -ForegroundColor Red
    }
}

Write-Host "`nAll uploads complete!" -ForegroundColor Green
Write-Host "Next: run update-music-urls.ps1 to get the public URLs"
