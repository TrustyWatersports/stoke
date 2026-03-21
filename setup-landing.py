#!/usr/bin/env python3
# setup-landing.py
# 1. Renames index.html -> app.html (content generator)
# 2. Renames landing.html -> index.html (new home/marketing page)
# 3. Updates all internal links across every page

import os, re

BASE = r"C:\Users\andre\stoke"

# ── Step 1: Do the file swap ─────────────────────────────────────────────────
src_app     = os.path.join(BASE, "index.html")
src_landing = os.path.join(BASE, "landing.html")
tmp         = os.path.join(BASE, "_landing_tmp.html")

# Read both
with open(src_app, 'r', encoding='utf-8') as f:
    app_content = f.read()
with open(src_landing, 'r', encoding='utf-8') as f:
    landing_content = f.read()

# Write landing -> index.html, app -> app.html
with open(os.path.join(BASE, "index.html"), 'w', encoding='utf-8') as f:
    f.write(landing_content)
with open(os.path.join(BASE, "app.html"), 'w', encoding='utf-8') as f:
    f.write(app_content)

print("OK: landing.html -> index.html")
print("OK: index.html   -> app.html")

# ── Step 2: Update all links across every html file ──────────────────────────
html_files = [f for f in os.listdir(BASE) if f.endswith('.html')]

REPLACEMENTS = [
    # Old generator link -> new app.html
    ('"index.html"',    '"app.html"'),
    ("'index.html'",    "'app.html'"),
    # Nav pills that said "Generate" pointing to index
    ('href="index.html"', 'href="app.html"'),
    # landing.html references (in case any exist)
    ('"landing.html"',  '"index.html"'),
    ("'landing.html'",  "'index.html'"),
]

for filename in html_files:
    path = os.path.join(BASE, filename)
    with open(path, 'r', encoding='utf-8') as f:
        content = f.read()

    original = content
    for old, new in REPLACEMENTS:
        content = content.replace(old, new)

    if content != original:
        with open(path, 'w', encoding='utf-8') as f:
            f.write(content)
        print(f"Updated links: {filename}")
    else:
        print(f"No changes:    {filename}")

# ── Step 3: Also update the header Python script so future runs use app.html ─
header_script = os.path.join(BASE, "update-headers.py")
if os.path.exists(header_script):
    with open(header_script, 'r', encoding='utf-8') as f:
        hs = f.read()
    hs = hs.replace('"index.html",      "index"', '"app.html",        "generator"')
    hs = hs.replace("'index.html'",               "'app.html'")
    with open(header_script, 'w', encoding='utf-8') as f:
        f.write(hs)
    print("Updated: update-headers.py")

print("\nDone! Now deploy:")
print("  cd C:\\Users\\andre\\stoke")
print("  git add -A")
print('  git commit -m "Landing page as root, generator moves to app.html"')
print("  git push origin main")
print("  npx wrangler@3.99.0 pages deploy . --project-name=stoke --commit-dirty=true")
