#!/usr/bin/env python3
# fix-reel-caption.py — removes crossfade entirely, hard cuts, caption always visible

import os

path = r"C:\Users\andre\stoke\reel-maker.html"

with open(path, 'r', encoding='utf-8') as f:
    content = f.read()

# Find the setInterval block and replace the entire inner frame rendering
OLD = """    // Crossfade between photos — isolated with save/restore so globalAlpha never bleeds
    ctx.save();
    if (photoIdx > 0 && timeInPhoto < 0.4) {
      const fade = timeInPhoto / 0.4;
      ctx.globalAlpha = 1;
      drawCoverPhoto(ctx, validImgs[photoIdx - 1], W, H, 1.05, 0, 0);
      ctx.globalAlpha = Math.max(0.001, fade); // never fully 0
      drawCoverPhoto(ctx, img, W, H, scale, tx, ty);
    } else {
      ctx.globalAlpha = 1;
      drawCoverPhoto(ctx, img, W, H, scale, tx, ty);
    }
    ctx.restore(); // globalAlpha is guaranteed 1 after this

    // globalAlpha is now definitely 1 — safe to draw overlays

    // Bottom gradient — permanent once caption exists
    if (caption) {
      const grad = ctx.createLinearGradient(0, H * 0.5, 0, H);
      grad.addColorStop(0, 'rgba(0,0,0,0)');
      grad.addColorStop(1, 'rgba(0,0,0,0.85)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, H * 0.5, W, H * 0.5);
    }

    // Top vignette
    const topGrad = ctx.createLinearGradient(0, 0, 0, 180);
    topGrad.addColorStop(0, 'rgba(0,0,0,0.3)');
    topGrad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = topGrad;
    ctx.fillRect(0, 0, W, 180);

    // Caption — always at full opacity (fades in gently on very first frames only)
    if (caption) {
      ctx.globalAlpha = elapsed < 0.5 ? Math.min(1, elapsed * 2.5) : 1;
      ctx.fillStyle = 'white';
      ctx.font = (selectedVibe === 'energy' ? '500 68px' : '500 60px') + ' "DM Serif Display", Georgia, serif';
      ctx.textAlign = 'left';
      ctx.shadowColor = 'rgba(0,0,0,0.9)';
      ctx.shadowBlur = 28;
      wrapText(ctx, caption, 72, H - 300, W - 144, 80);
      ctx.globalAlpha = 1;
      ctx.shadowBlur = 0;
    }"""

NEW = """    // Draw current photo — hard cut, no crossfade, no globalAlpha manipulation
    drawCoverPhoto(ctx, img, W, H, scale, tx, ty);

    // Bottom gradient — always at full opacity, always drawn
    if (caption) {
      const grad = ctx.createLinearGradient(0, H * 0.5, 0, H);
      grad.addColorStop(0, 'rgba(0,0,0,0)');
      grad.addColorStop(1, 'rgba(0,0,0,0.85)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, H * 0.5, W, H * 0.5);
    }

    // Top vignette
    const topGrad = ctx.createLinearGradient(0, 0, 0, 180);
    topGrad.addColorStop(0, 'rgba(0,0,0,0.3)');
    topGrad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = topGrad;
    ctx.fillRect(0, 0, W, 180);

    // Caption — always full opacity, no alpha changes anywhere near this
    if (caption) {
      ctx.fillStyle = 'white';
      ctx.font = (selectedVibe === 'energy' ? '500 68px' : '500 60px') + ' "DM Serif Display", Georgia, serif';
      ctx.textAlign = 'left';
      ctx.shadowColor = 'rgba(0,0,0,0.9)';
      ctx.shadowBlur = 28;
      wrapText(ctx, caption, 72, H - 300, W - 144, 80);
      ctx.shadowBlur = 0;
    }"""

if OLD in content:
    content = content.replace(OLD, NEW)
    print("OK: replaced crossfade block with hard cut")
else:
    print("ERROR: could not find crossfade block")
    # Show what's actually there around the crossfade area
    idx = content.find('Crossfade')
    if idx >= 0:
        print("Found 'Crossfade' at:", idx)
        print(content[idx:idx+200])
    else:
        print("No 'Crossfade' text found at all")
    exit(1)

with open(path, 'w', encoding='utf-8') as f:
    f.write(content)

print("Done. Deploy now.")
