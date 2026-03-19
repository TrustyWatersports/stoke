/**
 * stoke.js — Core application logic v8.1
 * Added: settings integration, job history
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
  photos: [], campaign: [], campaignMeta: null,
  sessionId: Math.random().toString(36).substr(2, 12),
};

const PLATFORM_COLORS = {
  INSTAGRAM:'#E1306C', FACEBOOK:'#1877F2', TIKTOK:'#010101',
  GOOGLE:'#4285F4', EMAIL:'#1a6b4a', YOUTUBE:'#FF0000',
};
const PLATFORM_LABELS = {
  INSTAGRAM:'Instagram', FACEBOOK:'Facebook', TIKTOK:'TikTok / Reels',
  GOOGLE:'Google Business', EMAIL:'Customer Email', YOUTUBE:'YouTube Shorts',
};
const LOADING_MSGS = [
  'Analyzing your photos...','Building your campaign...','Writing Day 1 posts...',
  'Writing mid-campaign posts...','Almost ready...',
];
let loadingInterval = null;

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
      state.photos.push({ dataUrl, name: file.name });
      renderPreviews();
    });
  });
}

function removePhoto(i) { state.photos.splice(i, 1); renderPreviews(); }

function renderPreviews() {
  const container = document.getElementById('photo-previews');
  const countEl   = document.getElementById('photo-count');
  const zone      = document.getElementById('photo-zone');
  const indicator = document.getElementById('photo-indicator');
  container.innerHTML = '';
  state.photos.forEach((p, i) => {
    const thumb = document.createElement('div');
    thumb.className = 'photo-thumb';
    thumb.innerHTML = `<img src="${p.dataUrl}" alt="Job photo ${i+1}">
      <button class="remove-photo" onclick="removePhoto(${i})" aria-label="Remove photo">&#x2715;</button>`;
    container.appendChild(thumb);
  });
  if (state.photos.length > 0) {
    zone.classList.add('has-photos');
    countEl.innerHTML = `<div style="margin-top:10px"><span class="photo-count-badge">&#10003; ${state.photos.length} photo${state.photos.length>1?'s':''} ready</span></div>`;
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

// ── FORM — settings-driven ────────────────────────────────────────────────
function applySettingsToForm() {
  const settings = getSettings();
  const content  = settings.content || {};

  const jobGrid = document.getElementById('job-type-grid');
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

// ── GENERATE ──────────────────────────────────────────────────────────────
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
    msgIdx = (msgIdx+1) % LOADING_MSGS.length;
    document.getElementById('loading-text').textContent = LOADING_MSGS[msgIdx];
  }, 2200);

  try {
    const resp = await fetch('/functions/generate', {
      method:'POST',
      headers:{ 'Content-Type':'application/json', 'x-session-id':state.sessionId },
      body: JSON.stringify({ messages:[{ role:'user', content:msgContent }] }),
    });

    clearInterval(loadingInterval);
    document.getElementById('loading-state').style.display = 'none';

    if (!resp.ok) {
      let errData;
      try { errData = await resp.json(); } catch(e) { errData = { error:{ code:'NETWORK_ERROR', message:resp.statusText } }; }
      const code = errData.error?.code || 'UNKNOWN';
      const friendly = {
        MISSING_API_KEY:'Server configuration error — contact support.',
        PAYLOAD_TOO_LARGE:'Photos are too large. Try uploading fewer photos.',
        RATE_LIMIT_EXCEEDED:"You've generated a lot of content — please wait a few minutes.",
        INVALID_REQUEST_BODY:'Request error — please try again.',
        ANTHROPIC_API_ERROR:'Could not reach the AI service — please try again.',
        UPSTREAM_PARSE_FAILURE:'Unexpected response from AI — please try again.',
      };
      throw new Error(friendly[code] || errData.error?.message || 'Unknown error');
    }

    const data = await resp.json();
    if (data.type === 'error') throw new Error(data.error?.message || 'AI service error');
    if (!data.content?.[0]?.text) throw new Error(`No content returned. Stop reason: ${data.stop_reason||'unknown'}`);

    console.log('[Stoke] Stop reason:', data.stop_reason, '| Length:', data.content[0].text.length);

    const parsed = parseCampaign(data.content[0].text);
    if (parsed.length === 0) {
      const preview = data.content[0].text.substring(0, 300);
      console.error('[Stoke] Parser returned 0 days. Raw preview:', preview);
      throw new Error('Content generated but could not be parsed. Raw preview: ' + preview);
    }

    state.campaign     = parsed;
    state.campaignMeta = { jobType, customerMoment, productsUsed, startDate, tone:state.tone, days:state.campaignDays, generatedAt:new Date().toISOString() };
    saveToHistory(state.campaign, state.campaignMeta);
    renderCampaign(jobType, startDate);

  } catch(err) {
    clearInterval(loadingInterval);
    document.getElementById('loading-state').style.display = 'none';
    document.getElementById('form-section').style.display = 'block';
    document.getElementById('generate-btn').disabled = false;
    showError(err.message);
    console.error('[Stoke] generateContent error:', err);
  }
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
    const posts = [];
    const parts = block.split(/---([A-Z]+)---/);
    for (let j = 1; j < parts.length; j += 2) {
      const channel = parts[j].trim();
      let body = parts[j+1] || '';
      body = body.replace(/ANGLE:\s*.+\n?/g, '');
      body = body.replace(/^\*{1,2}[A-Z][A-Z\s\/]+\*{1,2}\n+/gm, '');
      body = body.replace(/^(INSTAGRAM|FACEBOOK|TIKTOK|GOOGLE|EMAIL|YOUTUBE)\s*[:]\s*\n+/gim, '');
      body = body.replace(/^\s*\[.*?\]\s*\n?/, '');
      body = body.trim();
      if (body && body.length > 10) posts.push({ channel, angle, text:body });
    }
    if (posts.length > 0) days.push({ day:dayNum, posts });
  }
  return days;
}

// ── RENDER ────────────────────────────────────────────────────────────────
function renderCampaign(jobType, startDate) {
  const totalPosts = state.campaign.reduce((a,d) => a+d.posts.length, 0);
  const dayCount   = state.campaign.length;
  const styleLabel = state.tone === 'personal' ? 'Personal' : 'General';
  document.getElementById('results-subtitle').textContent =
    `${jobType||'Job'} — ${totalPosts} post${totalPosts!==1?'s':''} across ${dayCount} day${dayCount!==1?'s':''} · ${styleLabel} style`;
  document.getElementById('campaign-count').textContent =
    `${totalPosts} post${totalPosts!==1?'s':''} ready to review`;
  renderCalendar();
  renderPostsList();
  document.getElementById('results-section').style.display = 'block';
  document.getElementById('generate-btn').disabled = false;
  window.scrollTo({ top:0, behavior:'smooth' });
}

function getDateFromOffset(offset) {
  const d = new Date(); d.setDate(d.getDate() + offset - 1); return d;
}

function renderCalendar() {
  const DAY_NAMES = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const MON_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  document.getElementById('cal-header').innerHTML = DAY_NAMES.map(d => `<div class="cal-day-name">${d}</div>`).join('');
  const grid = document.getElementById('calendar-grid');
  grid.innerHTML = '';
  const dayMap = {};
  state.campaign.forEach(d => { dayMap[getDateFromOffset(d.day).toDateString()] = d; });
  const today = new Date();
  for (let i = 0; i < today.getDay(); i++) {
    const cell = document.createElement('div'); cell.className = 'cal-cell cal-pad'; grid.appendChild(cell);
  }
  for (let i = 0; i < 14; i++) {
    const date = new Date(today); date.setDate(today.getDate() + i);
    const data = dayMap[date.toDateString()];
    const cell = document.createElement('div');
    cell.className = 'cal-cell' + (data ? ' has-posts' : '');
    cell.setAttribute('role', data ? 'button' : 'presentation');
    const dateEl = `<div class="cal-date">${MON_NAMES[date.getMonth()]} ${date.getDate()}</div>`;
    if (data) {
      const dots = data.posts.map(p =>
        `<div class="cal-dot" style="background:${PLATFORM_COLORS[p.channel]||'#888'}" title="${PLATFORM_LABELS[p.channel]||p.channel}"></div>`
      ).join('');
      cell.innerHTML = `${dateEl}<div class="cal-dots">${dots}</div><div class="cal-post-count">${data.posts.length} post${data.posts.length>1?'s':''}</div>`;
      cell.onclick = () => scrollToDay(data.day);
    } else { cell.innerHTML = dateEl; }
    grid.appendChild(cell);
  }
}

function scrollToDay(dayNum) {
  const el = document.getElementById(`day-${dayNum}`);
  if (el) el.scrollIntoView({ behavior:'smooth', block:'start' });
  document.querySelectorAll('.day-section').forEach(s => s.style.opacity = '0.5');
  setTimeout(() => { const t = document.getElementById(`day-section-${dayNum}`); if (t) t.style.opacity = '1'; }, 300);
}

function renderPostsList() {
  const container = document.getElementById('posts-list');
  container.innerHTML = '';
  const MON    = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const DNAMES = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const validPhotos = getValidPhotos();

  state.campaign.forEach(({ day, posts }) => {
    const date = getDateFromOffset(day);
    const section = document.createElement('div');
    section.className = 'day-section'; section.id = `day-${day}`;
    const hdr = document.createElement('div');
    hdr.className = 'day-header'; hdr.id = `day-section-${day}`;
    hdr.innerHTML = `<span class="day-badge">Day ${day} — ${DNAMES[date.getDay()]} ${MON[date.getMonth()]} ${date.getDate()}</span><div class="day-line"></div>`;
    section.appendChild(hdr);

    posts.forEach(({ channel, angle, text }, postIdx) => {
      const color  = PLATFORM_COLORS[channel] || '#888';
      const label  = PLATFORM_LABELS[channel] || channel;
      const cardId = `card-${day}-${postIdx}`;
      const textId = `text-${cardId}`;
      const featuredIdx = postIdx % Math.max(validPhotos.length, 1);
      const featuredSrc = validPhotos.length > 0 ? validPhotos[featuredIdx].dataUrl : null;
      const photoStripHtml = validPhotos.length > 0 ? `
        <div class="photo-strip" role="group" aria-label="Select featured photo">
          ${validPhotos.map((p,pi) => `<img src="${p.dataUrl}" class="photo-strip-thumb${pi===featuredIdx?' featured':''}" onclick="featurePhoto(this,'${cardId}')" title="Feature this photo" alt="Job photo ${pi+1}">`).join('')}
          <span class="photo-strip-hint">Tap to change featured photo</span>
        </div>
        <div class="featured-wrap" id="feat-${cardId}" style="display:block">
          <img src="${featuredSrc}" alt="Featured photo for ${label} post">
        </div>` : '';
      const card = document.createElement('div');
      card.className = 'content-card'; card.id = cardId;
      card.innerHTML = `
        <div class="card-header">
          <div class="platform-badge"><div class="platform-dot" style="background:${color}" aria-hidden="true"></div><span>${label}</span></div>
          <div class="card-right"><span class="angle-tag">${angle}</span><button class="copy-btn" onclick="copyCard('${textId}')" aria-label="Copy ${label} post">Copy</button></div>
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
  if (wrap) { wrap.style.display='block'; wrap.querySelector('img').src=img.src; }
}
function approveCard(btn, cardId, label) {
  document.getElementById(cardId).classList.add('approved');
  btn.parentElement.innerHTML = `<span class="approved-badge">&#10003; Approved for ${label}</span>`;
}
function approveAll() { document.querySelectorAll('.approve-btn').forEach(b => { if (b.closest('.content-card')) b.click(); }); }
function editCard(textId) {
  const el = document.getElementById(textId);
  const cur = el.textContent;
  el.innerHTML = `<textarea style="width:100%;font-family:'DM Sans',sans-serif;font-size:14px;line-height:1.75;border:none;outline:none;background:transparent;resize:vertical;color:var(--text);padding:0" rows="${Math.max(4,cur.split('\n').length+2)}" aria-label="Edit post content">${cur}</textarea>`;
  el.querySelector('textarea').focus();
}
function discardCard(cardId) { document.getElementById(cardId).classList.add('discarded'); }
function copyCard(textId) {
  const el = document.getElementById(textId);
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
  try { const r = localStorage.getItem(HISTORY_KEY); return r ? JSON.parse(r) : []; }
  catch(e) { return []; }
}
function saveToHistory(campaign, meta) {
  try {
    const history = loadHistory();
    history.unshift({ id: Date.now().toString(36), meta:{ ...meta }, campaign: JSON.parse(JSON.stringify(campaign)) });
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
  document.getElementById('history-overlay').style.display = 'block';
  renderHistoryList();
}
function closeHistory() {
  document.getElementById('history-panel').classList.remove('open');
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
    const date  = new Date(entry.meta.generatedAt || Date.now());
    const dStr  = `${MON[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`;
    const tStr  = date.toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' });
    const total = entry.campaign.reduce((a,d) => a+d.posts.length, 0);
    const days  = entry.campaign.length;
    const channels = [...new Set(entry.campaign.flatMap(d => d.posts.map(p => p.channel)))];
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
  state.campaign = entry.campaign;
  state.campaignMeta = entry.meta;
  state.tone = entry.meta.tone || 'general';
  state.photos = [];
  document.getElementById('form-section').style.display = 'none';
  document.getElementById('results-section').style.display = 'none';
  renderCampaign(entry.meta.jobType, entry.meta.startDate);
  const sub = document.getElementById('results-subtitle');
  if (sub) sub.textContent += ' · Restored from history (photos not saved)';
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
  document.querySelectorAll('[data-val].selected').forEach(b => b.classList.remove('selected'));
  renderPreviews();
  updateSelectionCount('job-type-count', 0);
}

// ── INIT ──────────────────────────────────────────────────────────────────
(function init() {
  applySettingsToForm();
  updateHistoryBadge(loadHistory().length);
  const zone = document.getElementById('photo-zone');
  zone.addEventListener('dragover',  e => { e.preventDefault(); zone.classList.add('drag-over'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
  zone.addEventListener('drop', e => {
    e.preventDefault(); zone.classList.remove('drag-over');
    const remaining = 6 - state.photos.length;
    Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/')).slice(0, remaining)
      .forEach(f => resizeImage(f, 1024, 0.75, d => { state.photos.push({ dataUrl:d, name:f.name }); renderPreviews(); }));
  });
  const overlay = document.getElementById('history-overlay');
  if (overlay) overlay.addEventListener('click', closeHistory);
})();
