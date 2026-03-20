# patch-reel-maker.ps1
# Adds video mode support to reel-maker.html

$file = "C:\Users\andre\stoke\reel-maker.html"
$content = Get-Content $file -Raw -Encoding UTF8

# 1. Update subtitle
$content = $content -replace 'Drop your photos\. Pick a vibe\. Download a reel ready for TikTok, Instagram, and YouTube Shorts\.', 'Photos or video &rarr; add music &rarr; share to TikTok, Instagram, and YouTube Shorts.'

# 2. Add mode toggle after page header div
$modeToggle = @'

  <!-- Mode toggle -->
  <div class="mode-toggle">
    <button class="mode-btn active" id="mode-photos" onclick="setMode('photos')">&#128247; Photos &rarr; Reel</button>
    <button class="mode-btn" id="mode-video" onclick="setMode('video')">&#127910; Video &rarr; Reel</button>
  </div>

'@
$content = $content -replace '(<div class="reel-layout">)', ($modeToggle + '$1')

# 3. Wrap the photos step in a div with id
$content = $content -replace '(      <!-- Step 1: Photos -->)', '      <!-- Step 1: Photos (photo mode) -->' + "`n      <div id=`"photos-step`" style=`"margin-bottom:0`">"
$content = $content -replace "(        <div id=`"photo-hint`"[^>]+>[^<]+</div>)`n`n      <!-- Step 2", '$1' + "`n      </div>`n`n      <!-- Step 1 Video (video mode) -->`n      <div id=`"video-step`" style=`"display:none;margin-bottom:1.5rem`">`n        <div class=`"field-label`" style=`"margin-bottom:8px`">1 &nbsp;&amp;#8594;&amp;nbsp; Add your video <span style=`"color:var(--text-3);font-weight:400`">(MP4, MOV, up to 500MB)</span></div>`n        <div class=`"video-drop-zone`" id=`"video-drop-zone`" onclick=`"document.getElementById('video-file-input').click()`">`n          <input type=`"file`" id=`"video-file-input`" accept=`"video/*`" style=`"display:none`" onchange=`"handleVideoUpload(this)`">`n          <div id=`"video-drop-inner`">`n            <div class=`"drop-icon`">&#127910;</div>`n            <div class=`"drop-label`">Tap to add a video, or drag and drop</div>`n            <div class=`"drop-sub`">MP4, MOV, AVI &mdash; filmed vertically works best</div>`n          </div>`n          <div id=`"video-preview-container`" style=`"display:none`">`n            <div class=`"video-preview-wrap`">`n              <video id=`"video-preview-el`" controls playsinline muted></video>`n              <button class=`"video-remove-btn`" onclick=`"removeVideo(event)`">&#x2715;</button>`n            </div>`n            <div class=`"video-meta`" id=`"video-meta`"></div>`n          </div>`n        </div>`n      </div>`n`n      <!-- Step 2")

Set-Content $file -Value $content -Encoding UTF8 -NoNewline
Write-Host "Phase 1 done" -ForegroundColor Green
