import os

path = r"C:\Users\andre\stoke\_worker.js"

with open(path, 'r', encoding='utf-8') as f:
    content = f.read()

# The file has the email functions duplicated.
# First occurrence starts at "// -- EMAIL TEMPLATES" around line 27
# Second occurrence starts at "// -- EMAIL TEMPLATES" again later
# We need to remove the SECOND occurrence (everything from second marker to sendMagicLink)

MARKER = "// -- EMAIL TEMPLATES --"

first = content.find(MARKER)
second = content.find(MARKER, first + 10)

if first == -1:
    print("ERROR: marker not found")
    exit(1)

if second == -1:
    print("OK: no duplicate found - already clean")
    exit(0)

print(f"First occurrence at char {first}")
print(f"Second occurrence at char {second}")

# Find what comes after the duplicate block - the sendMagicLink function
# which should remain (it's the new version)
AFTER_DUPE = "async function sendMagicLink(email, tok, env){"
after_idx = content.find(AFTER_DUPE, second)

if after_idx == -1:
    # Try alternate
    AFTER_DUPE = "async function sendMagicLink("
    after_idx = content.find(AFTER_DUPE, second)

if after_idx == -1:
    print("ERROR: could not find sendMagicLink after duplicate")
    # Show what's around second marker
    print(content[second:second+200])
    exit(1)

print(f"sendMagicLink found at char {after_idx}")
print(f"Removing chars {second} to {after_idx} (duplicate block)")

# Remove the duplicate: keep everything before second marker,
# then skip to sendMagicLink
content = content[:second] + content[after_idx:]

# Verify no more duplicates
third = content.find(MARKER, content.find(MARKER) + 10)
if third != -1:
    print(f"WARNING: still found MARKER at {third}, removing again")
    fourth_after = content.find("async function sendMagicLink(", third)
    if fourth_after != -1:
        content = content[:third] + content[fourth_after:]

with open(path, 'w', encoding='utf-8') as f:
    f.write(content)

print("OK: duplicates removed")
print("Function count check:")
for fn in ["emailBase", "magicLinkEmail", "bookingConfirmEmail", "invoiceEmail", "sendEmail", "sendMagicLink"]:
    count = content.count("function " + fn)
    status = "OK" if count == 1 else f"ERROR: found {count} times"
    print(f"  {fn}: {status}")
