#!/usr/bin/env python3
# fix-reel-maker.py v2
# Uses exact markers found in current file

import os

path = r"C:\Users\andre\stoke\reel-maker.html"

with open(path, 'r', encoding='utf-8') as f:
    content = f.read()

# ── Replace broken intercept + createReel with clean single function ─────────

OLD_INTERCEPT = """// Intercept createReel to dispatch to video mode
const _origCreateReel = createReel;
createReel = async function() {
  if (currentMode === 'video') { await createVideoReel(); return; }
  await _origCreateReel();
};"""

NEW_INTERCEPT = "// createReel dispatches to video mode internally"

if OLD_INTERCEPT in content:
    content = content.replace(OLD_INTERCEPT, NEW_INTERCEPT)
    print("OK: removed broken intercept")
else:
    print("WARN: intercept not found (may already be removed)")

# ── Find and replace the photos createReel function ──────────────────────────
# It starts with "async function createReel()" and ends just before "// Mix audio"

START = "async function createReel() {"
END   = "// Mix audio into the rendered video using Web Audio API + MediaRecorder"

start_idx = content.find(START)
end_idx   = content.find(END)

if start_idx == -1:
    print("ERROR: Could not find createReel function start")
    exit(1)
if end_idx == -1:
    print("ERROR: Could not find Mix audio marker")
    exit(1)

print(f"Found createReel at char {start_idx}, replacement ends at {end_idx}")

NEW_CREATE_REEL = r"""async function createReel() {
  if (currentMode === 'video') { createVideoReel(); return; }
  if (reelPhotos.length === 0) { alert('Add at least 2 photos first.'); return; }

  const btn      = document.getElementById('create-btn');
  const progress = document.getElementById('render-progress');
  const bar      = document.getElementById('render-bar');
  const label    = document.getElementById('render-label');

  btn.disabled = true;
  btn.innerHTML = '<span>&#9881;</span> Rendering...';
  progress.style.display = 'block';
  document.getElementById('share-panel').style.display = 'none';
  renderedBlob = null;
  bar.style.width = '5%';
  label.textContent = 'Loading photos...';

  // Load all images
  const imgs = await Promise.all(reelPhotos.map(p => new Promise(res => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = () => res(null);
    img.src = p.dataUrl;
  })));
  const validImgs = imgs.filter(Boolean);
  if (validImgs.length === 0) {
    btn.disabled = false;
    btn.innerHTML = '<span>&#127916;</span> Create Reel';
    progress.style.display = 'none';
    alert('Could not load photos. Please try re-adding them.');
    return;
  }

  bar.style.width = '10%';
  label.textContent = 'Starting recorder...';

  const W = 1080, H = 1920, fps = 24;
  const offCanvas = document.createElement('canvas');
  offCanvas.width = W; offCanvas.height = H;
  const ctx = offCanvas.getContext('2d');

  const caption     = (document.getElementById('reel-caption').value || '').trim();
  const spp         = Math.max(1.5, selectedDuration / validImgs.length);
  const totalFrames = Math.round(selectedDuration * fps);

  let hashtags = [];
  try { hashtags = JSON.parse(localStorage.getItem('stoke_settings') || '{}').hashtags || []; } catch(e) {}

  // Capture stream
  let stream;
  try { stream = offCanvas.captureStream(fps); }
  catch(e) {
    alert('Video recording not supported. Please use Chrome or Edge.');
    btn.disabled = false;
    btn.innerHTML = '<span>&#127916;</span> Create Reel';
    progress.style.display = 'none';
    return;
  }

  // Attach audio to stream before recording (single pass)
  if (selectedTrack) {
    try {
      const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      window._reelAudioCtx = audioCtx;
      const audioEl = new Audio();
      audioEl.crossOrigin = 'anonymous';
      audioEl.src = selectedTrack.url;
      audioEl.loop = true;
      audioEl.volume = musicVolume;
      const src  = audioCtx.createMediaElementSource(audioEl);
      const gain = audioCtx.createGain();
      gain.gain.setValueAtTime(musicVolume, 0);
      gain.gain.setValueAtTime(musicVolume, Math.max(0, selectedDuration - 2));
      gain.gain.linearRampToValueAtTime(0, selectedDuration);
      const dest = audioCtx.createMediaStreamDestination();
      src.connect(gain);
      gain.connect(dest);
      dest.stream.getAudioTracks().forEach(t => stream.addTrack(t));
      audioEl.play().catch(() => {});
      setTimeout(() => { try { audioEl.pause(); } catch(e) {} }, (selectedDuration + 1) * 1000);
    } catch(e) { console.warn('[Reel Audio]', e.message); }
  }

  // Pick best supported MIME type
  const mimeTypes = ['video/webm;codecs=vp9,opus','video/webm;codecs=vp9','video/webm;codecs=vp8','video/webm'];
  const mimeType  = mimeTypes.find(m => MediaRecorder.isTypeSupported(m)) || 'video/webm';

  const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 6000000 });
  const chunks   = [];
  recorder.ondataavailable = e => { if (e.data && e.data.size > 0) chunks.push(e.data); };
  recorder.onstop = () => {
    renderedBlob = new Blob(chunks, { type: mimeType });
    if (window._reelAudioCtx) { try { window._reelAudioCtx.close(); } catch(e) {} window._reelAudioCtx = null; }
    bar.style.width  = '100%';
    label.textContent = 'Done!';
    btn.disabled = false;
    btn.innerHTML = '<span>&#127916;</span> Create Another';
    setTimeout(() => { progress.style.display = 'none'; showSharePanel(); }, 600);
  };

  // Start recording — collect data every 200ms
  recorder.start(200);
  let frameIdx = 0;

  // setInterval is reliable for off-screen canvas (rAF gets throttled)
  const interval = setInterval(() => {
    if (frameIdx >= totalFrames) {
      clearInterval(interval);
      recorder.stop();
      return;
    }

    const elapsed       = frameIdx / fps;
    const photoIdx      = Math.min(Math.floor(elapsed / spp), validImgs.length - 1);
    const timeInPhoto   = elapsed - photoIdx * spp;
    const photoProgress = Math.min(1, timeInPhoto / spp);
    const img = validImgs[photoIdx];

    ctx.clearRect(0, 0, W, H);

    // Ken Burns motion per vibe
    let scale = 1, tx = 0, ty = 0;
    if (selectedVibe === 'energy') {
      scale = 1 + photoProgress * 0.08;
      tx = (photoIdx % 2 === 0) ? photoProgress * 40 : -photoProgress * 40;
    } else if (selectedVibe === 'showcase') {
      scale = 1.1 - photoProgress * 0.04;
      tx = -50 + photoProgress * 100;
    } else {
      scale = 1.05;
      ty = photoProgress * -50;
    }

    // Crossfade between photos
    if (photoIdx > 0 && timeInPhoto < 0.4) {
      const fade = timeInPhoto / 0.4;
      ctx.globalAlpha = 1;
      drawCoverPhoto(ctx, validImgs[photoIdx - 1], W, H, 1.05, 0, 0);
      ctx.globalAlpha = fade;
    }
    drawCoverPhoto(ctx, img, W, H, scale, tx, ty);
    ctx.globalAlpha = 1;

    // Bottom gradient for text
    if (caption) {
      const grad = ctx.createLinearGradient(0, H * 0.5, 0, H);
      grad.addColorStop(0, 'rgba(0,0,0,0)');
      grad.addColorStop(1, 'rgba(0,0,0,0.82)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, H * 0.5, W, H * 0.5);
    }

    // Top vignette
    const topGrad = ctx.createLinearGradient(0, 0, 0, 180);
    topGrad.addColorStop(0, 'rgba(0,0,0,0.3)');
    topGrad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = topGrad;
    ctx.fillRect(0, 0, W, 180);

    // Caption
    if (caption) {
      ctx.globalAlpha = Math.min(1, timeInPhoto * 4);
      ctx.fillStyle = 'white';
      ctx.font = (selectedVibe === 'energy' ? '500 68px' : '500 60px') + ' "DM Serif Display", Georgia, serif';
      ctx.textAlign = 'left';
      ctx.shadowColor = 'rgba(0,0,0,0.8)';
      ctx.shadowBlur = 24;
      wrapText(ctx, caption, 72, H - 300, W - 144, 80);
      ctx.globalAlpha = 1;
      ctx.shadowBlur = 0;
    }

    // Hashtags at end
    if (hashtags.length > 0 && elapsed > selectedDuration - 4) {
      const fade = Math.min(1, (elapsed - (selectedDuration - 4)) * 1.5);
      ctx.globalAlpha = fade * 0.75;
      ctx.fillStyle = 'white';
      ctx.font = '400 34px "DM Sans", sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(hashtags.slice(0, 5).join(' '), 72, H - 110);
      ctx.globalAlpha = 1;
    }

    // Progress dots
    validImgs.forEach((_, di) => {
      const dotX = W / 2 + (di - (validImgs.length - 1) / 2) * 28;
      ctx.beginPath();
      ctx.arc(dotX, H - 88, di === photoIdx ? 9 : 6, 0, Math.PI * 2);
      ctx.fillStyle = di === photoIdx ? 'white' : 'rgba(255,255,255,0.4)';
      ctx.fill();
    });

    frameIdx++;
    const pct = 10 + Math.round((frameIdx / totalFrames) * 86);
    bar.style.width    = pct + '%';
    label.textContent  = 'Rendering... ' + Math.round((frameIdx / totalFrames) * 100) + '%';

  }, Math.round(1000 / fps));
}

"""

content = content[:start_idx] + NEW_CREATE_REEL + content[end_idx:]

with open(path, 'w', encoding='utf-8') as f:
    f.write(content)

print("OK: createReel replaced with setInterval renderer")
print("    - setInterval instead of requestAnimationFrame (no throttle)")
print("    - single-pass audio injection")
print("    - dispatches to createVideoReel internally")
print("    - removed broken intercept")
print("\nDeploy:")
print("  git add -A && git commit -m 'Reel maker setInterval fix' && git push origin main")
print("  npx wrangler@3.99.0 pages deploy . --project-name=stoke --commit-dirty=true")
