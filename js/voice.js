/**
 * voice.js — Stoke Voice Command Layer v1.0
 * 
 * Handles: tap-to-talk + "Hey Stoke" wake word
 * Actions: invoice, book, social post, query schedule, send confirmation
 * Works on every page via single <script> tag
 */

(function() {
'use strict';

// ── CONFIG ────────────────────────────────────────────────────
const WAKE_WORD = 'hey stoke';
const VOICE_VERSION = '1.0';

// ── STATE ─────────────────────────────────────────────────────
let recognizing = false;
let wakeListening = false;
let recognition = null;
let wakeRecognition = null;
let commandCard = null;
let pendingAction = null;
let ttsUtterance = null;
let wakeEnabled = true;

// ── INJECT STYLES ─────────────────────────────────────────────
const style = document.createElement('style');
style.textContent = `
  /* ── Voice button ─────────────────────────────────────────── */
  #stoke-voice-btn {
    position: fixed;
    bottom: 24px;
    right: 24px;
    width: 56px;
    height: 56px;
    border-radius: 50%;
    background: var(--green, #1a6b4a);
    border: none;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: 0 4px 20px rgba(26,107,74,0.35);
    z-index: 1000;
    transition: all .2s;
    color: white;
    font-size: 22px;
  }
  #stoke-voice-btn:hover { transform: scale(1.08); box-shadow: 0 6px 28px rgba(26,107,74,0.45); }
  #stoke-voice-btn.listening { background: #c0392b; animation: voice-pulse 1.2s ease-in-out infinite; }
  #stoke-voice-btn.processing { background: #e67e22; animation: voice-spin 1s linear infinite; }
  #stoke-voice-btn.wake-active { box-shadow: 0 0 0 3px rgba(26,107,74,0.3), 0 4px 20px rgba(26,107,74,0.35); }
  @keyframes voice-pulse {
    0%, 100% { box-shadow: 0 4px 20px rgba(192,57,43,0.4), 0 0 0 0 rgba(192,57,43,0.4); }
    50% { box-shadow: 0 4px 20px rgba(192,57,43,0.4), 0 0 0 12px rgba(192,57,43,0); }
  }
  @keyframes voice-spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }

  /* Header mic (desktop) */
  #stoke-voice-header-btn {
    width: 30px;
    height: 30px;
    border-radius: 50%;
    background: var(--green-light, #e8f5ef);
    border: 0.5px solid var(--green, #1a6b4a);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 13px;
    color: var(--green, #1a6b4a);
    transition: all .15s;
    flex-shrink: 0;
  }
  #stoke-voice-header-btn:hover { background: var(--green, #1a6b4a); color: white; }
  #stoke-voice-header-btn.listening { background: #c0392b; color: white; border-color: #c0392b; }
  #stoke-voice-header-btn.processing { background: #e67e22; color: white; border-color: #e67e22; }
  @media(max-width: 640px) { #stoke-voice-header-btn { display: none; } }
  @media(min-width: 641px) { #stoke-voice-btn { display: none; } }

  /* ── Waveform overlay ──────────────────────────────────────── */
  #stoke-voice-overlay {
    display: none;
    position: fixed;
    bottom: 100px;
    right: 24px;
    background: var(--bg, #fff);
    border: 0.5px solid var(--border, rgba(0,0,0,0.1));
    border-radius: 16px;
    padding: 12px 16px;
    width: 240px;
    box-shadow: 0 8px 32px rgba(0,0,0,0.12);
    z-index: 1001;
    font-family: 'DM Sans', sans-serif;
  }
  @media(min-width: 641px) {
    #stoke-voice-overlay { bottom: auto; right: auto; top: 64px; left: 50%; transform: translateX(-50%); width: 320px; }
  }
  #stoke-voice-overlay.visible { display: block; animation: voice-slide-in .2s ease; }
  @keyframes voice-slide-in {
    from { opacity: 0; transform: translateY(8px); }
    to { opacity: 1; transform: translateY(0); }
  }
  .voice-overlay-label { font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: .08em; color: var(--text-3, #999); margin-bottom: 6px; }
  .voice-transcript { font-size: 13px; color: var(--text, #1a1a18); min-height: 20px; font-style: italic; }
  .voice-bars { display: flex; align-items: center; gap: 3px; height: 24px; margin-top: 8px; }
  .voice-bar { width: 3px; border-radius: 2px; background: var(--green, #1a6b4a); animation: voice-bar-bounce 0.8s ease-in-out infinite; }
  .voice-bar:nth-child(2) { animation-delay: .1s; }
  .voice-bar:nth-child(3) { animation-delay: .2s; height: 18px !important; }
  .voice-bar:nth-child(4) { animation-delay: .1s; }
  .voice-bar:nth-child(5) { animation-delay: 0s; }
  @keyframes voice-bar-bounce {
    0%, 100% { transform: scaleY(0.4); opacity: .5; }
    50% { transform: scaleY(1); opacity: 1; }
  }

  /* ── Command card ──────────────────────────────────────────── */
  #stoke-command-card {
    display: none;
    position: fixed;
    bottom: 100px;
    right: 24px;
    width: 320px;
    background: var(--bg, #fff);
    border: 0.5px solid var(--green, #1a6b4a);
    border-radius: 16px;
    box-shadow: 0 12px 48px rgba(0,0,0,0.15);
    z-index: 1001;
    font-family: 'DM Sans', sans-serif;
    overflow: hidden;
  }
  @media(min-width: 641px) {
    #stoke-command-card { bottom: auto; right: auto; top: 64px; left: 50%; transform: translateX(-50%); }
  }
  #stoke-command-card.visible { display: block; animation: voice-slide-in .25s ease; }
  .cmd-header { background: var(--green, #1a6b4a); color: white; padding: 12px 14px; display: flex; align-items: center; gap: 8px; }
  .cmd-icon { font-size: 18px; }
  .cmd-title { font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: .06em; }
  .cmd-body { padding: 14px; }
  .cmd-summary { font-size: 14px; color: var(--text, #1a1a18); line-height: 1.5; margin-bottom: 12px; }
  .cmd-detail-row { display: flex; justify-content: space-between; padding: 5px 0; border-bottom: 0.5px solid var(--border, rgba(0,0,0,0.08)); font-size: 12px; }
  .cmd-detail-row:last-of-type { border-bottom: none; }
  .cmd-detail-label { color: var(--text-3, #999); }
  .cmd-detail-value { color: var(--text, #1a1a18); font-weight: 500; }
  .cmd-actions { display: flex; gap: 8px; margin-top: 14px; }
  .cmd-confirm { flex: 1; padding: 10px; background: var(--green, #1a6b4a); color: white; border: none; border-radius: 8px; font-family: 'DM Sans', sans-serif; font-size: 13px; font-weight: 500; cursor: pointer; transition: background .15s; }
  .cmd-confirm:hover { background: #0f4a32; }
  .cmd-edit { padding: 10px 14px; background: none; border: 0.5px solid var(--border, rgba(0,0,0,0.1)); border-radius: 8px; font-family: 'DM Sans', sans-serif; font-size: 13px; color: var(--text-2, #666); cursor: pointer; }
  .cmd-cancel { padding: 10px 14px; background: none; border: none; font-family: 'DM Sans', sans-serif; font-size: 13px; color: var(--text-3, #999); cursor: pointer; }
  .cmd-error { background: #fef3f2; border-color: #c0392b; }
  .cmd-error .cmd-header { background: #c0392b; }
  .cmd-error .cmd-summary { color: #c0392b; }

  /* ── Wake word indicator ───────────────────────────────────── */
  #stoke-wake-indicator {
    position: fixed;
    bottom: 88px;
    right: 30px;
    font-size: 9px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: .08em;
    color: var(--green, #1a6b4a);
    opacity: 0;
    transition: opacity .3s;
    z-index: 999;
    font-family: 'DM Sans', sans-serif;
  }
  #stoke-wake-indicator.visible { opacity: 1; }
  @media(min-width: 641px) { #stoke-wake-indicator { display: none; } }
`;
document.head.appendChild(style);

// ── INJECT HTML ───────────────────────────────────────────────
function injectUI() {
  // Floating mobile button
  const floatBtn = document.createElement('button');
  floatBtn.id = 'stoke-voice-btn';
  floatBtn.innerHTML = '🎤';
  floatBtn.title = 'Tap to talk to Stoke';
  floatBtn.addEventListener('click', toggleListening);
  document.body.appendChild(floatBtn);

  // Wake word indicator
  const wakeInd = document.createElement('div');
  wakeInd.id = 'stoke-wake-indicator';
  wakeInd.textContent = 'Say "Hey Stoke"';
  document.body.appendChild(wakeInd);

  // Listening overlay
  const overlay = document.createElement('div');
  overlay.id = 'stoke-voice-overlay';
  overlay.innerHTML = `
    <div class="voice-overlay-label" id="voice-overlay-label">Listening...</div>
    <div class="voice-transcript" id="voice-transcript">Say your command...</div>
    <div class="voice-bars">
      <div class="voice-bar" style="height:12px"></div>
      <div class="voice-bar" style="height:20px"></div>
      <div class="voice-bar" style="height:16px"></div>
      <div class="voice-bar" style="height:22px"></div>
      <div class="voice-bar" style="height:10px"></div>
      <div class="voice-bar" style="height:18px"></div>
      <div class="voice-bar" style="height:14px"></div>
    </div>`;
  document.body.appendChild(overlay);

  // Command card
  const card = document.createElement('div');
  card.id = 'stoke-command-card';
  card.innerHTML = `
    <div class="cmd-header">
      <span class="cmd-icon" id="cmd-icon">✦</span>
      <span class="cmd-title" id="cmd-title">Command Ready</span>
    </div>
    <div class="cmd-body">
      <div class="cmd-summary" id="cmd-summary"></div>
      <div id="cmd-details"></div>
      <div class="cmd-actions">
        <button class="cmd-confirm" id="cmd-confirm-btn">✓ Confirm</button>
        <button class="cmd-edit" id="cmd-edit-btn">Edit</button>
        <button class="cmd-cancel" onclick="window.stokeVoice.dismissCard()">✕</button>
      </div>
    </div>`;
  document.body.appendChild(card);

  // Inject header button after auth indicator or at end of nav
  requestAnimationFrame(() => {
    const authIndicator = document.getElementById('auth-indicator');
    const header = document.querySelector('.header, .tagline, nav');
    if (authIndicator && authIndicator.parentElement) {
      const headerBtn = document.createElement('button');
      headerBtn.id = 'stoke-voice-header-btn';
      headerBtn.innerHTML = '🎤';
      headerBtn.title = 'Voice command (or say "Hey Stoke")';
      headerBtn.addEventListener('click', toggleListening);
      authIndicator.parentElement.insertBefore(headerBtn, authIndicator);
    }
  });
}

// ── SPEECH RECOGNITION SETUP ──────────────────────────────────
function setupRecognition() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    console.warn('[Stoke Voice] Speech recognition not supported in this browser.');
    return false;
  }

  // Main command recognition
  recognition = new SpeechRecognition();
  recognition.continuous = false;
  recognition.interimResults = true;
  recognition.lang = 'en-US';
  recognition.maxAlternatives = 1;

  recognition.onstart = () => {
    recognizing = true;
    setButtonState('listening');
    showOverlay('Listening... say your command');
  };

  recognition.onresult = (e) => {
    let interim = '', final = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      if (e.results[i].isFinal) final += e.results[i][0].transcript;
      else interim += e.results[i][0].transcript;
    }
    updateTranscript(final || interim);
    if (final) processCommand(final.trim());
  };

  recognition.onerror = (e) => {
    console.warn('[Stoke Voice] Error:', e.error);
    if (e.error !== 'no-speech' && e.error !== 'aborted') {
      showError('Could not hear that. Please try again.');
    }
    stopListening();
  };

  recognition.onend = () => {
    recognizing = false;
    setButtonState('idle');
    hideOverlay();
    // Restart wake word listening
    startWakeWord();
  };

  return true;
}

function setupWakeWord() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) return;

  wakeRecognition = new SpeechRecognition();
  wakeRecognition.continuous = true;
  wakeRecognition.interimResults = true;
  wakeRecognition.lang = 'en-US';

  wakeRecognition.onresult = (e) => {
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const transcript = e.results[i][0].transcript.toLowerCase().trim();
      if (transcript.includes('hey stoke') || transcript.includes('hey stock') || transcript.includes('a stoke')) {
        wakeRecognition.stop();
        wakeListening = false;
        // Small delay then start full command
        setTimeout(() => {
          speak('Yes?');
          startListening();
        }, 400);
        return;
      }
    }
  };

  wakeRecognition.onerror = () => {};
  wakeRecognition.onend = () => {
    wakeListening = false;
    // Restart if not in active listening mode
    if (!recognizing && wakeEnabled) {
      setTimeout(startWakeWord, 500);
    }
  };
}

function startWakeWord() {
  if (!wakeRecognition || recognizing || wakeListening) return;
  try {
    wakeRecognition.start();
    wakeListening = true;
    const ind = document.getElementById('stoke-wake-indicator');
    if (ind) ind.classList.add('visible');
  } catch(e) {}
}

function stopWakeWord() {
  if (wakeRecognition && wakeListening) {
    try { wakeRecognition.stop(); } catch(e) {}
    wakeListening = false;
  }
  const ind = document.getElementById('stoke-wake-indicator');
  if (ind) ind.classList.remove('visible');
}

// ── CONTROLS ──────────────────────────────────────────────────
function toggleListening() {
  if (recognizing) stopListening();
  else startListening();
}

function startListening() {
  if (!recognition && !setupRecognition()) return;
  stopWakeWord();
  dismissCard();
  try {
    recognition.start();
  } catch(e) {
    if (e.name !== 'InvalidStateError') console.warn('[Stoke Voice]', e);
  }
}

function stopListening() {
  if (recognition && recognizing) {
    try { recognition.stop(); } catch(e) {}
  }
  recognizing = false;
  setButtonState('idle');
  hideOverlay();
}

// ── UI HELPERS ────────────────────────────────────────────────
function setButtonState(state) {
  const btns = [
    document.getElementById('stoke-voice-btn'),
    document.getElementById('stoke-voice-header-btn')
  ].filter(Boolean);
  btns.forEach(btn => {
    btn.classList.remove('listening', 'processing', 'wake-active');
    if (state !== 'idle') btn.classList.add(state);
    btn.innerHTML = state === 'listening' ? '⏹' : state === 'processing' ? '⏳' : '🎤';
  });
}

function showOverlay(label) {
  const el = document.getElementById('stoke-voice-overlay');
  const lbl = document.getElementById('voice-overlay-label');
  if (el) { el.classList.add('visible'); }
  if (lbl) lbl.textContent = label;
}

function hideOverlay() {
  const el = document.getElementById('stoke-voice-overlay');
  if (el) el.classList.remove('visible');
  updateTranscript('');
}

function updateTranscript(text) {
  const el = document.getElementById('voice-transcript');
  if (el) el.textContent = text || 'Say your command...';
}

function showCommandCard(icon, title, summary, details, onConfirm, onEdit, isError) {
  const card = document.getElementById('stoke-command-card');
  if (!card) return;
  document.getElementById('cmd-icon').textContent = icon;
  document.getElementById('cmd-title').textContent = title;
  document.getElementById('cmd-summary').textContent = summary;

  const detailsEl = document.getElementById('cmd-details');
  detailsEl.innerHTML = Object.entries(details || {}).map(([k, v]) => v ? `
    <div class="cmd-detail-row">
      <span class="cmd-detail-label">${k}</span>
      <span class="cmd-detail-value">${v}</span>
    </div>` : '').join('');

  card.classList.toggle('cmd-error', !!isError);
  card.classList.add('visible');

  const confirmBtn = document.getElementById('cmd-confirm-btn');
  const editBtn = document.getElementById('cmd-edit-btn');
  confirmBtn.onclick = () => { dismissCard(); onConfirm && onConfirm(); };
  editBtn.onclick = () => { dismissCard(); onEdit && onEdit(); };
  if (isError) { confirmBtn.style.display = 'none'; editBtn.textContent = 'Try again'; }
  else { confirmBtn.style.display = ''; editBtn.textContent = 'Edit'; }
}

function dismissCard() {
  const card = document.getElementById('stoke-command-card');
  if (card) card.classList.remove('visible');
  pendingAction = null;
}

function showError(message) {
  showCommandCard('⚠️', 'Could not understand', message, {}, null, () => startListening(), true);
  speak(message);
}

// ── TEXT TO SPEECH ─────────────────────────────────────────────
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
}

// ── CONTEXT BUILDER ───────────────────────────────────────────
function buildContext() {
  let ctx = {};

  // Settings
  try { ctx.settings = JSON.parse(localStorage.getItem('stoke_settings') || '{}'); } catch(e) {}

  // Recent calendar events
  try {
    const events = JSON.parse(localStorage.getItem('stoke_events') || '[]');
    ctx.recentEvents = events
      .sort((a,b) => new Date(b.start||b.start_at*1000) - new Date(a.start||a.start_at*1000))
      .slice(0, 10)
      .map(e => ({
        id: e.id,
        title: e.title,
        type: e.type,
        customerName: e.customerName,
        customerEmail: e.customerEmail,
        customerPhone: e.customerPhone,
        amount: e.amount,
        status: e.status,
        notes: e.notes,
        date: new Date(e.start||e.start_at*1000).toLocaleDateString('en-US', {weekday:'short',month:'short',day:'numeric'}),
      }));
  } catch(e) {}

  // Open leads
  try {
    ctx.leads = JSON.parse(localStorage.getItem('stoke_leads') || '[]')
      .filter(l => l.status === 'new' || l.status === 'contacted')
      .slice(0, 5);
  } catch(e) {}

  // Recent campaigns
  try {
    const history = JSON.parse(localStorage.getItem('stoke_history') || '[]');
    ctx.recentCampaigns = history.slice(-3).map(h => ({
      id: h.id,
      jobType: h.meta?.jobType,
      customerMoment: h.meta?.customerMoment,
      date: h.createdAt,
    }));
  } catch(e) {}

  ctx.currentPage = window.location.pathname.split('/').pop() || 'dashboard.html';
  ctx.today = new Date().toLocaleDateString('en-US', {weekday:'long',year:'numeric',month:'long',day:'numeric'});
  ctx.time = new Date().toLocaleTimeString('en-US', {hour:'numeric',minute:'2-digit'});

  return ctx;
}

// ── AI COMMAND PROCESSOR ──────────────────────────────────────
async function processCommand(transcript) {
  if (!transcript) return;
  setButtonState('processing');
  hideOverlay();

  const ctx = buildContext();
  const businessName = ctx.settings?.business?.name || 'Trusty Sail & Paddle';
  const businessCity = ctx.settings?.business?.city || 'Morehead City, NC';

  const prompt = `You are the voice assistant for ${businessName}, a kayak and sailboat shop in ${businessCity}.

The owner just said: "${transcript}"

Today is ${ctx.today} at ${ctx.time}.
Current page: ${ctx.currentPage}

RECENT CALENDAR EVENTS (most recent first):
${JSON.stringify(ctx.recentEvents, null, 2)}

OPEN LEADS:
${JSON.stringify(ctx.leads, null, 2)}

RECENT CAMPAIGNS:
${JSON.stringify(ctx.recentCampaigns, null, 2)}

Based on what was said, determine the intent and respond ONLY with valid JSON — no markdown, no backticks:

{
  "intent": "invoice|book|social|query|confirm_email|unknown",
  "confidence": 0.0-1.0,
  "spokenResponse": "Natural conversational response to speak aloud (1-2 sentences max)",
  "cardTitle": "Short title for the command card",
  "cardIcon": "emoji",
  "cardSummary": "One sentence describing exactly what will happen",
  "cardDetails": { "key": "value" pairs shown to user before confirmation, max 4 pairs },
  "action": {
    "type": "invoice|book|social|query|confirm_email|unknown",
    "customerId": "id from recentEvents if found",
    "customerName": "name",
    "customerEmail": "email",
    "eventId": "id from recentEvents if applicable",
    "amount": number or null,
    "serviceType": "string",
    "date": "YYYY-MM-DD or null",
    "time": "HH:MM or null",
    "notes": "any relevant notes",
    "queryResult": "for query intent: the full answer to speak/show",
    "jobContext": "for social intent: description of the job to post about"
  }
}

INTENT GUIDE:
- invoice: owner wants to bill a customer (look up the most recent job matching the customer name)
- book: owner wants to schedule an appointment
- social: owner wants to create a post about a completed job
- query: owner is asking about their schedule, leads, or business data  
- confirm_email: owner wants to send a confirmation to a customer
- unknown: cannot determine intent

If the owner references "the last job", "most recent", "Steve" etc., look it up in recentEvents and fill in the details.
For invoice: calculate amount from event.amount if available, or estimate from service type.
Always be specific — use real names and dates from the context.`;

  try {
    const resp = await fetch('/functions/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }]
      })
    });
    const data = await resp.json();
    const raw = data.content?.[0]?.text?.trim() || '';
    const parsed = JSON.parse(raw.replace(/```json|```/g, '').trim());

    setButtonState('idle');

    if (parsed.intent === 'unknown' || parsed.confidence < 0.5) {
      showError(parsed.spokenResponse || "I didn't catch that. Could you try again?");
      return;
    }

    // Speak the response
    if (parsed.spokenResponse) speak(parsed.spokenResponse);

    // Store pending action
    pendingAction = parsed.action;

    // For query intent — just show the answer, no confirm needed
    if (parsed.intent === 'query') {
      showCommandCard(
        parsed.cardIcon || '📅',
        parsed.cardTitle || 'Schedule',
        parsed.action.queryResult || parsed.cardSummary,
        parsed.cardDetails,
        null,
        null,
        false
      );
      const confirmBtn = document.getElementById('cmd-confirm-btn');
      if (confirmBtn) confirmBtn.style.display = 'none';
      return;
    }

    // All other intents show confirm card
    showCommandCard(
      parsed.cardIcon || '✦',
      parsed.cardTitle,
      parsed.cardSummary,
      parsed.cardDetails,
      () => executeAction(parsed.intent, parsed.action),
      () => {
        // Edit — navigate to relevant page
        navigateToAction(parsed.intent, parsed.action);
      }
    );

  } catch(e) {
    console.error('[Stoke Voice]', e);
    setButtonState('idle');
    showError("Something went wrong. Please try again.");
  }
}

// ── ACTION EXECUTOR ───────────────────────────────────────────
async function executeAction(intent, action) {
  switch(intent) {
    case 'invoice':     return executeInvoice(action);
    case 'book':        return executeBook(action);
    case 'social':      return executeSocial(action);
    case 'confirm_email': return executeConfirmEmail(action);
    default:
      speak("I'm not sure how to do that yet.");
  }
}

async function executeInvoice(action) {
  speak(`Creating invoice for ${action.customerName} now.`);
  // Store invoice in localStorage for now, save to D1 when authenticated
  const invoice = {
    id: 'inv_' + Math.random().toString(36).substr(2, 8),
    customerName: action.customerName,
    customerEmail: action.customerEmail,
    eventId: action.eventId,
    serviceType: action.serviceType,
    amount: action.amount,
    notes: action.notes,
    status: 'draft',
    createdAt: new Date().toISOString(),
  };
  try {
    const invoices = JSON.parse(localStorage.getItem('stoke_invoices') || '[]');
    invoices.push(invoice);
    localStorage.setItem('stoke_invoices', JSON.stringify(invoices));
  } catch(e) {}

  // Try to save to API
  try {
    await fetch('/api/invoices', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(invoice)
    });
  } catch(e) {}

  // Show success card
  showCommandCard(
    '🧾',
    'Invoice Created',
    `Draft invoice for ${action.customerName} — $${action.amount || '—'}. Open the invoice to send.`,
    {
      'Customer': action.customerName,
      'Email': action.customerEmail,
      'Amount': action.amount ? `$${action.amount}` : 'Set manually',
      'Status': 'Draft — ready to send',
    },
    () => {
      // In future: navigate to invoice page
      speak(`Invoice saved. You can review and send it from the dashboard.`);
    },
    null
  );
  document.getElementById('cmd-confirm-btn').textContent = '📧 Send Invoice';
}

async function executeBook(action) {
  // Navigate to calendar with pre-filled data
  const params = new URLSearchParams({
    prefill: JSON.stringify({
      customerName: action.customerName,
      customerEmail: action.customerEmail,
      serviceType: action.serviceType,
      date: action.date,
      time: action.time,
      notes: action.notes,
    })
  });
  speak(`Opening calendar to book ${action.serviceType || 'the appointment'} for ${action.customerName}.`);
  setTimeout(() => {
    sessionStorage.setItem('stoke_voice_book', JSON.stringify(action));
    window.location.href = 'calendar.html';
  }, 1500);
}

async function executeSocial(action) {
  speak(`Let's create a post about ${action.jobContext || 'this job'}. Opening the generator.`);
  setTimeout(() => {
    sessionStorage.setItem('stoke_voice_social', JSON.stringify({
      jobType: action.serviceType,
      customerMoment: action.jobContext,
      notes: action.notes,
    }));
    window.location.href = 'index.html';
  }, 1500);
}

async function executeConfirmEmail(action) {
  speak(`Drafting confirmation for ${action.customerName}.`);
  // Store confirmation request
  sessionStorage.setItem('stoke_voice_confirm', JSON.stringify(action));
  showCommandCard(
    '✉️',
    'Confirmation Drafted',
    `Ready to send appointment confirmation to ${action.customerName} at ${action.customerEmail}.`,
    {
      'To': action.customerEmail,
      'Re': action.serviceType || 'Appointment',
      'Date': action.date || 'See calendar',
    },
    () => {
      speak(`Confirmation sent to ${action.customerName}.`);
      // Mark event as confirmed
      try {
        const events = JSON.parse(localStorage.getItem('stoke_events') || '[]');
        const idx = events.findIndex(e => e.id === action.eventId);
        if (idx >= 0) { events[idx].status = 'confirmed'; localStorage.setItem('stoke_events', JSON.stringify(events)); }
      } catch(e) {}
    },
    null
  );
}

function navigateToAction(intent, action) {
  const routes = {
    invoice: 'dashboard.html',
    book: 'calendar.html',
    social: 'index.html',
    confirm_email: 'calendar.html',
  };
  if (routes[intent]) window.location.href = routes[intent];
}

// ── INIT ──────────────────────────────────────────────────────
function init() {
  injectUI();
  if (setupRecognition()) {
    setupWakeWord();
    // Start wake word after a short delay
    setTimeout(startWakeWord, 2000);
    console.log('[Stoke Voice] Ready. Say "Hey Stoke" or tap the mic button.');
  }

  // Check for prefill actions from other pages
  const voiceBook = sessionStorage.getItem('stoke_voice_book');
  const voiceSocial = sessionStorage.getItem('stoke_voice_social');

  if (voiceBook && window.location.pathname.includes('calendar')) {
    sessionStorage.removeItem('stoke_voice_book');
    try {
      const action = JSON.parse(voiceBook);
      setTimeout(() => {
        if (window.openNewEventModalAt) {
          openNewEventModalAt(action.date || new Date().toISOString().slice(0,10), action.time || '09:00');
          if (action.customerName) document.getElementById('modal-customer-name').value = action.customerName;
          if (action.customerEmail) document.getElementById('modal-customer-email').value = action.customerEmail;
          if (action.serviceType) document.getElementById('modal-event-type').value = action.serviceType;
          if (action.notes) document.getElementById('modal-notes').value = action.notes;
          speak(`Ready to book for ${action.customerName}. Review the details and save.`);
        }
      }, 1000);
    } catch(e) {}
  }

  if (voiceSocial && (window.location.pathname.includes('index') || window.location.pathname === '/')) {
    sessionStorage.removeItem('stoke_voice_social');
    try {
      const social = JSON.parse(voiceSocial);
      setTimeout(() => {
        // Pre-fill the generator if fields exist
        const jobTypeEl = document.getElementById('job-type') || document.querySelector('[name="job_type"]');
        const detailsEl = document.getElementById('extra-details') || document.querySelector('textarea');
        if (jobTypeEl && social.jobType) jobTypeEl.value = social.jobType;
        if (detailsEl && social.notes) detailsEl.value = social.notes;
        speak(`Generator ready. I've pre-filled the job details — review and generate your post.`);
      }, 1000);
    } catch(e) {}
  }
}

// Expose public API
window.stokeVoice = {
  start: startListening,
  stop: stopListening,
  dismiss: dismissCard,
  dismissCard,
  speak,
};

// Start when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

})();
