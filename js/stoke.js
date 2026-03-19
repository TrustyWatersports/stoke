/**
 * stoke.js — Core application logic v8.2
 *
 * New in v8.2:
 *   1. STREAMING — posts render progressively as AI generates them.
 *      Each ===DAY=== block is parsed and rendered as it completes.
 *      No more watching a spinner for 20 seconds.
 *
 *   2. CALENDAR DRAG-AND-DROP — drag any day's posts to a different
 *      calendar date to reschedule. The calendar updates live.
 *      Each post stores a scheduledDate that overrides the default offset.
 *
 *   3. PHOTO-TO-POST MATCHING — each uploaded photo is labeled (Photo 1,
 *      Photo 2, etc.) The AI writes each day's hero post specifically about
 *      one photo, and that photo is locked to that post card. You can still
 *      tap to change it, but the default pairing is intentional.
 */

// ── SETTINGS ──────────────────────────────────────────────────────────────
function loadSettings() {
  try { const r = localStorage.getItem('stoke_settings'); return r ? JSON.parse(r) : null; }
  catch (e) { return null; }
}

const SETTING_DEFAULTS = {
  business: {
    name: 'Trusty Sail & Paddle', tagline: 'Crystal Coast kayak and sailboat experts',
    city: 'Morehead City, NC', area: 'Crystal Coast',
    specialty: 'Custom kayak rigging, US distributor for Topper & Topaz sailboats, tournament fishing',
    phone: '(252) 499-9911', website: 'trustysailandpaddle.com',
  },
  hashtags: ['#TrustySailPaddle','#CrystalCoast','#MoreheadCity','#KayakFishing','#Sailing'],
  voice: {
    generalDesc:  'Write clearly and directly. Lead with the most compelling specific fact or result. Use concrete details — numbers, names, products, real outcomes. Professional but warm. No emoji.',
    authorName:   'Heather Fournel',
    personalDesc: "Write in Heather Fournel's full authentic voice. Open with the reader's emotional world or a vivid human scene — NEVER with a product or price. Alternate short punchy sentences with longer flowing sentences. End with a crystallized memorable line. No emoji. Commerce is always the vehicle, never the point.",
    emoji: false, prices: true, phone: true, names: true,
  },
  content: {
    jobTypes:        ['Custom Rigging Build','Kayak Sale','Demo Day Event','Rental or Tour','Sailboat Sale or Lesson','Repair or Service'],
    angles:          ['Action & Energy','Product Detail','Customer Story','Values & Why','Community Call','Throwback & Reflect'],
    defaultDays:     3,
    defaultChannels: ['INSTAGRAM','FACEBOOK','GOOGLE','EMAIL'],
  },
};

function getSettings() {
  const s = loadSettings();
  if (!s) return SETTING_DEFAULTS;
  return {
    business:   { ...SETTING_DEFAULTS.business,  ...(s.business  || {}) },
    hashtags:   s.hashtags || SETTING_DEFAULTS.hashtags,
    voice:      { ...SETTING_DEFAULTS.voice,     ...(s.voice     || {}) },
    content:    { ...SETTING_DEFAULTS.content,   ...(s.content   || {}) },
    appearance: s.appearance || {},
  };
}

// ── STATE ─────────────────────────────────────────────────────────────────
const state = {
  jobTypes: [], channels: ['INSTAGRAM','FACEBOOK','GOOGLE','EMAIL'],
  tone: 'general', campaignDays: 3,
  photos: [],       // Array<{ dataUrl, name, label }>
  campaign: [],     // Array<{ day, scheduledDate, posts }>
  campaignMeta: null,
  sessionId: Math.random().toString(36).substr(2, 12),
  dragSource: null, // { dayIdx } — which day is being dragged on calendar
};

const PLATFORM_COLORS = {
  INSTAGRAM:'#E1306C', FACEBOOK:'#1877F2', TIKTOK:'#010101',
  GOOGLE:'#4285F4', EMAIL:'#1a6b4a', YOUTUBE:'#FF0000',
};
const PLATFORM_LABELS = {
  INSTAGRAM:'Instagram', FACEBOOK:'Facebook', TIKTOK:'TikTok / Reels',
  GOOGLE:'Google Business', EMAIL:'Customer Email', YOUTUBE:'YouTube Shorts',
};

let streamBuffer  = ''; // accumulates raw SSE text during streaming
let streamRendered = new Set(); // day numbers already rendered

// ── PHOTOS ────────────────────────────────────────────────────────────────
function resizeImage(file, maxW, quality, callback) {
  const reader = new FileReader();
  reader.onload = (e) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      let w = img.width, h = img.height;
      if (w > maxW) { h = Math.round(h * maxW / w); w = maxW; }
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      callback(canvas.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => callback(e.target.result);
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

function handlePhotoSelect(e) {
  const remaining = 6 - state.photos.length;
  Array.from(e.target.files).slice(0, remaining).forEach(file => {
    resizeImage(file, 1024, 0.75, dataUrl => {
      const idx = state.photos.length + 1;
      state.photos.push({ dataUrl, name: file.name, label: `Photo ${idx}` });
      renderPreviews();
    });
  });
}

function removePhoto(i) {
  state.photos.splice(i, 1);
  // Re-label remaining photos
  state.photos.forEach((p, idx) => { p.label = `Photo ${idx + 1}`; });
  renderPreviews();
}

function renderPreviews() {
  const container = document.getElementById('photo-previews');
  const countEl   = document.getElementById('photo-count');
  const zone      = document.getElementById('photo-zone');
  const indicator = document.getElementById('photo-indicator');
  container.innerHTML = '';
  state.photos.forEach((p, i) => {
    const thumb = document.createElement('div');
    thumb.className = 'photo-thumb';
    thumb.innerHTML = `
      <img src="${p.dataUrl}" alt="${p.label}">
      <div class="photo-label">${p.label}</div>
      <button class="remove-photo" onclick="removePhoto(${i})" aria-label="Remove photo">&#x2715;</button>`;
    container.appendChild(thumb);
  });
  if (state.photos.length > 0) {
    zone.classList.add('has-photos');
    countEl.innerHTML = `<div style="margin-top:10px"><span class="photo-count-badge">&#10003; ${state.photos.length} photo${state.photos.length>1?'s':''} — each matched to a post</span></div>`;
    indicator.textContent = state.photos.length + ' photo' + (state.photos.length>1?'s':'');
    indicator.style.display = 'inline-block';
  } else {
    zone.classList.remove('has-photos');
    countEl.innerHTML = '';
    indicator.style.display = 'none';
  }
}

function getBase64(dataUrl) { try { return dataUrl.split(',')[1]||''; } catch(e) { return ''; } }
function getMediaType(dataUrl) {
  try {
    const m = dataUrl.match(/data:([^;]+);/);
    const t = m ? m[1] : 'image/jpeg';
    return (t==='image/heic'||t==='image/heif') ? 'image/jpeg' : t;
  } catch(e) { return 'image/jpeg'; }
}
function getValidPhotos() {
  return state.photos.filter(p => { try { return getBase64(p.dataUrl).length > 1000; } catch(e) { return false; } });
}

// ── FORM ──────────────────────────────────────────────────────────────────
function applySettingsToForm() {
  const settings = getSettings();
  const content  = settings.content || {};
  const jobGrid  = document.getElementById('job-type-grid');
  if (jobGrid) {
    jobGrid.innerHTML = (content.jobTypes || SETTING_DEFAULTS.content.jobTypes)
      .map(jt => `<button class="toggle-btn" data-val="${escHtml(jt)}" onclick="toggleJobType(this)">${escHtml(jt)}</button>`)
      .join('');
  }
  const defaultCh = content.defaultChannels || SETTING_DEFAULTS.content.defaultChannels;
  state.channels = [...defaultCh];
  document.querySelectorAll('[data-channel]').forEach(btn => {
    btn.classList.toggle('selected', defaultCh.includes(btn.dataset.channel));
  });
  updateSelectionCount('channel-count', state.channels.length);
  const defaultDays = content.defaultDays || 3;
  state.campaignDays = defaultDays;
  document.querySelectorAll('[data-days]').forEach(btn => {
    btn.classList.toggle('selected', parseInt(btn.dataset.days) === defaultDays);
  });
  if (settings.appearance?.colorPrimary) document.documentElement.style.setProperty('--green', settings.appearance.colorPrimary);
  if (settings.appearance?.colorAccent)  document.documentElement.style.setProperty('--green-mid', settings.appearance.colorAccent);
}

function toggleJobType(btn) {
  btn.classList.toggle('selected');
  const v = btn.dataset.val;
  state.jobTypes = btn.classList.contains('selected') ? [...state.jobTypes, v] : state.jobTypes.filter(x => x !== v);
  updateSelectionCount('job-type-count', state.jobTypes.length);
}
function toggleChannel(btn) {
  btn.classList.toggle('selected');
  const c = btn.dataset.channel;
  state.channels = btn.classList.contains('selected') ? [...state.channels, c] : state.channels.filter(x => x !== c);
  updateSelectionCount('channel-count', state.channels.length);
}
function selectTone(tone) {
  state.tone = tone;
  document.getElementById('tone-general').classList.toggle('selected', tone==='general');
  document.getElementById('tone-personal').classList.toggle('selected', tone==='personal');
}
function selectCampaignLength(btn) {
  document.querySelectorAll('[data-days]').forEach(b => b.classList.remove('selected'));
  btn.classList.add('selected');
  state.campaignDays = parseInt(btn.dataset.days);
}
function updateSelectionCount(id, count) {
  const el = document.getElementById(id);
  if (el) el.textContent = count > 0 ? `${count} selected` : '';
}

// ── GENERATE — streaming ───────────────────────────────────────────────────
async function generateContent() {
  const customerMoment = document.getElementById('customer-moment').value.trim();
  const productsUsed   = document.getElementById('products-used').value.trim();
  const problemSolved  = document.getElementById('problem-solved').value.trim();
  const extraDetails   = document.getElementById('extra-details').value.trim();
  const startDate      = document.getElementById('start-date').value.trim() || 'Today';
  const jobType        = state.jobTypes.length > 0 ? state.jobTypes.join(', ') : '';

  if (!customerMoment && !productsUsed && state.photos.length === 0) {
    showError('Please add at least one photo or describe the job before generating.'); return;
  }
  if (state.channels.length === 0) {
    showError('Please select at least one output channel.'); return;
  }

  const validPhotos = getValidPhotos();
  const msgContent  = [];

  // Send photos in order — AI will write Photo N post about image N
  validPhotos.forEach(photo => {
    try {
      msgContent.push({ type:'image', source:{ type:'base64', media_type:getMediaType(photo.dataUrl), data:getBase64(photo.dataUrl) } });
    } catch(e) { console.warn('[Stoke] Skipping photo:', photo.name, e.message); }
  });

  const settings = getSettings();
  const prompt = window.StokePrompts.buildCampaignPrompt({
    jobType, customerMoment, productsUsed, problemSolved, extraDetails, startDate,
    channels: state.channels, tone: state.tone, campaignDays: state.campaignDays,
    validPhotoCount: validPhotos.length,
    photoLabels: validPhotos.map(p => p.label), // pass labels for matching
    businessName:    settings.business?.name     || '',
    businessArea:    settings.business?.area     || '',
    businessCity:    settings.business?.city     || '',
    businessPhone:   settings.business?.phone    || '',
    businessWebsite: settings.business?.website  || '',
    specialty:       settings.business?.specialty || '',
    defaultHashtags: settings.hashtags || [],
    voiceGeneral:    settings.voice?.generalDesc  || '',
    voicePersonal:   settings.voice?.personalDesc || '',
    voiceAuthor:     settings.voice?.authorName   || '',
    useEmoji:        settings.voice?.emoji        || false,
    angles:          settings.content?.angles     || SETTING_DEFAULTS.content.angles,
  });
  msgContent.push({ type:'text', text:prompt });

  // Reset state
  state.campaign     = [];
  state.campaignMeta = null;
  streamBuffer       = '';
  streamRendered     = new Set();

  // UI — show results section immediately (empty) + loading indicator
  document.getElementById('generate-btn').disabled = true;
  document.getElementById('error-msg').style.display = 'none';
  document.getElementById('form-section').style.display = 'none';
  document.getElementById('posts-list').innerHTML = '';
  document.getElementById('calendar-grid').innerHTML = '';
  document.getElementById('cal-header').innerHTML = '';
  document.getElementById('results-subtitle').textContent = 'Generating your campaign...';
  document.getElementById('campaign-count').textContent = '';
  document.getElementById('results-section').style.display = 'block';

  // Show streaming indicator at top
  const streamStatus = document.getElementById('stream-status');
  if (streamStatus) { streamStatus.style.display = 'flex'; streamStatus.textContent = '✦ Writing Day 1...'; }

  if (validPhotos.length > 0) {
    // Show photo thumbnails in the status bar
    if (streamStatus) {
      streamStatus.innerHTML = validPhotos.map(p =>
        `<img src="${p.dataUrl}" style="width:28px;height:28px;border-radius:4px;object-fit:cover;opacity:.7">`
      ).join('') + '<span style="margin-left:8px">Writing your campaign...</span>';
    }
  }

  window.scrollTo({ top: 0, behavior: 'smooth' });

  try {
    const resp = await fetch('/functions/generate/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-session-id': state.sessionId },
      body: JSON.stringify({ messages: [{ role: 'user', content: msgContent }] }),
    });

    if (!resp.ok) {
      let errData;
      try { errData = await resp.json(); } catch(e) { errData = { error:{ code:'NETWORK_ERROR', message:resp.statusText } }; }
      const code = errData.error?.code || 'UNKNOWN';
      const friendly = {
        MISSING_API_KEY:'Server configuration error — contact support.',
        PAYLOAD_TOO_LARGE:'Photos are too large. Try uploading fewer photos.',
        ANTHROPIC_API_ERROR:'Could not reach the AI service — please try again.',
        INVALID_REQUEST_BODY:'Request error — please try again.',
      };
      throw new Error(friendly[code] || errData.error?.message || 'Unknown error');
    }

    // Read the SSE stream
    const reader = resp.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      processStreamChunk(chunk, validPhotos, startDate);
    }

    // Stream complete — finalize
    if (streamStatus) streamStatus.style.display = 'none';

    // Parse any remaining buffer
    if (streamBuffer.trim()) {
      const finalDays = parseCampaign(streamBuffer);
      finalDays.forEach(d => {
        if (!streamRendered.has(d.day)) {
          addDayToState(d, startDate);
          renderDay(d, validPhotos);
          streamRendered.add(d.day);
        }
      });
    }

    if (state.campaign.length === 0) {
      throw new Error('Content generated but could not be parsed. Please try again.');
    }

    // Finalize UI
    const totalPosts = state.campaign.reduce((a,d) => a+d.posts.length, 0);
    document.getElementById('results-subtitle').textContent =
      `${jobType||'Job'} — ${totalPosts} post${totalPosts!==1?'s':''} across ${state.campaign.length} day${state.campaign.length!==1?'s':''} · ${state.tone==='personal'?'Personal':'General'} style`;
    document.getElementById('campaign-count').textContent =
      `${totalPosts} post${totalPosts!==1?'s':''} ready to review`;

    state.campaignMeta = { jobType, customerMoment, productsUsed, startDate, tone:state.tone, days:state.campaignDays, generatedAt:new Date().toISOString() };
    saveToHistory(state.campaign, state.campaignMeta);

    renderCalendar();
    document.getElementById('generate-btn').disabled = false;

  } catch(e) {
    if (streamStatus) streamStatus.style.display = 'none';
    document.getElementById('results-section').style.display = 'none';
    document.getElementById('form-section').style.display = 'block';
    document.getElementById('generate-btn').disabled = false;
    showError(e.message);
    console.error('[Stoke] Stream error:', e);
  }
}

/**
 * processStreamChunk — handles incoming SSE data
 * Anthropic SSE format:
 *   event: content_block_delta
 *   data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"..."}}
 */
function processStreamChunk(chunk, validPhotos, startDate) {
  const lines = chunk.split('\n');
  for (const line of lines) {
    if (!line.startsWith('data: ')) continue;
    const dataStr = line.slice(6).trim();
    if (dataStr === '[DONE]') return;
    try {
      const data = JSON.parse(dataStr);
      if (data.type === 'content_block_delta' && data.delta?.type === 'text_delta') {
        streamBuffer += data.delta.text;
        tryRenderCompletedDays(validPhotos, startDate);
      }
    } catch(e) { /* incomplete JSON chunk, continue */ }
  }
}

/**
 * tryRenderCompletedDays — checks if a complete day block is in the buffer
 * A day is complete when the NEXT ===DAY=== marker appears, or stream ends.
 */
function tryRenderCompletedDays(validPhotos, startDate) {
  // Find all day markers
  const dayMarkers = [...streamBuffer.matchAll(/===DAY(\d+)===/g)];
  if (dayMarkers.length < 2) return; // need at least 2 markers to know first day is complete

  // Render all complete days (all but the last marker, which may still be streaming)
  for (let i = 0; i < dayMarkers.length - 1; i++) {
    const dayNum = parseInt(dayMarkers[i][1]);
    if (streamRendered.has(dayNum)) continue;

    const start = dayMarkers[i].index;
    const end   = dayMarkers[i + 1].index;
    const block = streamBuffer.slice(start, end);

    const parsed = parseCampaign(block);
    if (parsed.length > 0) {
      const dayData = parsed[0];
      addDayToState(dayData, startDate);
      renderDay(dayData, validPhotos);
      streamRendered.add(dayNum);

      // Update streaming status
      const nextDayNum = parseInt(dayMarkers[i + 1]?.[1] || dayNum + 1);
      const statusEl = document.getElementById('stream-status');
      if (statusEl) statusEl.textContent = `✦ Writing Day ${nextDayNum}...`;
    }
  }
}

function addDayToState(dayData, startDate) {
  const scheduledDate = getDateFromOffset(dayData.day);
  state.campaign.push({ ...dayData, scheduledDate });
}

// ── PARSE ─────────────────────────────────────────────────────────────────
function parseCampaign(text) {
  const days = [];
  const blocks = text.split(/===DAY(\d+)===/);
  for (let i = 1; i < blocks.length; i += 2) {
    const dayNum = parseInt(blocks[i]);
    const block  = blocks[i+1] || '';
    let angle = 'General';
    const angleMatch = block.match(/ANGLE:\s*(.+)/);
    if (angleMatch) angle = angleMatch[1].trim();
    // Extract photo assignment hint if AI included it
    let photoHint = null;
    const photoMatch = block.match(/PHOTO:\s*(\d+)/i);
    if (photoMatch) photoHint = parseInt(photoMatch[1]) - 1; // 0-indexed
    const posts = [];
    const parts = block.split(/---([A-Z]+)---/);
    for (let j = 1; j < parts.length; j += 2) {
      const channel = parts[j].trim();
      let body = parts[j+1] || '';
      body = body.replace(/ANGLE:\s*.+\n?/g, '');
      body = body.replace(/PHOTO:\s*\d+\n?/gi, '');
      body = body.replace(/^\*{1,2}[A-Z][A-Z\s\/]+\*{1,2}\n+/gm, '');
      body = body.replace(/^(INSTAGRAM|FACEBOOK|TIKTOK|GOOGLE|EMAIL|YOUTUBE)\s*[:]\s*\n+/gim, '');
      body = body.replace(/^\s*\[.*?\]\s*\n?/, '');
      body = body.trim();
      if (body && body.length > 10) posts.push({ channel, angle, text: body, photoHint });
    }
    if (posts.length > 0) days.push({ day: dayNum, posts });
  }
  return days;
}

// ── RENDER — progressive ───────────────────────────────────────────────────
/**
 * renderDay — renders a single day's cards immediately as it completes streaming.
 * Called progressively during streaming, not all at once at the end.
 */
function renderDay(dayData, validPhotos) {
  const container = document.getElementById('posts-list');
  const MON    = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const DNAMES = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

  // Find the scheduled date for this day (may have been dragged)
  const stateDay = state.campaign.find(d => d.day === dayData.day);
  const date = stateDay?.scheduledDate || getDateFromOffset(dayData.day);

  // Check if section already exists (in case of re-render)
  let section = document.getElementById(`day-${dayData.day}`);
  if (!section) {
    section = document.createElement('div');
    section.className = 'day-section'; section.id = `day-${dayData.day}`;
    // Insert in day-number order
    const sections = Array.from(container.querySelectorAll('.day-section'));
    const after = sections.find(s => {
      const sDay = parseInt(s.id.replace('day-', ''));
      return sDay > dayData.day;
    });
    if (after) container.insertBefore(section, after);
    else container.appendChild(section);
  }
  section.innerHTML = '';

  const hdr = document.createElement('div');
  hdr.className = 'day-header'; hdr.id = `day-section-${dayData.day}`;
  hdr.innerHTML = `<span class="day-badge">Day ${dayData.day} — ${DNAMES[date.getDay()]} ${MON[date.getMonth()]} ${date.getDate()}</span><div class="day-line"></div>`;
  section.appendChild(hdr);

  // Animate section in
  section.style.opacity = '0';
  section.style.transform = 'translateY(8px)';
  requestAnimationFrame(() => {
    section.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
    section.style.opacity = '1';
    section.style.transform = 'translateY(0)';
  });

  dayData.posts.forEach(({ channel, angle, text, photoHint }, postIdx) => {
    const color  = PLATFORM_COLORS[channel] || '#888';
    const label  = PLATFORM_LABELS[channel] || channel;
    const cardId = `card-${dayData.day}-${postIdx}`;
    const textId = `text-${cardId}`;

    // Photo matching:
    // - If AI specified a photo hint, use it
    // - Otherwise rotate through photos by day index (not post index)
    const dayIdx = state.campaign.findIndex(d => d.day === dayData.day);
    const safeHint = (photoHint !== null && photoHint < validPhotos.length) ? photoHint : null;
    const featuredIdx = safeHint !== null ? safeHint : (dayIdx % Math.max(validPhotos.length, 1));
    const featuredPhoto = validPhotos.length > 0 ? validPhotos[featuredIdx] : null;

    const photoStripHtml = validPhotos.length > 0 ? `
      <div class="photo-strip" role="group" aria-label="Select featured photo">
        ${validPhotos.map((p, pi) => `
          <div class="photo-strip-item${pi === featuredIdx ? ' featured' : ''}">
            <img src="${p.dataUrl}"
              class="photo-strip-thumb${pi === featuredIdx ? ' featured' : ''}"
              onclick="featurePhoto(this,'${cardId}')"
              title="${p.label}"
              alt="${p.label}">
            <span class="photo-strip-label">${p.label}</span>
          </div>`).join('')}
        <span class="photo-strip-hint">Tap to change</span>
      </div>
      <div class="featured-wrap" id="feat-${cardId}" style="display:block">
        <img src="${featuredPhoto.dataUrl}" alt="Featured: ${featuredPhoto.label}">
        <div class="featured-photo-label" id="feat-label-${cardId}">${featuredPhoto.label}</div>
      </div>` : '';

    const card = document.createElement('div');
    card.className = 'content-card'; card.id = cardId;
    card.innerHTML = `
      <div class="card-header">
        <div class="platform-badge">
          <div class="platform-dot" style="background:${color}" aria-hidden="true"></div>
          <span>${label}</span>
        </div>
        <div class="card-right">
          <span class="angle-tag">${angle}</span>
          <button class="copy-btn" onclick="copyCard('${textId}')" aria-label="Copy ${label} post">Copy</button>
        </div>
      </div>
      ${photoStripHtml}
      <div class="content-text" id="${textId}">${escHtml(text)}</div>
      <div class="approval-row">
        <button class="approve-btn" onclick="approveCard(this,'${cardId}','${label}')">Approve</button>
        <button class="edit-btn" onclick="editCard('${textId}')">Edit</button>
        <button class="discard-btn" onclick="discardCard('${cardId}')">Discard</button>
      </div>`;
    section.appendChild(card);
  });

  // Scroll to newly rendered day
  section.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// ── CALENDAR with drag-and-drop scheduling ────────────────────────────────
/**
 * Calendar drag-and-drop:
 *   - Campaign day sections are draggable (drag handle on day-badge)
 *   - Calendar cells are drop targets
 *   - Dropping a day onto a cell updates that day's scheduledDate
 *   - The calendar re-renders to reflect the new schedule
 *   - The posts-list section date label updates too
 */
function renderCalendar() {
  const DAY_NAMES = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const MON_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  document.getElementById('cal-header').innerHTML =
    DAY_NAMES.map(d => `<div class="cal-day-name">${d}</div>`).join('');

  const grid = document.getElementById('calendar-grid');
  grid.innerHTML = '';

  // Build date → campaign day map using scheduledDates
  const dateMap = {};
  state.campaign.forEach(d => {
    const key = d.scheduledDate.toDateString();
    if (!dateMap[key]) dateMap[key] = [];
    dateMap[key].push(d);
  });

  const today    = new Date();
  const startDow = today.getDay();

  for (let i = 0; i < startDow; i++) {
    const cell = document.createElement('div'); cell.className = 'cal-cell cal-pad'; grid.appendChild(cell);
  }

  for (let i = 0; i < 14; i++) {
    const date  = new Date(today); date.setDate(today.getDate() + i);
    const key   = date.toDateString();
    const days  = dateMap[key] || [];
    const cell  = document.createElement('div');

    cell.className = 'cal-cell' + (days.length > 0 ? ' has-posts' : '');
    cell.setAttribute('role', days.length > 0 ? 'button' : 'presentation');
    cell.dataset.dateKey = key;
    cell.dataset.dateOffset = i;

    const dateEl = `<div class="cal-date">${MON_NAMES[date.getMonth()]} ${date.getDate()}</div>`;

    if (days.length > 0) {
      const dots = days.flatMap(d => d.posts).map(p =>
        `<div class="cal-dot" style="background:${PLATFORM_COLORS[p.channel]||'#888'}" title="${PLATFORM_LABELS[p.channel]||p.channel}"></div>`
      ).join('');
      const total = days.reduce((a,d) => a+d.posts.length, 0);
      cell.innerHTML = `${dateEl}<div class="cal-dots">${dots}</div><div class="cal-post-count">${total} post${total!==1?'s':''}</div>`;
      cell.onclick = () => scrollToDay(days[0].day);
    } else {
      cell.innerHTML = dateEl;
    }

    // Drop target — drag any day's posts here to reschedule
    cell.addEventListener('dragover', e => {
      e.preventDefault();
      cell.classList.add('drag-over');
    });
    cell.addEventListener('dragleave', () => cell.classList.remove('drag-over'));
    cell.addEventListener('drop', e => {
      e.preventDefault();
      cell.classList.remove('drag-over');
      if (state.dragSource === null) return;
      // Move the dragged day to this date
      const targetDate = new Date(today);
      targetDate.setDate(today.getDate() + i);
      const dayEntry = state.campaign[state.dragSource];
      if (dayEntry) {
        dayEntry.scheduledDate = targetDate;
        renderCalendar();
        renderAllDayHeaders();
      }
      state.dragSource = null;
    });

    grid.appendChild(cell);
  }
}

function renderAllDayHeaders() {
  // Update date labels in the posts list after a drag-and-drop reschedule
  const MON    = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const DNAMES = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  state.campaign.forEach((d, idx) => {
    const hdr = document.getElementById(`day-section-${d.day}`);
    if (hdr) {
      const badge = hdr.querySelector('.day-badge');
      if (badge) badge.textContent = `Day ${d.day} — ${DNAMES[d.scheduledDate.getDay()]} ${MON[d.scheduledDate.getMonth()]} ${d.scheduledDate.getDate()} (rescheduled)`;
    }
    // Make day badge draggable
    const section = document.getElementById(`day-${d.day}`);
    if (section) {
      section.draggable = true;
      section.addEventListener('dragstart', () => { state.dragSource = idx; section.style.opacity = '0.5'; });
      section.addEventListener('dragend',   () => { state.dragSource = null; section.style.opacity = '1'; });
    }
  });
}

function scrollToDay(dayNum) {
  const el = document.getElementById(`day-${dayNum}`);
  if (el) el.scrollIntoView({ behavior:'smooth', block:'start' });
  document.querySelectorAll('.day-section').forEach(s => s.style.opacity = '0.5');
  setTimeout(() => { const t = document.getElementById(`day-section-${dayNum}`); if(t) t.style.opacity='1'; }, 300);
}

function getDateFromOffset(offset) {
  const d = new Date(); d.setDate(d.getDate() + offset - 1); return d;
}

// ── CARD ACTIONS ──────────────────────────────────────────────────────────
function featurePhoto(img, cardId) {
  // Update strip selection
  const strip = img.closest('.photo-strip');
  if (strip) {
    strip.querySelectorAll('.photo-strip-item').forEach(item => item.classList.remove('featured'));
    strip.querySelectorAll('.photo-strip-thumb').forEach(t => t.classList.remove('featured'));
    img.classList.add('featured');
    img.closest('.photo-strip-item')?.classList.add('featured');
  }
  // Update featured display
  const wrap = document.getElementById(`feat-${cardId}`);
  if (wrap) {
    wrap.style.display = 'block';
    wrap.querySelector('img').src = img.src;
    // Update label
    const labelEl = document.getElementById(`feat-label-${cardId}`);
    if (labelEl) labelEl.textContent = img.alt;
  }
}

function approveCard(btn, cardId, label) {
  document.getElementById(cardId).classList.add('approved');
  btn.parentElement.innerHTML = `<span class="approved-badge">&#10003; Approved for ${label}</span>`;
}
function approveAll() {
  document.querySelectorAll('.approve-btn').forEach(b => { if(b.closest('.content-card')) b.click(); });
}
function editCard(textId) {
  const el  = document.getElementById(textId);
  const cur = el.textContent;
  el.innerHTML = `<textarea style="width:100%;font-family:'DM Sans',sans-serif;font-size:14px;line-height:1.75;border:none;outline:none;background:transparent;resize:vertical;color:var(--text);padding:0" rows="${Math.max(4,cur.split('\n').length+2)}" aria-label="Edit post content">${cur}</textarea>`;
  el.querySelector('textarea').focus();
}
function discardCard(cardId) { document.getElementById(cardId).classList.add('discarded'); }
function copyCard(textId) {
  const el  = document.getElementById(textId);
  const btn = document.querySelector(`[onclick="copyCard('${textId}')"]`);
  navigator.clipboard.writeText(el.textContent).then(() => {
    if (btn) { btn.textContent='Copied!'; btn.classList.add('copied'); setTimeout(()=>{ btn.textContent='Copy'; btn.classList.remove('copied'); }, 2000); }
  }).catch(() => {
    const range = document.createRange(); range.selectNode(el);
    window.getSelection().removeAllRanges(); window.getSelection().addRange(range);
  });
}

// ── HISTORY ───────────────────────────────────────────────────────────────
const HISTORY_KEY = 'stoke_history';
const HISTORY_MAX = 20;

function loadHistory() {
  try { const r = localStorage.getItem(HISTORY_KEY); return r ? JSON.parse(r) : []; } catch(e) { return []; }
}
function saveToHistory(campaign, meta) {
  try {
    const history = loadHistory();
    // Strip scheduledDate (Date objects don't serialize well) — use day offset instead
    const serializableCampaign = campaign.map(d => ({
      day: d.day, posts: d.posts,
      scheduledDateStr: d.scheduledDate?.toISOString(),
    }));
    history.unshift({ id: Date.now().toString(36), meta:{ ...meta }, campaign: serializableCampaign });
    if (history.length > HISTORY_MAX) history.splice(HISTORY_MAX);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
    updateHistoryBadge(history.length);
  } catch(e) { console.warn('[Stoke] Could not save history:', e.message); }
}
function updateHistoryBadge(count) {
  const badge = document.getElementById('history-badge');
  if (badge) { badge.textContent = count; badge.style.display = count > 0 ? 'inline-flex' : 'none'; }
}
function openHistory() {
  document.getElementById('history-panel').classList.add('open');
  document.getElementById('history-panel').style.right = '0';
  document.getElementById('history-overlay').style.display = 'block';
  renderHistoryList();
}
function closeHistory() {
  const panel = document.getElementById('history-panel');
  panel.classList.remove('open');
  panel.style.right = '-380px';
  document.getElementById('history-overlay').style.display = 'none';
}
function renderHistoryList() {
  const history   = loadHistory();
  const container = document.getElementById('history-list');
  const MON       = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  if (history.length === 0) {
    container.innerHTML = `<div style="padding:2rem;text-align:center;color:var(--text-3);font-size:13px">No campaigns yet. Generate your first one!</div>`;
    return;
  }
  container.innerHTML = history.map((entry, idx) => {
    const date    = new Date(entry.meta.generatedAt || Date.now());
    const dStr    = `${MON[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`;
    const tStr    = date.toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' });
    const total   = entry.campaign.reduce((a,d) => a+(d.posts?.length||0), 0);
    const days    = entry.campaign.length;
    const channels = [...new Set(entry.campaign.flatMap(d => (d.posts||[]).map(p => p.channel)))];
    return `
      <div class="history-item" onclick="restoreFromHistory(${idx})">
        <div class="history-item-header">
          <span class="history-job">${escHtml(entry.meta.jobType||'Job')}</span>
          <span class="history-date">${dStr} · ${tStr}</span>
        </div>
        <div class="history-meta">${total} post${total!==1?'s':''} · ${days} day${days!==1?'s':''} · ${entry.meta.tone==='personal'?'Personal':'General'}</div>
        ${entry.meta.customerMoment ? `<div class="history-preview">${escHtml(entry.meta.customerMoment.substring(0,80))}${entry.meta.customerMoment.length>80?'…':''}</div>` : ''}
        <div class="history-channels">${channels.map(ch=>`<span class="history-ch-dot" style="background:${PLATFORM_COLORS[ch]||'#888'}" title="${PLATFORM_LABELS[ch]||ch}"></span>`).join('')}</div>
      </div>`;
  }).join('');
}
function restoreFromHistory(idx) {
  const entry = loadHistory()[idx];
  if (!entry) return;
  closeHistory();
  // Restore campaign with scheduledDates
  state.campaign = entry.campaign.map(d => ({
    ...d,
    scheduledDate: d.scheduledDateStr ? new Date(d.scheduledDateStr) : getDateFromOffset(d.day),
  }));
  state.campaignMeta = entry.meta;
  state.tone   = entry.meta.tone || 'general';
  state.photos = [];
  document.getElementById('form-section').style.display = 'none';
  document.getElementById('posts-list').innerHTML = '';
  state.campaign.forEach(d => renderDay(d, []));
  renderCalendar();
  renderAllDayHeaders();
  const totalPosts = state.campaign.reduce((a,d) => a+d.posts.length, 0);
  document.getElementById('results-subtitle').textContent =
    `${entry.meta.jobType||'Job'} — ${totalPosts} posts · Restored from history`;
  document.getElementById('campaign-count').textContent = `${totalPosts} posts`;
  document.getElementById('results-section').style.display = 'block';
  window.scrollTo({ top:0, behavior:'smooth' });
}
function clearHistory() {
  if (!confirm('Clear all campaign history? This cannot be undone.')) return;
  localStorage.removeItem(HISTORY_KEY);
  updateHistoryBadge(0);
  renderHistoryList();
}

// ── UTILS ─────────────────────────────────────────────────────────────────
function escHtml(s) {
  return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function showError(msg) {
  const el = document.getElementById('error-msg');
  el.textContent = msg; el.style.display = 'block';
  el.scrollIntoView({ behavior:'smooth', block:'nearest' });
}
function resetForm() {
  document.getElementById('form-section').style.display = 'block';
  document.getElementById('results-section').style.display = 'none';
  document.getElementById('error-msg').style.display = 'none';
  document.getElementById('generate-btn').disabled = false;
  state.jobTypes = []; state.photos = []; state.campaign = [];
  streamBuffer = ''; streamRendered = new Set();
  document.querySelectorAll('[data-val].selected').forEach(b => b.classList.remove('selected'));
  renderPreviews();
  updateSelectionCount('job-type-count', 0);
}

// ── INIT ──────────────────────────────────────────────────────────────────
(function init() {
  applySettingsToForm();
  updateHistoryBadge(loadHistory().length);

  // Photo drag and drop
  const zone = document.getElementById('photo-zone');
  zone.addEventListener('dragover',  e => { e.preventDefault(); zone.classList.add('drag-over'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
  zone.addEventListener('drop', e => {
    e.preventDefault(); zone.classList.remove('drag-over');
    const remaining = 6 - state.photos.length;
    Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/')).slice(0, remaining)
      .forEach(f => resizeImage(f, 1024, 0.75, d => {
        const idx = state.photos.length + 1;
        state.photos.push({ dataUrl:d, name:f.name, label:`Photo ${idx}` });
        renderPreviews();
      }));
  });

  // History overlay
  const overlay = document.getElementById('history-overlay');
  if (overlay) overlay.addEventListener('click', closeHistory);
})();
