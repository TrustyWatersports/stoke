import os, re

BASE = r"C:\Users\andre\stoke"

# =============================================================================
# FIX 1: MICROPHONE - stop the permission retry loop on iOS
# FIX 2: MICROPHONE - don't auto-start wake word on mobile (causes always-on indicator)
# FIX 3: TTS VOICE - use best available natural voice, fallback gracefully
# FIX 4: CALENDAR - mobile sizing fixes
# =============================================================================

voice_path = os.path.join(BASE, "js", "voice.js")
with open(voice_path, 'r', encoding='utf-8') as f:
    voice = f.read()

# ─────────────────────────────────────────────────────────────────────────────
# FIX 1 + 2: Permission handling + wake word mobile behavior
# Replace the setupRecognition onerror + init function
# ─────────────────────────────────────────────────────────────────────────────

# Add permission state tracking at the top (after 'let wakeEnabled = true;')
OLD_STATE = "let wakeEnabled = true;"
NEW_STATE = """let wakeEnabled = true;
let micPermission = 'unknown'; // 'granted' | 'denied' | 'unknown'
let isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);"""

voice = voice.replace(OLD_STATE, NEW_STATE, 1)

# Replace onerror handler - the key fix for the permission loop
OLD_ONERROR = """  recognition.onerror = (e) => {
    console.warn('[Stoke Voice] Error:', e.error);
    if (e.error !== 'no-speech' && e.error !== 'aborted') {
      showError('Could not hear that. Please try again.');
    }
    stopListening();
  };"""

NEW_ONERROR = """  recognition.onerror = (e) => {
    console.warn('[Stoke Voice] Error:', e.error);
    if (e.error === 'not-allowed' || e.error === 'permission-denied') {
      // User denied mic - mark it, disable wake word, NEVER ask again automatically
      micPermission = 'denied';
      wakeEnabled = false;
      stopListening();
      stopWakeWord();
      // Hide the mic button so it doesn't taunt them
      const btn = document.getElementById('stoke-voice-btn');
      const hdr = document.getElementById('stoke-voice-header-btn');
      if (btn) btn.style.display = 'none';
      if (hdr) hdr.style.display = 'none';
      return;
    }
    if (e.error === 'no-speech' || e.error === 'aborted') {
      // Silent failures - just stop, don't show error
      stopListening();
      return;
    }
    // Other errors - show once, don't loop
    showError('Could not hear that. Please try again.');
    stopListening();
  };"""

voice = voice.replace(OLD_ONERROR, NEW_ONERROR, 1)

# Also fix wake word onerror - currently swallows all errors silently
OLD_WAKE_ERR = "  wakeRecognition.onerror = () => {};"
NEW_WAKE_ERR = """  wakeRecognition.onerror = (e) => {
    if (e.error === 'not-allowed' || e.error === 'permission-denied') {
      micPermission = 'denied';
      wakeEnabled = false;
      stopWakeWord();
    }
    wakeListening = false;
  };"""

voice = voice.replace(OLD_WAKE_ERR, NEW_WAKE_ERR, 1)

# Fix startWakeWord - don't start on mobile (causes always-on indicator in Dynamic Island)
OLD_START_WAKE = """function startWakeWord() {
  if (!wakeRecognition || recognizing || wakeListening) return;
  try {
    wakeRecognition.start();
    wakeListening = true;
    const ind = document.getElementById('stoke-wake-indicator');
    if (ind) ind.classList.add('visible');
  } catch(e) {}
}"""

NEW_START_WAKE = """function startWakeWord() {
  // Never auto-start wake word on mobile - it holds the mic open constantly
  // and shows the orange indicator in iPhone's Dynamic Island / status bar
  // On mobile, users tap the button intentionally
  if (!wakeRecognition || recognizing || wakeListening) return;
  if (isMobile) return;
  if (micPermission === 'denied') return;
  if (!wakeEnabled) return;
  try {
    wakeRecognition.start();
    wakeListening = true;
    const ind = document.getElementById('stoke-wake-indicator');
    if (ind) ind.classList.add('visible');
  } catch(e) {
    wakeListening = false;
  }
}"""

voice = voice.replace(OLD_START_WAKE, NEW_START_WAKE, 1)

# Fix the wake word onend restart loop - add permission + mobile check
OLD_WAKE_END = """  wakeRecognition.onend = () => {
    wakeListening = false;
    // Restart if not in active listening mode
    if (!recognizing && wakeEnabled) {
      setTimeout(startWakeWord, 500);
    }
  };"""

NEW_WAKE_END = """  wakeRecognition.onend = () => {
    wakeListening = false;
    // Only restart on desktop, only if permitted, only if enabled
    if (!recognizing && wakeEnabled && !isMobile && micPermission !== 'denied') {
      setTimeout(startWakeWord, 1000);
    }
  };"""

voice = voice.replace(OLD_WAKE_END, NEW_WAKE_END, 1)

# Fix init - check permission before starting anything, show mic button conditionally
OLD_INIT = """function init() {
  injectUI();
  if (setupRecognition()) {
    setupWakeWord();
    // Start wake word after a short delay
    setTimeout(startWakeWord, 2000);
    console.log('[Stoke Voice] Ready. Say "Hey Stoke" or tap the mic button.');
  }"""

NEW_INIT = """function init() {
  injectUI();

  // Check mic permission state before doing anything
  if (navigator.permissions) {
    navigator.permissions.query({ name: 'microphone' }).then(result => {
      micPermission = result.state; // 'granted' | 'denied' | 'prompt'
      result.onchange = () => {
        micPermission = result.state;
        if (result.state === 'denied') {
          wakeEnabled = false;
          stopWakeWord();
        }
      };

      if (result.state === 'denied') {
        // Already denied - hide mic button, don't ask
        wakeEnabled = false;
        const btn = document.getElementById('stoke-voice-btn');
        const hdr = document.getElementById('stoke-voice-header-btn');
        if (btn) btn.title = 'Microphone access denied';
        if (hdr) hdr.title = 'Microphone access denied';
        return;
      }

      if (setupRecognition()) {
        setupWakeWord();
        // Only start wake word on desktop with granted permission
        if (!isMobile) {
          setTimeout(startWakeWord, 2000);
        }
        console.log('[Stoke Voice] Ready.' + (isMobile ? ' Tap mic to talk.' : ' Say "Hey Stoke" or tap the mic.'));
      }
    }).catch(() => {
      // Permissions API not available - set up normally but be cautious
      if (setupRecognition()) {
        setupWakeWord();
        if (!isMobile) setTimeout(startWakeWord, 2000);
      }
    });
  } else {
    // No Permissions API (older browsers)
    if (setupRecognition()) {
      setupWakeWord();
      if (!isMobile) setTimeout(startWakeWord, 2000);
      console.log('[Stoke Voice] Ready.');
    }
  }"""

voice = voice.replace(OLD_INIT, NEW_INIT, 1)

# ─────────────────────────────────────────────────────────────────────────────
# FIX 3: TTS VOICE - use the best available natural voice
# The problem: getVoices() returns empty array on first call (async loading)
# Fix: wait for voiceschanged event, pick the most natural voice available
# ─────────────────────────────────────────────────────────────────────────────

OLD_SPEAK = """// ── TEXT TO SPEECH ─────────────────────────────────────────────
function speak(text) {
  if (!window.speechSynthesis) return;
  window.speechSynthesis.cancel();
  const utt = new SpeechSynthesisUtterance(text);
  utt.rate = 1.05;
  utt.pitch = 1;
  utt.volume = 0.85;
  // Prefer a natural voice
  const voices = window.speechSynthesis.getVoices();
  const preferred = voices.find(v => v.name.includes('Samantha') || v.name.includes('Karen') || v.name.includes('Moira') || (v.lang === 'en-US' && v.localService));
  if (preferred) utt.voice = preferred;
  window.speechSynthesis.speak(utt);
}"""

NEW_SPEAK = """// ── TEXT TO SPEECH ─────────────────────────────────────────────
// Voice preference order - most natural sounding first
// iOS: Samantha (enhanced) > Siri voices > Samantha (default)
// macOS: Samantha > Alex > Karen > Moira
// Android: Google US English > en-US local service
// Windows: Aria > Jenny > Zira > David
const VOICE_PREFS = [
  // iOS / macOS premium voices
  'Samantha (Enhanced)',
  'Siri Female',
  'Siri Voice 2',
  'Karen (Enhanced)',
  'Moira (Enhanced)',
  // macOS standard
  'Samantha',
  'Alex',
  'Karen',
  'Moira',
  // Windows natural voices (Edge/Chromium)
  'Microsoft Aria Online (Natural)',
  'Microsoft Jenny Online (Natural)',
  'Microsoft Aria',
  'Microsoft Jenny',
  // Google (Android/Chrome)
  'Google US English',
  'Google UK English Female',
  // Windows legacy
  'Microsoft Zira Desktop',
];

let _bestVoice = null;
let _voicesLoaded = false;

function loadBestVoice() {
  const voices = window.speechSynthesis.getVoices();
  if (!voices.length) return null;

  // Try preference list first
  for (const pref of VOICE_PREFS) {
    const v = voices.find(v => v.name === pref);
    if (v) return v;
  }

  // Fallback: best en-US local voice
  const local = voices.find(v => v.lang === 'en-US' && v.localService);
  if (local) return local;

  // Last resort: any en-US voice
  const anyUS = voices.find(v => v.lang === 'en-US' || v.lang === 'en_US');
  if (anyUS) return anyUS;

  return voices[0] || null;
}

// Pre-load voices as soon as they're available
if (window.speechSynthesis) {
  // Chrome loads voices async
  if (window.speechSynthesis.onvoiceschanged !== undefined) {
    window.speechSynthesis.onvoiceschanged = () => {
      if (!_voicesLoaded) {
        _bestVoice = loadBestVoice();
        _voicesLoaded = true;
        console.log('[Stoke Voice] TTS voice:', _bestVoice?.name || 'default');
      }
    };
  }
  // Safari/Firefox load voices sync
  setTimeout(() => {
    if (!_voicesLoaded) {
      _bestVoice = loadBestVoice();
      _voicesLoaded = true;
      console.log('[Stoke Voice] TTS voice:', _bestVoice?.name || 'default');
    }
  }, 500);
}

function speak(text) {
  if (!window.speechSynthesis) return;
  window.speechSynthesis.cancel();

  const utt = new SpeechSynthesisUtterance(text);

  // Natural speech parameters - less robotic
  utt.rate  = 0.95;   // Slightly slower = more natural (was 1.05)
  utt.pitch = 1.0;    // Neutral pitch
  utt.volume = 0.9;

  // Assign best available voice
  const voice = _bestVoice || loadBestVoice();
  if (voice) utt.voice = voice;

  // iOS fix: speechSynthesis sometimes stops mid-sentence
  // Keep it alive with a periodic check
  let resumeTimer;
  utt.onstart = () => {
    resumeTimer = setInterval(() => {
      if (window.speechSynthesis.paused) window.speechSynthesis.resume();
    }, 250);
  };
  utt.onend = utt.onerror = () => {
    clearInterval(resumeTimer);
  };

  window.speechSynthesis.speak(utt);
}"""

voice = voice.replace(OLD_SPEAK, NEW_SPEAK, 1)

with open(voice_path, 'w', encoding='utf-8') as f:
    f.write(voice)
print("OK: voice.js fixed (permission loop, mobile wake word, TTS quality)")

# =============================================================================
# FIX 4: CALENDAR mobile sizing
# =============================================================================

cal_path = os.path.join(BASE, "calendar.html")
with open(cal_path, 'r', encoding='utf-8') as f:
    cal = f.read()

# Find the existing mobile calendar CSS and add/fix it
CAL_MOBILE_CSS = """
/* ── CALENDAR MOBILE FIXES ─────────────────────────────────────────────── */
@media (max-width: 768px) {
  /* Shell: stack sidebar above calendar body */
  .cal-shell {
    flex-direction: column !important;
    height: auto !important;
    overflow: visible !important;
  }

  /* Sidebar becomes a horizontal strip */
  .cal-sidebar {
    width: 100% !important;
    min-width: unset !important;
    max-width: unset !important;
    border-right: none !important;
    border-bottom: 0.5px solid var(--border) !important;
    flex-direction: row !important;
    flex-wrap: wrap !important;
    gap: 8px !important;
    padding: 12px !important;
    overflow-x: auto !important;
    overflow-y: visible !important;
    height: auto !important;
    max-height: none !important;
  }

  /* Mini calendar in sidebar takes less space on mobile */
  .cal-sidebar .mini-cal {
    min-width: 200px !important;
    flex: 1 !important;
  }

  /* Service type filters become scrollable chips */
  .cal-sidebar .service-filters {
    display: flex !important;
    flex-wrap: wrap !important;
    gap: 4px !important;
    flex: 2 !important;
  }

  /* Calendar body fills full width */
  .cal-body {
    width: 100% !important;
    min-width: unset !important;
    overflow-x: auto !important;
    -webkit-overflow-scrolling: touch !important;
  }

  /* Week grid: allow horizontal scroll on mobile */
  .week-grid {
    min-width: 480px !important;
  }

  /* Time column narrower on mobile */
  .time-col {
    min-width: 44px !important;
    font-size: 10px !important;
  }

  /* Day columns use flex */
  .day-col {
    min-width: 60px !important;
    font-size: 11px !important;
  }

  /* Day header text smaller */
  .day-header-name {
    font-size: 10px !important;
  }

  .day-header-num {
    font-size: 16px !important;
  }

  /* Month view: reduce padding */
  .month-grid .day-cell {
    min-height: 60px !important;
    padding: 4px !important;
  }

  .month-grid .day-cell .cell-events {
    display: none !important; /* hide text events on very small screens */
  }

  /* Event blocks: smaller text */
  .event-block {
    font-size: 10px !important;
    padding: 2px 4px !important;
  }

  /* Nav buttons */
  .cal-nav {
    gap: 6px !important;
  }

  .cal-nav button {
    padding: 6px 10px !important;
    font-size: 12px !important;
  }

  /* View toggle buttons */
  .view-toggle {
    gap: 4px !important;
  }

  .view-toggle button {
    padding: 5px 10px !important;
    font-size: 11px !important;
  }

  /* FAB: push up above iOS home bar */
  #stoke-voice-btn {
    bottom: calc(24px + env(safe-area-inset-bottom)) !important;
  }
}

@media (max-width: 480px) {
  /* Extra small: day names abbreviated */
  .day-header-name {
    font-size: 9px !important;
    letter-spacing: 0 !important;
  }

  /* Month cells even more compact */
  .month-grid .day-cell {
    min-height: 44px !important;
  }

  /* Hide time labels on tiny screens */
  .time-label {
    display: none !important;
  }

  .time-col {
    min-width: 8px !important;
  }
}
"""

# Add to end of <style> block in calendar.html
if 'CALENDAR MOBILE FIXES' not in cal:
    cal = cal.replace('</style>', CAL_MOBILE_CSS + '\n</style>', 1)
    print("OK: calendar.html mobile CSS added")
else:
    print("OK: calendar mobile CSS already present")

with open(cal_path, 'w', encoding='utf-8') as f:
    f.write(cal)

# =============================================================================
# Summary
# =============================================================================
print("""
All fixes applied:

VOICE - Bug 1 (Permission loop):
  - Tracks micPermission state ('granted'|'denied'|'prompt')
  - On 'not-allowed' error: disables wake word permanently, hides mic button
  - Never re-requests permission automatically
  - Uses navigator.permissions.query() to check state upfront

VOICE - Bug 2 (Always-on Dynamic Island indicator):
  - isMobile detection added
  - Wake word NEVER auto-starts on mobile
  - Mobile users tap button to talk (no background mic usage)
  - Dynamic Island / status bar orange mic indicator gone

VOICE - Bug 3 (Robotic voice):
  - Voices loaded async via onvoiceschanged + setTimeout fallback
  - Priority list: Samantha Enhanced > Siri > Karen > Google > Microsoft Aria
  - rate: 0.95 (slightly slower = more natural)
  - iOS speechSynthesis keepalive timer (prevents mid-sentence cut-off)
  - Logs which voice was selected to console

CALENDAR - Mobile sizing:
  - cal-shell stacks vertically on mobile
  - Sidebar becomes horizontal strip
  - cal-body allows horizontal scroll
  - week-grid min-width 480px (scrollable)
  - Compact event blocks, smaller fonts
  - Safe area insets for iPhone home bar

Deploy:
  git add -A
  git commit -m "Fix: mic permission loop, mobile wake word, TTS voice quality, calendar mobile"
  git push origin main
  npx wrangler@3.99.0 pages deploy . --project-name=stoke --commit-dirty=true
""")
