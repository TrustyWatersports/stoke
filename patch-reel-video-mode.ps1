# patch-reel-video-mode.ps1
# Adds video upload mode to reel-maker.html
# Run from C:\Users\andre\stoke

$file = "C:\Users\andre\stoke\reel-maker.html"
$content = [System.IO.File]::ReadAllText($file, [System.Text.Encoding]::UTF8)

# ── 1. Update subtitle
$content = $content.Replace(
    'Drop your photos. Pick a vibe. Download a reel ready for TikTok, Instagram, and YouTube Shorts.',
    'Photos or video &#8594; add music &#8594; share to TikTok, Instagram &amp; YouTube Shorts.'
)

# ── 2. Add mode toggle before <div class="reel-layout">
$modeToggleHTML = @'

  <!-- Mode toggle -->
  <div class="mode-toggle">
    <button class="mode-btn active" id="mode-photos" onclick="setMode('photos')">&#128247; Photos &#8594; Reel</button>
    <button class="mode-btn" id="mode-video" onclick="setMode('video')">&#127910; Video &#8594; Reel</button>
  </div>

'@
$content = $content.Replace(
    '  <div class="reel-layout">',
    $modeToggleHTML + '  <div class="reel-layout">'
)

# ── 3. Wrap photos step and add video step after it
$photosStepOld = '      <!-- Step 1: Photos -->
      <div style="margin-bottom:1.5rem">
        <div class="field-label" style="margin-bottom:8px">1 &nbsp;&#8594;&nbsp; Add your photos <span style="color:var(--text-3);font-weight:400">(2&#x2013;8 photos)</span></div>'

$photosStepNew = '      <!-- Step 1: Photos (photo mode) -->
      <div id="photos-step">
      <div style="margin-bottom:1.5rem">
        <div class="field-label" style="margin-bottom:8px">1 &nbsp;&#8594;&nbsp; Add your photos <span style="color:var(--text-3);font-weight:400">(2&#x2013;8 photos)</span></div>'

# Use exact string from file
$content = $content.Replace(
    "      <!-- Step 1: Photos -->`r`n      <div style=`"margin-bottom:1.5rem`">",
    "      <!-- Step 1: Photos (photo mode) -->`r`n      <div id=`"photos-step`">`r`n      <div style=`"margin-bottom:1.5rem`">"
)
$content = $content.Replace(
    "      <!-- Step 1: Photos -->`n      <div style=`"margin-bottom:1.5rem`">",
    "      <!-- Step 1: Photos (photo mode) -->`n      <div id=`"photos-step`">`n      <div style=`"margin-bottom:1.5rem`">"
)

# Close the photos-step div before Step 2, and insert video step
$videoStepHTML = @'
      </div><!-- /photos-step -->

      <!-- Step 1: Video (video mode) -->
      <div id="video-step" style="display:none;margin-bottom:1.5rem">
        <div class="field-label" style="margin-bottom:8px">1 &nbsp;&#8594;&nbsp; Add your video <span style="color:var(--text-3);font-weight:400">(MP4, MOV, up to 500MB)</span></div>
        <div class="video-drop-zone" id="video-drop-zone" onclick="document.getElementById('video-file-input').click()">
          <input type="file" id="video-file-input" accept="video/*" style="display:none" onchange="handleVideoUpload(this)">
          <div id="video-drop-inner">
            <div class="drop-icon">&#127910;</div>
            <div class="drop-label">Tap to add a video, or drag and drop</div>
            <div class="drop-sub">MP4, MOV, AVI &mdash; filmed vertically works best</div>
          </div>
          <div id="video-preview-container" style="display:none">
            <div class="video-preview-wrap">
              <video id="video-preview-el" controls playsinline muted></video>
              <button class="video-remove-btn" onclick="removeVideo(event)">&#x2715;</button>
            </div>
            <div class="video-meta" id="video-meta"></div>
          </div>
        </div>
      </div>

'@
$content = $content.Replace(
    "`r`n      <!-- Step 2: Vibe -->",
    $videoStepHTML + "`r`n      <!-- Step 2: Vibe -->"
)
$content = $content.Replace(
    "`n      <!-- Step 2: Vibe -->",
    $videoStepHTML + "`n      <!-- Step 2: Vibe -->"
)

# ── 4. Add setMode + video JS functions before the PHOTOS section
$videoJS = @'

// ── MODE TOGGLE ───────────────────────────────────────────────
let currentMode = 'photos';
let uploadedVideo = null; // { file, url, duration }

function setMode(mode) {
  currentMode = mode;
  document.getElementById('mode-photos').classList.toggle('active', mode === 'photos');
  document.getElementById('mode-video').classList.toggle('active', mode === 'video');

  const photosStep = document.getElementById('photos-step');
  const videoStep  = document.getElementById('video-step');
  const vibeSection = document.querySelector('[data-step="vibe"]');

  if (photosStep) photosStep.style.display = mode === 'photos' ? 'block' : 'none';
  if (videoStep)  videoStep.style.display  = mode === 'video'  ? 'block' : 'none';

  // Hide vibe selector in video mode (not needed)
  const vibeEl = document.getElementById('vibe-section');
  if (vibeEl) vibeEl.style.display = mode === 'photos' ? 'block' : 'none';

  // Reset share panel and canvas
  document.getElementById('share-panel').style.display = 'none';
  renderedBlob = null;
  cancelAnimationFrame(previewAnimFrame);
  drawEmptyPreview();

  // Update create button label
  document.getElementById('create-btn').innerHTML =
    mode === 'photos' ? '<span>&#127916;</span> Create Reel' : '<span>&#127916;</span> Add Music &amp; Export';
}

// ── VIDEO UPLOAD ──────────────────────────────────────────────
function handleVideoUpload(input) {
  const file = input.files[0];
  if (!file) return;
  if (file.size > 500 * 1024 * 1024) {
    alert('Video is larger than 500MB. Please trim it first.');
    return;
  }

  const url = URL.createObjectURL(file);
  const videoEl = document.getElementById('video-preview-el');
  videoEl.src = url;
  videoEl.onloadedmetadata = () => {
    const dur = Math.round(videoEl.duration);
    const mb  = (file.size / 1024 / 1024).toFixed(1);
    document.getElementById('video-meta').textContent =
      `${dur}s \u00b7 ${mb} MB \u00b7 ${file.name}`;
    uploadedVideo = { file, url, duration: videoEl.duration };

    // Auto-set duration to match video length
    const durBtns = document.querySelectorAll('[data-dur]');
    durBtns.forEach(b => b.classList.remove('selected'));
    if (dur <= 15) { document.querySelector('[data-dur="15"]')?.classList.add('selected'); selectedDuration = 15; }
    else if (dur <= 30) { document.querySelector('[data-dur="30"]')?.classList.add('selected'); selectedDuration = 30; }
    else { document.querySelector('[data-dur="60"]')?.classList.add('selected'); selectedDuration = 60; }
  };

  document.getElementById('video-drop-inner').style.display = 'none';
  document.getElementById('video-preview-container').style.display = 'block';
  document.getElementById('video-drop-zone').classList.add('has-video');
  input.value = '';
}

function removeVideo(e) {
  e.stopPropagation();
  if (uploadedVideo) { URL.revokeObjectURL(uploadedVideo.url); uploadedVideo = null; }
  document.getElementById('video-preview-el').src = '';
  document.getElementById('video-drop-inner').style.display = 'block';
  document.getElementById('video-preview-container').style.display = 'none';
  document.getElementById('video-drop-zone').classList.remove('has-video');
  document.getElementById('video-meta').textContent = '';
}

// Video drop-and-drop from desktop
(function setupVideoDrop() {
  // Wait for DOM
  setTimeout(() => {
    const vdz = document.getElementById('video-drop-zone');
    if (!vdz) return;
    vdz.addEventListener('dragover', e => { e.preventDefault(); vdz.classList.add('drag-over'); });
    vdz.addEventListener('dragleave', () => vdz.classList.remove('drag-over'));
    vdz.addEventListener('drop', e => {
      e.preventDefault(); vdz.classList.remove('drag-over');
      const file = e.dataTransfer.files[0];
      if (file && file.type.startsWith('video/')) {
        handleVideoUpload({ files: [file], value: '' });
      }
    });
  }, 500);
})();

// ── VIDEO REEL CREATION ───────────────────────────────────────
async function createVideoReel() {
  if (!uploadedVideo) { alert('Please add a video first.'); return; }

  const btn = document.getElementById('create-btn');
  const progress = document.getElementById('render-progress');
  const bar = document.getElementById('render-bar');
  const label = document.getElementById('render-label');

  btn.disabled = true;
  btn.innerHTML = '<span>&#9881;</span> Processing...';
  progress.style.display = 'block';
  renderedBlob = null;

  label.textContent = 'Loading video...';
  bar.style.width = '10%';

  const caption = document.getElementById('reel-caption')?.value?.trim() || '';
  let hashtags = [];
  try { hashtags = JSON.parse(localStorage.getItem('stoke_settings') || '{}').hashtags || []; } catch(e) {}

  // Create offscreen canvas at 1080x1920
  const W = 1080, H = 1920;
  const offCanvas = document.createElement('canvas');
  offCanvas.width = W; offCanvas.height = H;
  const ctx = offCanvas.getContext('2d');

  // Create video element to draw from
  const videoEl = document.createElement('video');
  videoEl.src = uploadedVideo.url;
  videoEl.muted = true;
  videoEl.playsInline = true;
  await new Promise(r => { videoEl.oncanplay = r; videoEl.load(); });

  bar.style.width = '20%';
  label.textContent = 'Setting up export...';

  const fps = 30;
  const duration = Math.min(uploadedVideo.duration, selectedDuration);
  const stream = offCanvas.captureStream(fps);

  const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
    ? 'video/webm;codecs=vp9' : 'video/webm';
  const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 8000000 });
  const chunks = [];
  recorder.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };

  recorder.onstop = async () => {
    const videoBlob = new Blob(chunks, { type: mimeType });
    if (selectedTrack) {
      label.textContent = 'Adding music...';
      bar.style.width = '90%';
      try {
        renderedBlob = await mixAudioIntoVideo(videoBlob, selectedTrack, duration);
      } catch(e) { renderedBlob = videoBlob; }
    } else {
      renderedBlob = videoBlob;
    }
    bar.style.width = '100%';
    label.textContent = 'Done!';
    btn.disabled = false;
    btn.innerHTML = '<span>&#127916;</span> Export Again';
    setTimeout(() => { progress.style.display = 'none'; showSharePanel(); }, 800);
  };

  recorder.start();
  videoEl.currentTime = 0;
  await videoEl.play();

  function drawVideoFrame() {
    if (videoEl.currentTime >= duration || videoEl.ended) {
      videoEl.pause();
      recorder.stop();
      return;
    }

    ctx.clearRect(0, 0, W, H);

    // Draw video cover-fit (letterbox/pillarbox to 9:16)
    const vw = videoEl.videoWidth || W;
    const vh = videoEl.videoHeight || H;
    const videoAspect = vw / vh;
    const frameAspect = W / H;
    let drawW, drawH, drawX, drawY;
    if (videoAspect > frameAspect) {
      // wider than frame — pillarbox (black bars top/bottom)
      drawW = W;
      drawH = W / videoAspect;
    } else {
      // taller than frame — letterbox (black bars left/right)
      drawH = H;
      drawW = H * videoAspect;
    }
    drawX = (W - drawW) / 2;
    drawY = (H - drawH) / 2;

    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);
    ctx.drawImage(videoEl, drawX, drawY, drawW, drawH);

    // Caption overlay
    if (caption) {
      const grad = ctx.createLinearGradient(0, H * 0.6, 0, H);
      grad.addColorStop(0, 'rgba(0,0,0,0)');
      grad.addColorStop(1, 'rgba(0,0,0,0.75)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, H * 0.6, W, H * 0.4);
      ctx.fillStyle = 'white';
      ctx.font = '500 64px "DM Serif Display", Georgia, serif';
      ctx.textAlign = 'left';
      ctx.shadowColor = 'rgba(0,0,0,0.7)';
      ctx.shadowBlur = 24;
      wrapText(ctx, caption, 80, H - 280, W - 160, 84);
      ctx.shadowBlur = 0;
    }

    // Hashtags at end
    if (hashtags.length > 0 && videoEl.currentTime > duration - 4) {
      const fade = Math.min(1, (videoEl.currentTime - (duration - 4)) * 2);
      ctx.globalAlpha = fade * 0.7;
      ctx.fillStyle = 'white';
      ctx.font = '400 36px "DM Sans", sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(hashtags.slice(0,5).join(' '), 80, H - 100);
      ctx.globalAlpha = 1;
    }

    const pct = 20 + Math.round((videoEl.currentTime / duration) * 65);
    bar.style.width = pct + '%';
    label.textContent = `Processing... ${Math.round((videoEl.currentTime / duration) * 100)}%`;

    requestAnimationFrame(drawVideoFrame);
  }

  requestAnimationFrame(drawVideoFrame);
}

'@

$content = $content.Replace(
    "// ── PHOTOS ─────────────────────────────────────────────────────",
    $videoJS + "// ── PHOTOS ─────────────────────────────────────────────────────"
)

# ── 5. Make createReel() dispatch based on mode
$content = $content.Replace(
    "async function createReel() {",
    "async function createReel() {`n  if (currentMode === 'video') { await createVideoReel(); return; }"
)

# ── 6. Wrap vibe section in an ID so we can hide it in video mode
$content = $content.Replace(
    '      <!-- Step 2: Vibe -->',
    '      <!-- Step 2: Vibe -->' + "`r`n      <div id=`"vibe-section`">"
)
$content = $content.Replace(
    '      <!-- Step 2: Vibe -->',
    '      <!-- Step 2: Vibe -->' + "`n      <div id=`"vibe-section`">"
)
# Close vibe-section div before Step 3
$content = $content.Replace(
    "`r`n      <!-- Step 3: Caption -->",
    "`r`n      </div><!-- /vibe-section -->`r`n`r`n      <!-- Step 3: Caption -->"
)
$content = $content.Replace(
    "`n      <!-- Step 3: Caption -->",
    "`n      </div><!-- /vibe-section -->`n`n      <!-- Step 3: Caption -->"
)

[System.IO.File]::WriteAllText($file, $content, [System.Text.Encoding]::UTF8)
Write-Host "Done! reel-maker.html updated with video mode." -ForegroundColor Green
