#!/usr/bin/env python3
# update-headers.py — Updates Stoke page headers uniformly
# Run from C:\Users\andre\stoke with: python update-headers.py

import os, re

BASE = r"C:\Users\andre\stoke"

NAV_ITEMS = [
    ("dashboard.html",  "dashboard",  "Home"),
    ("app.html",        "generator",      "Generate"),
    ("schedule.html",   "schedule",   "Posts"),
    ("reel-maker.html", "reel-maker", "Reels"),
    ("calendar.html",   "calendar",   "Calendar"),
    ("invoices.html",   "invoices",   "Invoices"),
]

PAGES = [
    # (filename, active_key, wide)
    ("dashboard.html",    "dashboard",    True),
    ("index.html",        "index",        False),
    ("calendar.html",     "calendar",     True),
    ("invoices.html",     "invoices",     True),
    ("reel-maker.html",   "reel-maker",   False),
    ("schedule.html",     "schedule",     False),
    ("settings.html",     "settings",     False),
    ("voice-wizard.html", "voice-wizard", False),
]

def build_header(active_key):
    pills = []
    icons = {
        "dashboard":    "&#127968;",
        "index":        "&#9997;",
        "schedule":     "&#128197;",
        "reel-maker":   "&#127916;",
        "calendar":     "&#128198;",
        "invoices":     "&#129534;",
    }
    for href, key, label in NAV_ITEMS:
        cls = 'nav-pill active' if key == active_key else 'nav-pill'
        icon = icons.get(key, '')
        pills.append(f'      <a href="{href}" class="{cls}">{icon} {label}</a>')

    nav_html = "\n".join(pills)

    return f'''  <div class="header">
    <a href="dashboard.html" class="header-home">
      <div class="logo"><svg viewBox="0 0 20 20" fill="none" width="20" height="20"><path d="M10 2C10 2 4 8 4 12a6 6 0 0012 0c0-4-6-10-6-10z" fill="white" opacity=".95"/><path d="M10 8c0 0-2 3-2 5a2 2 0 004 0c0-2-2-5-2-5z" fill="white" opacity=".45"/></svg></div>
      <span class="wordmark">Stoke</span>
    </a>
    <div class="header-divider"></div>
    <nav class="header-nav">
{nav_html}
      <div style="width:1px;height:16px;background:var(--border-2);margin:0 2px;flex-shrink:0"></div>
      <a href="settings.html" class="nav-pill-icon" title="Settings">&#9881;</a>
      <a href="voice-wizard.html" class="nav-pill-icon" title="Voice Profile">&#10024;</a>
      <span id="auth-indicator" class="auth-badge" style="display:none"></span>
    </nav>
  </div>'''


def replace_header_block(content, new_header):
    """Find <div class="header"> ... </div> and replace it."""
    start_token = '  <div class="header">'
    start = content.find(start_token)
    if start == -1:
        return None, "header start not found"

    # Walk forward counting div depth to find matching close
    depth = 0
    i = start
    end = -1
    while i < len(content) - 5:
        if content[i:i+4] == '<div':
            depth += 1
        elif content[i:i+6] == '</div>':
            depth -= 1
            if depth == 0:
                end = i + 6
                break
        i += 1

    if end == -1:
        return None, "header end not found"

    new_content = content[:start] + new_header + content[end:]
    return new_content, None


for filename, active_key, wide in PAGES:
    path = os.path.join(BASE, filename)
    if not os.path.exists(path):
        print(f"SKIP (not found): {filename}")
        continue

    with open(path, 'r', encoding='utf-8') as f:
        content = f.read()

    new_header = build_header(active_key)
    new_content, err = replace_header_block(content, new_header)

    if err:
        print(f"ERROR ({filename}): {err}")
        continue

    # Add app-wide class for dashboard pages
    if wide:
        new_content = new_content.replace(
            '<div class="app">',
            '<div class="app app-wide">'
        )
        # Don't double-add
        new_content = new_content.replace(
            '<div class="app app-wide app-wide">',
            '<div class="app app-wide">'
        )

    with open(path, 'w', encoding='utf-8') as f:
        f.write(new_content)

    print(f"OK: {filename} (active={active_key}, wide={wide})")

print("\nAll headers updated!")
print("Deploy: npx wrangler@3.99.0 pages deploy . --project-name=stoke --commit-dirty=true")
