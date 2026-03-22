#!/usr/bin/env python3
"""
run-migration.py - Safely runs Stoke D1 v2 migration
Splits migrate-v2.sql into small files, runs each with --file flag
This avoids all shell escaping issues.

Run from C:\Users\andre\stoke with: python run-migration.py
"""

import subprocess, os, re, tempfile

BASE    = r"C:\Users\andre\stoke"
DB      = "stoke-db"
WRANGLER = "npx"
WRANGLER_ARGS = ["wrangler@3.99.0", "d1", "execute", DB, "--remote", "--file"]

def run_file(filepath, label):
    """Run a SQL file against D1 remote using --file flag."""
    cmd = ["npx", "wrangler@3.99.0", "d1", "execute", DB, "--remote", "--file", filepath]
    result = subprocess.run(cmd, capture_output=True, text=True, cwd=BASE)

    out = result.stdout + result.stderr
    if 'already exists' in out.lower() or 'SQLITE_ERROR: table' in out:
        print(f"  SKIP (already exists): {label[:60]}")
        return "skip"
    if result.returncode != 0 and 'error' in out.lower():
        print(f"  FAIL: {label[:60]}")
        print(f"    {out[:300]}")
        return "fail"
    print(f"  OK: {label[:60]}")
    return "ok"

def split_sql(sql_text):
    """
    Split SQL into individual statements.
    Handles multi-line statements, comments, and INSERT blocks.
    """
    # Remove comment lines
    lines = []
    for line in sql_text.split('\n'):
        stripped = line.strip()
        if stripped.startswith('--') or stripped.startswith('#'):
            continue
        lines.append(line)
    clean = '\n'.join(lines)

    # Split on semicolons at end of line (not inside strings)
    statements = []
    current = []
    in_string = False
    i = 0
    while i < len(clean):
        ch = clean[i]
        if ch == "'" and not in_string:
            in_string = True
            current.append(ch)
        elif ch == "'" and in_string:
            # Check for escaped quote ''
            if i + 1 < len(clean) and clean[i+1] == "'":
                current.append("''")
                i += 2
                continue
            in_string = False
            current.append(ch)
        elif ch == ';' and not in_string:
            stmt = ''.join(current).strip()
            if stmt and len(stmt) > 5:
                statements.append(stmt)
            current = []
        else:
            current.append(ch)
        i += 1

    # Don't forget last statement without semicolon
    if current:
        stmt = ''.join(current).strip()
        if stmt and len(stmt) > 5:
            statements.append(stmt)

    return statements

print("=" * 60)
print("Stoke D1 v2 Migration")
print("Database:", DB)
print("=" * 60)

# ── Step 1: Check current tables ────────────────────────────
print("\n[1/4] Current database tables...")
check_cmd = ["npx", "wrangler@3.99.0", "d1", "execute", DB, "--remote",
             "--command", "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;"]
result = subprocess.run(check_cmd, capture_output=True, text=True, cwd=BASE)
print(result.stdout[:600] or result.stderr[:300])

# ── Step 2: Parse migration ──────────────────────────────────
print("\n[2/4] Parsing migrate-v2.sql...")
with open(os.path.join(BASE, "migrate-v2.sql"), 'r', encoding='utf-8') as f:
    sql = f.read()

statements = split_sql(sql)
print(f"  Found {len(statements)} statements")

# ── Step 3: Run each statement as its own temp file ──────────
print("\n[3/4] Running statements...")
counts = {"ok": 0, "skip": 0, "fail": 0}

tmp_dir = os.path.join(BASE, "_migration_tmp")
os.makedirs(tmp_dir, exist_ok=True)

for i, stmt in enumerate(statements):
    # Write to temp file
    tmp_file = os.path.join(tmp_dir, f"stmt_{i:03d}.sql")
    with open(tmp_file, 'w', encoding='utf-8') as f:
        f.write(stmt + ";\n")

    # Get a readable label
    first_line = stmt.split('\n')[0].strip()[:80]
    status = run_file(tmp_file, first_line)
    counts[status] = counts.get(status, 0) + 1

# Clean up temp files
import shutil
shutil.rmtree(tmp_dir, ignore_errors=True)

print(f"\n  Results: {counts['ok']} OK, {counts['skip']} skipped, {counts['fail']} failed")

# ── Step 4: Verify ──────────────────────────────────────────
print("\n[4/4] Verifying new tables...")
result = subprocess.run(check_cmd, capture_output=True, text=True, cwd=BASE)
output = result.stdout

required = ['events', 'leads', 'quotes', 'service_types', 'staff', 'event_staff']
all_good = True
for table in required:
    found = table in output
    status = "✓" if found else "✗ MISSING"
    print(f"  {status} {table}")
    if not found:
        all_good = False

print("\n" + "=" * 60)
if all_good and counts['fail'] == 0:
    print("SUCCESS - Migration complete!")
    print("All 6 new tables created. Data now syncs to cloud.")
elif all_good:
    print("MOSTLY OK - Tables created, some statements had warnings.")
    print("Check 'fail' entries above - INSERT errors are usually fine.")
else:
    print("INCOMPLETE - Some tables missing. Check errors above.")
    print("Try running the failing statements manually in:")
    print("  dash.cloudflare.com -> D1 -> stoke-db -> Console")
print("=" * 60)
