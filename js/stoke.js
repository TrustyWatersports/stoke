/**
 * stoke.js — Core application logic
 *
 * Sections:
 *   STATE         — application state
 *   PHOTOS        — upload, resize, validate
 *   FORM          — toggle handlers
 *   GENERATE      — API call + error handling
 *   PARSE         — campaign response parser
 *   RENDER        — calendar + post cards
 *   CARD ACTIONS  — approve, edit, copy, discard
 *   UTILS         — helpers
 *   INIT          — drag/drop setup
 *
 * Error handling contract:
 *   All errors are named (FM-1 through FM-5 from eng review).
 *   Every catch block calls showError(message) — never silent.
 *   Network errors show specific error codes from the server.
 *   Parser fallback: if zero cards parsed, showError with raw text preview.
 *
 * Session ID:
 *   Generated once per page load, sent as x-session-id header.
 *   Used for server-side rate limiting (CF KV).
 *   Not persisted — refreshing resets rate limit counter.
 */

// ── STATE ────────────────────────────────────────────────────────────────
const state = {
  jobTypes:     [],
  channels:     ['INSTAGRAM', 'FACEBOOK', 'GOOGLE', 'EMAIL'],
  tone:         'general',
  campaignDays: 3,
  photos:       [],
  campaign:     [],
  sessionId:    Math.random().toString(36).substr(2, 12),
};

const PLATFORM_COLORS = {
  INSTAGRAM: '#E1306C',
  FACEBOOK:  '#1877F2',
  TIKTOK:    '#010101',
  GOOGLE:    '#4285F4',
  EMAIL:     '#1a6b4a',
  YOUTUBE:   '#FF0000',
};

const PLATFORM_LABELS = {
  INSTAGRAM: 'Instagram',
  FACEBOOK:  'Facebook',
  TIKTOK:    'TikTok / Reels',
  GOOGLE:    'Google Business',
  EMAIL:     'Customer Email',
  YOUTUBE:   'YouTube Shorts',
};

const LOADING_MSGS = [
  'Analyzing your photos...',
  'Building your campaign...',
  'Writing Day 1 posts...',
  'Writing mid-campaign posts...',
  'Almost ready...',
];

let loadingInterval = null;

// ── PHOTOS ───────────────────────────────────────────────────────────────
/**
 * resizeImage — compress before sending to API
 *   Shadow paths:
 *     - img.onerror: falls back to original dataUrl (may fail API validation)
 *     - canvas toDataURL failure: caught by caller's try/catch
 */
function resizeImage(file, maxW, quality, callback) {
  const reader = new FileReader();
  reader.onload = (e) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      let w = img.width, h = img.height;
      if (w > maxW) { h = Math.round(h * maxW / w); w = maxW; }
      canvas.width = w;
      canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      callback(canvas.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => callback(e.target.result); // fallback
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

function handlePhotoSelect(e) {
  const remaining = 6 - state.photos.length;
  Array.from(e.target.files).slice(0, remaining).forEach(file => {
    resizeImage(file, 1024, 0.75, dataUrl => {
      state.photos.push({ dataUrl, name: file.name });
      renderPreviews();
    });
  });
}

function removePhoto(i) {
  state.photos.splice(i, 1);
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
    thumb.innerHTML = `<img src="${p.dataUrl}" alt="Job photo ${i + 1}">
      <button class="remove-photo" onclick="removePhoto(${i})" aria-label="Remove photo">&#x2715;</button>`;
    container.appendChild(thumb);
  });

  if (state.photos.length > 0) {
    zone.classList.add('has-photos');
    countEl.innerHTML = `<div style="margin-top:10px">
      <span class="photo-count-badge">&#10003; ${state.photos.length} photo${state.photos.length > 1 ? 's' : ''} ready</span>
    </div>`;
    indicator.textContent = state.photos.length + ' photo' + (state.photos.length > 1 ? 's' : '');
    indicator.style.display = 'inline-block';
  } else {
    zone.classList.remove('has-photos');
    countEl.innerHTML = '';
    indicator.style.display = 'none';
  }
}

function getBase64(dataUrl) {
  try { return dataUrl.split(',')[1] || ''; }
  catch (e) { return ''; }
}

function getMediaType(dataUrl) {
  try {
    const m = dataUrl.match(/data:([^;]+);/);
    const t = m ? m[1] : 'image/jpeg';
    // HEIC/HEIF not accepted by Anthropic — force JPEG (canvas already converted)
    return (t === 'image/heic' || t === 'image/heif') ? 'image/jpeg' : t;
  } catch (e) {
    return 'image/jpeg';
  }
}

/**
 * getValidPhotos — filters out photos with insufficient base64 data
 * Minimum 1KB ensures we're not sending corrupt/empty conversions (FM-2)
 */
function getValidPhotos() {
  return state.photos.filter(p => {
    try { return getBase64(p.dataUrl).length > 1000; }
    catch (e) { return false; }
  });
}

// ── FORM ─────────────────────────────────────────────────────────────────
function toggleJobType(btn) {
  btn.classList.toggle('selected');
  const v = btn.dataset.val;
  state.jobTypes = btn.classList.contains('selected')
    ? [...state.jobTypes, v]
    : state.jobTypes.filter(x => x !== v);
  updateSelectionCount('job-type-count', state.jobTypes.length);
}

function toggleChannel(btn) {
  btn.classList.toggle('selected');
  const c = btn.dataset.channel;
  state.channels = btn.classList.contains('selected')
    ? [...state.channels, c]
    : state.channels.filter(x => x !== c);
  updateSelectionCount('channel-count', state.channels.length);
}

function selectTone(tone) {
  state.tone = tone;
  document.getElementById('tone-general').classList.toggle('selected', tone === 'general');
  document.getElementById('tone-personal').classList.toggle('selected', tone === 'personal');
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

// ── GENERATE ─────────────────────────────────────────────────────────────
async function generateContent() {
  const customerMoment = document.getElementById('customer-moment').value.trim();
  const productsUsed   = document.getElementById('products-used').value.trim();
  const problemSolved  = document.getElementById('problem-solved').value.trim();
  const extraDetails   = document.getElementById('extra-details').value.trim();
  const startDate      = document.getElementById('start-date').value.trim() || 'Today';
  const jobType        = state.jobTypes.length > 0 ? state.jobTypes.join(', ') : '';

  // Validation
  if (!customerMoment && !productsUsed && state.photos.length === 0) {
    showError('Please add at least one photo or describe the job before generating.');
    return;
  }
  if (state.channels.length === 0) {
    showError('Please select at least one output channel.');
    return;
  }

  // Build message content with validated photos
  const validPhotos = getValidPhotos();
  const msgContent = [];

  validPhotos.forEach(photo => {
    try {
      msgContent.push({
        type: 'image',
        source: {
          type: 'base64',
          media_type: getMediaType(photo.dataUrl),
          data: getBase64(photo.dataUrl),
        },
      });
    } catch (e) {
      console.warn('Skipping photo due to error:', photo.name, e.message);
    }
  });

  // Build prompt via prompts.js
  const prompt = window.StokePrompts.buildCampaignPrompt({
    jobType,
    customerMoment,
    productsUsed,
    problemSolved,
    extraDetails,
    startDate,
    channels: state.channels,
    tone: state.tone,
    campaignDays: state.campaignDays,
    validPhotoCount: validPhotos.length,
  });

  msgContent.push({ type: 'text', text: prompt });

  // UI — show loading state
  document.getElementById('generate-btn').disabled = true;
  document.getElementById('error-msg').style.display = 'none';
  document.getElementById('form-section').style.display = 'none';
  document.getElementById('loading-state').style.display = 'block';

  if (validPhotos.length > 0) {
    document.getElementById('loading-photo-strip').innerHTML =
      validPhotos.map(p => `<img class="loading-thumb" src="${p.dataUrl}" alt="">`).join('');
  }

  let msgIdx = 0;
  loadingInterval = setInterval(() => {
    msgIdx = (msgIdx + 1) % LOADING_MSGS.length;
    document.getElementById('loading-text').textContent = LOADING_MSGS[msgIdx];
  }, 2200);

  try {
    const resp = await fetch('/functions/generate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-session-id': state.sessionId,
      },
      body: JSON.stringify({ messages: [{ role: 'user', content: msgContent }] }),
    });

    clearInterval(loadingInterval);
    document.getElementById('loading-state').style.display = 'none';

    // Named error handling — every code from the server
    if (!resp.ok) {
      let errData;
      try { errData = await resp.json(); } catch (e) { errData = { error: { code: 'NETWORK_ERROR', message: resp.statusText } }; }
      const code = errData.error?.code || 'UNKNOWN';
      const msg  = errData.error?.message || 'Unknown error';
      const friendly = {
        MISSING_API_KEY:       'Server configuration error — contact support.',
        PAYLOAD_TOO_LARGE:     'Photos are too large. Try uploading fewer photos.',
        RATE_LIMIT_EXCEEDED:   'You\'ve generated a lot of content — please wait a few minutes.',
        INVALID_REQUEST_BODY:  'Request error — please try again.',
        ANTHROPIC_API_ERROR:   'Could not reach the AI service — please try again.',
        UPSTREAM_PARSE_FAILURE:'Unexpected response from AI — please try again.',
      };
      throw new Error(friendly[code] || msg);
    }

    const data = await resp.json();

    // Anthropic-level error
    if (data.type === 'error') {
      throw new Error(data.error?.message || 'AI service error');
    }

    // Empty response
    if (!data.content?.[0]?.text) {
      throw new Error(`No content returned. Stop reason: ${data.stop_reason || 'unknown'}`);
    }

    console.log('[Stoke] Stop reason:', data.stop_reason, '| Length:', data.content[0].text.length);

    // Parse
    const parsed = parseCampaign(data.content[0].text);

    // FM: parser returned zero days — show error with debug info
    if (parsed.length === 0) {
      const preview = data.content[0].text.substring(0, 300);
      console.error('[Stoke] Parser returned 0 days. Raw text preview:', preview);
      throw new Error('Content was generated but could not be parsed. The AI may have used unexpected formatting. Raw preview: ' + preview);
    }

    state.campaign = parsed;
    renderCampaign(jobType, startDate);

  } catch (err) {
    clearInterval(loadingInterval);
    document.getElementById('loading-state').style.display = 'none';
    document.getElementById('form-section').style.display = 'block';
    document.getElementById('generate-btn').disabled = false;
    showError(err.message);
    console.error('[Stoke] generateContent error:', err);
  }
}

// ── PARSE ─────────────────────────────────────────────────────────────────
/**
 * parseCampaign — converts AI text output to structured data
 *
 * Input format:
 *   ===DAY1===
 *   ANGLE: Action & Energy
 *   ---INSTAGRAM---
 *   [post body]
 *   ---FACEBOOK---
 *   [post body]
 *   ===DAY3===
 *   ...
 *
 * Tolerates:
 *   - Whitespace around markers
 *   - **PLATFORM** bold headers in body (stripped)
 *   - PLATFORM: prefix lines (stripped)
 *   - ANGLE: line in body (stripped)
 *
 * Returns: Array<{ day: number, posts: Array<{ channel, angle, text }> }>
 */
function parseCampaign(text) {
  const days = [];
  const blocks = text.split(/===DAY(\d+)===/);

  for (let i = 1; i < blocks.length; i += 2) {
    const dayNum = parseInt(blocks[i]);
    const block  = blocks[i + 1] || '';

    let angle = 'General';
    const angleMatch = block.match(/ANGLE:\s*(.+)/);
    if (angleMatch) angle = angleMatch[1].trim();

    const posts = [];
    const parts = block.split(/---([A-Z]+)---/);

    for (let j = 1; j < parts.length; j += 2) {
      const channel = parts[j].trim();
      let body = parts[j + 1] || '';

      // Strip formatting artifacts
      body = body.replace(/ANGLE:\s*.+\n?/g, '');
      body = body.replace(/^\*{1,2}[A-Z][A-Z\s\/]+\*{1,2}\n+/gm, '');
      body = body.replace(/^(INSTAGRAM|FACEBOOK|TIKTOK|GOOGLE|EMAIL|YOUTUBE)\s*[:]\s*\n+/gim, '');
      body = body.replace(/^\s*\[.*?\]\s*\n?/, ''); // strip [instruction text] if AI echoed it
      body = body.trim();

      if (body && body.length > 10) {
        posts.push({ channel, angle, text: body });
      }
    }

    if (posts.length > 0) {
      days.push({ day: dayNum, posts });
    }
  }

  return days;
}

// ── RENDER ────────────────────────────────────────────────────────────────
function renderCampaign(jobType, startDate) {
  const totalPosts = state.campaign.reduce((a, d) => a + d.posts.length, 0);
  const dayCount   = state.campaign.length;
  const styleLabel = state.tone === 'personal' ? 'Personal' : 'General';

  document.getElementById('results-subtitle').textContent =
    `${jobType || 'Job'} — ${totalPosts} post${totalPosts !== 1 ? 's' : ''} across ${dayCount} day${dayCount !== 1 ? 's' : ''} · ${styleLabel} style`;
  document.getElementById('campaign-count').textContent =
    `${totalPosts} post${totalPosts !== 1 ? 's' : ''} ready to review`;

  renderCalendar();
  renderPostsList();

  document.getElementById('results-section').style.display = 'block';
  document.getElementById('generate-btn').disabled = false;
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function getDateFromOffset(offset) {
  const d = new Date();
  d.setDate(d.getDate() + offset - 1);
  return d;
}

function renderCalendar() {
  const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const MON_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  document.getElementById('cal-header').innerHTML =
    DAY_NAMES.map(d => `<div class="cal-day-name">${d}</div>`).join('');

  const grid = document.getElementById('calendar-grid');
  grid.innerHTML = '';

  // Map campaign days to dates
  const dayMap = {};
  state.campaign.forEach(d => {
    dayMap[getDateFromOffset(d.day).toDateString()] = d;
  });

  const today   = new Date();
  const startDow = today.getDay();

  // Pad start of week
  for (let i = 0; i < startDow; i++) {
    const cell = document.createElement('div');
    cell.className = 'cal-cell cal-pad';
    grid.appendChild(cell);
  }

  for (let i = 0; i < 14; i++) {
    const date = new Date(today);
    date.setDate(today.getDate() + i);
    const key  = date.toDateString();
    const data = dayMap[key];
    const cell = document.createElement('div');

    cell.className = 'cal-cell' + (data ? ' has-posts' : '');
    cell.setAttribute('role', data ? 'button' : 'presentation');
    cell.setAttribute('aria-label', data
      ? `${MON_NAMES[date.getMonth()]} ${date.getDate()}: ${data.posts.length} posts`
      : `${MON_NAMES[date.getMonth()]} ${date.getDate()}`);

    const dateEl = `<div class="cal-date">${MON_NAMES[date.getMonth()]} ${date.getDate()}</div>`;

    if (data) {
      const dots = data.posts
        .map(p => `<div class="cal-dot" style="background:${PLATFORM_COLORS[p.channel] || '#888'}" title="${PLATFORM_LABELS[p.channel] || p.channel}"></div>`)
        .join('');
      cell.innerHTML = `${dateEl}<div class="cal-dots">${dots}</div>
        <div class="cal-post-count">${data.posts.length} post${data.posts.length > 1 ? 's' : ''}</div>`;
      cell.onclick = () => scrollToDay(data.day);
    } else {
      cell.innerHTML = dateEl;
    }
    grid.appendChild(cell);
  }
}

function scrollToDay(dayNum) {
  const el = document.getElementById(`day-${dayNum}`);
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });

  // Visual feedback — dim others, highlight target
  document.querySelectorAll('.day-section').forEach(s => s.style.opacity = '0.5');
  setTimeout(() => {
    const target = document.getElementById(`day-section-${dayNum}`);
    if (target) target.style.opacity = '1';
  }, 300);
}

function renderPostsList() {
  const container = document.getElementById('posts-list');
  container.innerHTML = '';
  const MON    = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const DNAMES = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

  const validPhotos = getValidPhotos();

  state.campaign.forEach(({ day, posts }) => {
    const date = getDateFromOffset(day);
    const dStr = `${DNAMES[date.getDay()]} ${MON[date.getMonth()]} ${date.getDate()}`;

    const section = document.createElement('div');
    section.className = 'day-section';
    section.id = `day-${day}`;

    const hdr = document.createElement('div');
    hdr.className = 'day-header';
    hdr.id = `day-section-${day}`;
    hdr.innerHTML = `<span class="day-badge">Day ${day} — ${dStr}</span><div class="day-line"></div>`;
    section.appendChild(hdr);

    posts.forEach(({ channel, angle, text }, postIdx) => {
      const color  = PLATFORM_COLORS[channel] || '#888';
      const label  = PLATFORM_LABELS[channel] || channel;
      const cardId = `card-${day}-${postIdx}`;
      const textId = `text-${cardId}`;

      // Auto-feature: rotate photos across cards so each gets a different one
      const featuredIdx = postIdx % Math.max(validPhotos.length, 1);
      const featuredSrc = validPhotos.length > 0 ? validPhotos[featuredIdx].dataUrl : null;

      const photoStripHtml = validPhotos.length > 0 ? `
        <div class="photo-strip" role="group" aria-label="Select featured photo">
          ${validPhotos.map((p, pi) => `
            <img src="${p.dataUrl}"
              class="photo-strip-thumb${pi === featuredIdx ? ' featured' : ''}"
              onclick="featurePhoto(this,'${cardId}')"
              title="Feature this photo"
              alt="Job photo ${pi + 1}">`).join('')}
          <span class="photo-strip-hint">Tap to change featured photo</span>
        </div>
        <div class="featured-wrap" id="feat-${cardId}" style="display:block">
          <img src="${featuredSrc}" alt="Featured photo for ${label} post">
        </div>` : '';

      const card = document.createElement('div');
      card.className = 'content-card';
      card.id = cardId;
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

    container.appendChild(section);
  });
}

// ── CARD ACTIONS ──────────────────────────────────────────────────────────
function featurePhoto(img, cardId) {
  document.querySelectorAll(`#${cardId} .photo-strip-thumb`).forEach(t => t.classList.remove('featured'));
  img.classList.add('featured');
  const wrap = document.getElementById(`feat-${cardId}`);
  if (wrap) {
    wrap.style.display = 'block';
    wrap.querySelector('img').src = img.src;
  }
}

function approveCard(btn, cardId, label) {
  const card = document.getElementById(cardId);
  card.classList.add('approved');
  btn.parentElement.innerHTML =
    `<span class="approved-badge">&#10003; Approved for ${label}</span>`;
}

function approveAll() {
  document.querySelectorAll('.approve-btn').forEach(b => {
    if (b.closest('.content-card')) b.click();
  });
}

function editCard(textId) {
  const el = document.getElementById(textId);
  const cur = el.textContent;
  const rows = Math.max(4, cur.split('\n').length + 2);
  el.innerHTML = `<textarea
    style="width:100%;font-family:'DM Sans',sans-serif;font-size:14px;line-height:1.75;
           border:none;outline:none;background:transparent;resize:vertical;color:var(--text);padding:0"
    rows="${rows}"
    aria-label="Edit post content">${cur}</textarea>`;
  el.querySelector('textarea').focus();
}

function discardCard(cardId) {
  document.getElementById(cardId).classList.add('discarded');
}

function copyCard(textId) {
  const el  = document.getElementById(textId);
  const btn = document.querySelector(`[onclick="copyCard('${textId}')"]`);
  navigator.clipboard.writeText(el.textContent).then(() => {
    if (btn) {
      btn.textContent = 'Copied!';
      btn.classList.add('copied');
      setTimeout(() => { btn.textContent = 'Copy'; btn.classList.remove('copied'); }, 2000);
    }
  }).catch(() => {
    // Clipboard API not available — select text as fallback
    const range = document.createRange();
    range.selectNode(el);
    window.getSelection().removeAllRanges();
    window.getSelection().addRange(range);
  });
}

// ── UTILS ─────────────────────────────────────────────────────────────────
function escHtml(s) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function showError(msg) {
  const el = document.getElementById('error-msg');
  el.textContent = msg;
  el.style.display = 'block';
  el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function resetForm() {
  document.getElementById('form-section').style.display = 'block';
  document.getElementById('results-section').style.display = 'none';
  document.getElementById('error-msg').style.display = 'none';
  document.getElementById('generate-btn').disabled = false;

  state.jobTypes = [];
  state.photos   = [];

  document.querySelectorAll('[data-val].selected').forEach(b => b.classList.remove('selected'));
  renderPreviews();
  updateSelectionCount('job-type-count', 0);
}

// ── INIT ──────────────────────────────────────────────────────────────────
(function init() {
  const zone = document.getElementById('photo-zone');
  zone.addEventListener('dragover',  e => { e.preventDefault(); zone.classList.add('drag-over'); });
  zone.addEventListener('dragleave', ()  => zone.classList.remove('drag-over'));
  zone.addEventListener('drop', e => {
    e.preventDefault();
    zone.classList.remove('drag-over');
    const remaining = 6 - state.photos.length;
    Array.from(e.dataTransfer.files)
      .filter(f => f.type.startsWith('image/'))
      .slice(0, remaining)
      .forEach(f => resizeImage(f, 1024, 0.75, d => {
        state.photos.push({ dataUrl: d, name: f.name });
        renderPreviews();
      }));
  });
})();
