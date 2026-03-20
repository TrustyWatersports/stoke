/**
 * stoke.js — v8.4
 * Added: D1 API layer — settings and campaigns sync to backend when logged in.
 * Falls back to localStorage when not authenticated (offline/demo mode).
 */

// ── AUTH STATE ────────────────────────────────────────────────────────────
const auth = { user: null, business: null, checked: false };

async function checkAuth() {
  if (auth.checked) return auth.user;
  try {
    const data = await fetch('/auth/me').then(r => r.json());
    if (data.authenticated) {
      auth.user     = data.user;
      auth.business = data.business;
      updateAuthUI();
    }
  } catch(e) { console.warn('[Stoke] Auth check failed:', e.message); }
  auth.checked = true;
  return auth.user;
}

function updateAuthUI() {
  // Show user name in header if logged in
  const el = document.getElementById('auth-indicator');
  if (el && auth.user) {
    el.textContent = auth.user.name || auth.user.email;
    el.style.display = 'inline-flex';
  }
}

// ── API HELPERS ───────────────────────────────────────────────────────────
async function apiGet(path) {
  const r = await fetch(path, { credentials: 'include' });
  if (!r.ok) throw new Error(`API ${path} failed: ${r.status}`);
  return r.json();
}
async function apiPost(path, body) {
  const r = await fetch(path, { method:'POST', headers:{'Content-Type':'application/json'}, credentials:'include', body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`API ${path} failed: ${r.status}`);
  return r.json();
}

// ── SETTINGS — D1 + localStorage fallback ────────────────────────────────
async function loadSettingsFromAPI() {
  try {
    if (!auth.user) return null;
    return await apiGet('/api/settings');
  } catch(e) { return null; }
}
async function saveSettingsToAPI(data) {
  try {
    if (!auth.user) return;
    await apiPost('/api/settings', data);
  } catch(e) { console.warn('[Stoke] Settings sync failed:', e.message); }
}

// ── SETTINGS ──────────────────────────────────────────────────────────────
function loadSettings() {
  try { const r = localStorage.getItem('stoke_settings'); return r ? JSON.parse(r) : null; }
  catch (e) { return null; }
}
const SETTING_DEFAULTS = {
  business: { name:'Trusty Sail & Paddle', tagline:'Crystal Coast kayak and sailboat experts', city:'Morehead City, NC', area:'Crystal Coast', specialty:'Custom kayak rigging, US distributor for Topper & Topaz sailboats, tournament fishing', phone:'(252) 499-9911', website:'trustysailandpaddle.com' },
  hashtags: ['#TrustySailPaddle','#CrystalCoast','#MoreheadCity','#KayakFishing','#Sailing'],
  voice: { generalDesc:'Write clearly and directly. Lead with the most compelling specific fact or result. Use concrete details — numbers, names, products, real outcomes. Professional but warm. No emoji.', authorName:'Heather Fournel', personalDesc:"Write in Heather Fournel's full authentic voice. Open with the reader's emotional world or a vivid human scene — NEVER with a product or price. Alternate short punchy sentences with longer flowing sentences. End with a crystallized memorable line. No emoji. Commerce is always the vehicle, never the point.", emoji:false, prices:true, phone:true, names:true },
  content: { jobTypes:['Custom Rigging Build','Kayak Sale','Demo Day Event','Rental or Tour','Sailboat Sale or Lesson','Repair or Service'], angles:['Action & Energy','Product Detail','Customer Story','Values & Why','Community Call','Throwback & Reflect'], defaultDays:3, defaultChannels:['INSTAGRAM','FACEBOOK','GOOGLE','EMAIL'] },
};
function getSettings() {
  const s = loadSettings();
  if (!s) return SETTING_DEFAULTS;
  return { business:{...SETTING_DEFAULTS.business,...(s.business||{})}, hashtags:s.hashtags||SETTING_DEFAULTS.hashtags, voice:{...SETTING_DEFAULTS.voice,...(s.voice||{})}, content:{...SETTING_DEFAULTS.content,...(s.content||{})}, appearance:s.appearance||{} };
}

// ── INDEXEDDB — photo storage ──────────────────────────────────────────────
let _idb = null;
async function getIDB() {
  if (_idb) return _idb;
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('stoke_photos', 1);
    req.onupgradeneeded = e => e.target.result.createObjectStore('photos', { keyPath:'id' });
    req.onsuccess  = e => { _idb = e.target.result; resolve(_idb); };
    req.onerror    = e => reject(e.target.error);
  });
}
async function savePhotosIDB(id, photos) {
  try { const db=await getIDB(); const tx=db.transaction('photos','readwrite'); tx.objectStore('photos').put({id,photos}); await new Promise((r,j)=>{tx.oncomplete=r;tx.onerror=j;}); } catch(e) { console.warn('[IDB]',e.message); }
}
async function loadPhotosIDB(id) {
  try { const db=await getIDB(); return new Promise(res=>{const req=db.transaction('photos','readonly').objectStore('photos').get(id);req.onsuccess=()=>res(req.result?.photos||[]);req.onerror=()=>res([]);}); } catch(e) { return []; }
}
async function deletePhotosIDB(id) {
  try { const db=await getIDB(); db.transaction('photos','readwrite').objectStore('photos').delete(id); } catch(e) {}
}

// ── STATE ─────────────────────────────────────────────────────────────────
const state = { jobTypes:[], channels:['INSTAGRAM','FACEBOOK','GOOGLE','EMAIL'], tone:'general', campaignDays:3, photos:[], campaign:[], campaignMeta:null, sessionId:Math.random().toString(36).substr(2,12) };
const PLATFORM_COLORS = { INSTAGRAM:'#E1306C', FACEBOOK:'#1877F2', TIKTOK:'#010101', GOOGLE:'#4285F4', EMAIL:'#1a6b4a', YOUTUBE:'#FF0000' };
const PLATFORM_LABELS = { INSTAGRAM:'Instagram', FACEBOOK:'Facebook', TIKTOK:'TikTok / Reels', GOOGLE:'Google Business', EMAIL:'Customer Email', YOUTUBE:'YouTube Shorts' };
let streamBuffer='', streamRendered=new Set();

// ── PHOTOS ────────────────────────────────────────────────────────────────
function resizeImage(file, maxW, quality, callback) {
  const reader = new FileReader();
  reader.onload = e => { const img=new Image(); img.onload=()=>{const canvas=document.createElement('canvas');let w=img.width,h=img.height;if(w>maxW){h=Math.round(h*maxW/w);w=maxW;}canvas.width=w;canvas.height=h;canvas.getContext('2d').drawImage(img,0,0,w,h);callback(canvas.toDataURL('image/jpeg',quality));};img.onerror=()=>callback(e.target.result);img.src=e.target.result; };
  reader.readAsDataURL(file);
}
function handlePhotoSelect(e) {
  const remaining=6-state.photos.length;
  Array.from(e.target.files).slice(0,remaining).forEach(file=>{
    resizeImage(file,1024,0.75,dataUrl=>{state.photos.push({dataUrl,name:file.name,label:`Photo ${state.photos.length+1}`});renderPreviews();});
  });
}
function removePhoto(i){state.photos.splice(i,1);state.photos.forEach((p,idx)=>p.label=`Photo ${idx+1}`);renderPreviews();}
function renderPreviews() {
  const container=document.getElementById('photo-previews'),countEl=document.getElementById('photo-count'),zone=document.getElementById('photo-zone'),indicator=document.getElementById('photo-indicator');
  container.innerHTML='';
  state.photos.forEach((p,i)=>{const thumb=document.createElement('div');thumb.className='photo-thumb';thumb.innerHTML=`<img src="${p.dataUrl}" alt="${p.label}"><div class="photo-label">${p.label}</div><button class="remove-photo" onclick="removePhoto(${i})" aria-label="Remove">&#x2715;</button>`;container.appendChild(thumb);});
  if(state.photos.length>0){zone.classList.add('has-photos');countEl.innerHTML=`<div style="margin-top:10px"><span class="photo-count-badge">&#10003; ${state.photos.length} photo${state.photos.length>1?'s':''} — each matched to a post</span></div>`;indicator.textContent=state.photos.length+' photo'+(state.photos.length>1?'s':'');indicator.style.display='inline-block';}
  else{zone.classList.remove('has-photos');countEl.innerHTML='';indicator.style.display='none';}
}
function getBase64(d){try{return d.split(',')[1]||'';}catch(e){return '';}}
function getMediaType(d){try{const m=d.match(/data:([^;]+);/);const t=m?m[1]:'image/jpeg';return(t==='image/heic'||t==='image/heif')?'image/jpeg':t;}catch(e){return 'image/jpeg';}}
function getValidPhotos(){return state.photos.filter(p=>{try{return getBase64(p.dataUrl).length>1000;}catch(e){return false;}});}

// ── FORM ──────────────────────────────────────────────────────────────────
function applySettingsToForm() {
  const settings=getSettings(),content=settings.content||{};
  const jobGrid=document.getElementById('job-type-grid');
  if(jobGrid)jobGrid.innerHTML=(content.jobTypes||SETTING_DEFAULTS.content.jobTypes).map(jt=>`<button class="toggle-btn" data-val="${escHtml(jt)}" onclick="toggleJobType(this)">${escHtml(jt)}</button>`).join('');
  const defaultCh=content.defaultChannels||SETTING_DEFAULTS.content.defaultChannels;
  state.channels=[...defaultCh];
  document.querySelectorAll('[data-channel]').forEach(btn=>btn.classList.toggle('selected',defaultCh.includes(btn.dataset.channel)));
  updateSelectionCount('channel-count',state.channels.length);
  const defaultDays=content.defaultDays||3;state.campaignDays=defaultDays;
  document.querySelectorAll('[data-days]').forEach(btn=>btn.classList.toggle('selected',parseInt(btn.dataset.days)===defaultDays));
  if(settings.appearance?.colorPrimary)document.documentElement.style.setProperty('--green',settings.appearance.colorPrimary);
  if(settings.appearance?.colorAccent)document.documentElement.style.setProperty('--green-mid',settings.appearance.colorAccent);
}
function toggleJobType(btn){btn.classList.toggle('selected');const v=btn.dataset.val;state.jobTypes=btn.classList.contains('selected')?[...state.jobTypes,v]:state.jobTypes.filter(x=>x!==v);updateSelectionCount('job-type-count',state.jobTypes.length);}
function toggleChannel(btn){btn.classList.toggle('selected');const c=btn.dataset.channel;state.channels=btn.classList.contains('selected')?[...state.channels,c]:state.channels.filter(x=>x!==c);updateSelectionCount('channel-count',state.channels.length);}
function selectTone(tone){state.tone=tone;document.getElementById('tone-general').classList.toggle('selected',tone==='general');document.getElementById('tone-personal').classList.toggle('selected',tone==='personal');}
function selectCampaignLength(btn){document.querySelectorAll('[data-days]').forEach(b=>b.classList.remove('selected'));btn.classList.add('selected');state.campaignDays=parseInt(btn.dataset.days);}
function updateSelectionCount(id,count){const el=document.getElementById(id);if(el)el.textContent=count>0?`${count} selected`:`'`;}

// ── GENERATE — streaming ───────────────────────────────────────────────────
async function generateContent() {
  const customerMoment=document.getElementById('customer-moment').value.trim();
  const productsUsed=document.getElementById('products-used').value.trim();
  const problemSolved=document.getElementById('problem-solved').value.trim();
  const extraDetails=document.getElementById('extra-details').value.trim();
  const startDate=document.getElementById('start-date').value.trim()||'Today';
  const jobType=state.jobTypes.length>0?state.jobTypes.join(', '):'';
  if(!customerMoment&&!productsUsed&&state.photos.length===0){showError('Please add at least one photo or describe the job before generating.');return;}
  if(state.channels.length===0){showError('Please select at least one output channel.');return;}
  const validPhotos=getValidPhotos();
  const msgContent=[];
  validPhotos.forEach(photo=>{try{msgContent.push({type:'image',source:{type:'base64',media_type:getMediaType(photo.dataUrl),data:getBase64(photo.dataUrl)}});}catch(e){console.warn('[Stoke] Skipping photo:',e.message);}});
  const settings=getSettings();
  const prompt=window.StokePrompts.buildCampaignPrompt({
    jobType,customerMoment,productsUsed,problemSolved,extraDetails,startDate,
    channels:state.channels,tone:state.tone,campaignDays:state.campaignDays,
    validPhotoCount:validPhotos.length,photoLabels:validPhotos.map(p=>p.label),
    businessName:settings.business?.name||'',businessArea:settings.business?.area||'',
    businessCity:settings.business?.city||'',businessPhone:settings.business?.phone||'',
    businessWebsite:settings.business?.website||'',specialty:settings.business?.specialty||'',
    defaultHashtags:settings.hashtags||[],voiceGeneral:settings.voice?.generalDesc||'',
    voicePersonal:settings.voice?.personalDesc||'',voiceAuthor:settings.voice?.authorName||'',
    useEmoji:settings.voice?.emoji||false,angles:settings.content?.angles||SETTING_DEFAULTS.content.angles,
  });
  msgContent.push({type:'text',text:prompt});
  state.campaign=[];state.campaignMeta=null;streamBuffer='';streamRendered=new Set();
  document.getElementById('generate-btn').disabled=true;
  document.getElementById('error-msg').style.display='none';
  document.getElementById('form-section').style.display='none';
  document.getElementById('posts-list').innerHTML='';
  document.getElementById('calendar-grid').innerHTML='';
  document.getElementById('cal-header').innerHTML='';
  document.getElementById('results-subtitle').textContent='Generating your campaign...';
  document.getElementById('campaign-count').textContent='';
  document.getElementById('results-section').style.display='block';
  const exportBtn=document.getElementById('export-btn');if(exportBtn)exportBtn.style.display='none';
  const streamStatus=document.getElementById('stream-status');
  if(streamStatus){streamStatus.style.display='flex';streamStatus.innerHTML=(validPhotos.length>0?validPhotos.map(p=>`<img src="${p.dataUrl}" style="width:28px;height:28px;border-radius:4px;object-fit:cover;opacity:.7">`).join(''):'')+'<span style="margin-left:8px">✦ Writing Day 1...</span>';}
  window.scrollTo({top:0,behavior:'smooth'});
  try {
    const resp=await fetch('/functions/generate/stream',{method:'POST',headers:{'Content-Type':'application/json','x-session-id':state.sessionId},body:JSON.stringify({messages:[{role:'user',content:msgContent}]})});
    if(!resp.ok){let errData;try{errData=await resp.json();}catch(e){errData={error:{code:'NETWORK_ERROR',message:resp.statusText}};}const code=errData.error?.code||'UNKNOWN';const friendly={MISSING_API_KEY:'Server configuration error — contact support.',PAYLOAD_TOO_LARGE:'Photos are too large. Try uploading fewer photos.',ANTHROPIC_API_ERROR:'Could not reach the AI service — please try again.',INVALID_REQUEST_BODY:'Request error — please try again.'};throw new Error(friendly[code]||errData.error?.message||'Unknown error');}
    const reader=resp.body.getReader();const decoder=new TextDecoder();
    while(true){const{done,value}=await reader.read();if(done)break;processStreamChunk(decoder.decode(value,{stream:true}),validPhotos,startDate);}
    if(streamStatus)streamStatus.style.display='none';
    if(streamBuffer.trim()){parseCampaign(streamBuffer).forEach(d=>{if(!streamRendered.has(d.day)){addDayToState(d,startDate);renderDay(d,validPhotos);streamRendered.add(d.day);}});}
    if(state.campaign.length===0)throw new Error('Content generated but could not be parsed. Please try again.');
    const totalPosts=state.campaign.reduce((a,d)=>a+d.posts.length,0);
    document.getElementById('results-subtitle').textContent=`${jobType||'Job'} — ${totalPosts} post${totalPosts!==1?'s':''} across ${state.campaign.length} day${state.campaign.length!==1?'s':''} · ${state.tone==='personal'?'Personal':'General'} style`;
    document.getElementById('campaign-count').textContent=`${totalPosts} post${totalPosts!==1?'s':''} ready to review`;
    if(exportBtn)exportBtn.style.display='inline-flex';
    state.campaignMeta={jobType,customerMoment,productsUsed,startDate,tone:state.tone,days:state.campaignDays,generatedAt:new Date().toISOString()};
    await saveToHistory(state.campaign,state.campaignMeta,validPhotos);
    renderCalendar();renderAllDayHeaders();
    document.getElementById('generate-btn').disabled=false;
  } catch(e) {
    if(streamStatus)streamStatus.style.display='none';
    document.getElementById('results-section').style.display='none';
    document.getElementById('form-section').style.display='block';
    document.getElementById('generate-btn').disabled=false;
    showError(e.message);console.error('[Stoke]',e);
  }
}

function processStreamChunk(chunk,validPhotos,startDate) {
  chunk.split('\n').forEach(line=>{
    if(!line.startsWith('data: '))return;
    const dataStr=line.slice(6).trim();if(dataStr==='[DONE]')return;
    try{const data=JSON.parse(dataStr);if(data.type==='content_block_delta'&&data.delta?.type==='text_delta'){streamBuffer+=data.delta.text;tryRenderCompletedDays(validPhotos,startDate);}}catch(e){}
  });
}
function tryRenderCompletedDays(validPhotos,startDate) {
  const markers=[...streamBuffer.matchAll(/===DAY(\d+)===/g)];
  if(markers.length<2)return;
  for(let i=0;i<markers.length-1;i++){
    const dayNum=parseInt(markers[i][1]);if(streamRendered.has(dayNum))continue;
    const parsed=parseCampaign(streamBuffer.slice(markers[i].index,markers[i+1].index));
    if(parsed.length>0){addDayToState(parsed[0],startDate);renderDay(parsed[0],validPhotos);streamRendered.add(dayNum);
      const el=document.getElementById('stream-status');if(el){const span=el.querySelector('span');if(span)span.textContent=`✦ Writing Day ${parseInt(markers[i+1]?.[1]||dayNum+1)}...`;}}
  }
}
function addDayToState(dayData,startDate){state.campaign.push({...dayData,scheduledDate:getDateFromOffset(dayData.day)});}

// ── REGENERATE SINGLE POST ─────────────────────────────────────────────────
async function regeneratePost(cardId,dayNum,postIdx,channel) {
  const dayData=state.campaign.find(d=>d.day===dayNum);
  const post=dayData?.posts[postIdx];const meta=state.campaignMeta;
  if(!meta||!post)return;
  const card=document.getElementById(cardId);const textEl=document.getElementById(`text-${cardId}`);
  if(!card||!textEl)return;
  const origHTML=textEl.innerHTML;
  textEl.innerHTML=`<div style="padding:1rem;text-align:center;color:var(--text-3);font-size:13px"><div class="loading-dots" style="justify-content:center;margin-bottom:8px"><div class="loading-dot"></div><div class="loading-dot"></div><div class="loading-dot"></div></div>Rewriting ${PLATFORM_LABELS[channel]||channel}...</div>`;
  const settings=getSettings();
  const prompt=`Rewrite this ${PLATFORM_LABELS[channel]||channel} post for ${settings.business?.name||'Trusty Sail & Paddle'}.\n\nORIGINAL:\n${post.text}\n\nCONTEXT: ${meta.jobType||''} — ${meta.customerMoment||''}\n\nRULES:\n- Same platform, same approximate length\n- Different opening, different angle — make it feel fresh\n- Keep the ${meta.tone==='personal'?'personal story-driven':'clear results-driven'} voice\n- No platform headers. Just the post text.`;
  try {
    const resp=await fetch('/functions/generate',{method:'POST',headers:{'Content-Type':'application/json','x-session-id':state.sessionId},body:JSON.stringify({messages:[{role:'user',content:[{type:'text',text:prompt}]}]})});
    const data=await resp.json();const newText=data.content?.[0]?.text?.trim();
    if(!newText)throw new Error('No content');
    post.text=newText;textEl.innerHTML=escHtml(newText);
    card.style.transition='box-shadow 0.3s';card.style.boxShadow='0 0 0 2px var(--green)';
    setTimeout(()=>{card.style.boxShadow='';},2000);
  } catch(e){textEl.innerHTML=origHTML;console.error('[Stoke] Regen:',e);}
}

// ── CSV EXPORT ─────────────────────────────────────────────────────────────
function exportSchedule() {
  if(!state.campaign||state.campaign.length===0){alert('No campaign to export.');return;}
  const rows=[['Date','Day','Platform','Status','Content','Photo']];
  state.campaign.forEach(dayData=>{
    const date=dayData.scheduledDate||getDateFromOffset(dayData.day);
    const dateStr=`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
    dayData.posts.forEach((post,idx)=>{
      const cardId=`card-${dayData.day}-${idx}`;
      const status=document.getElementById(cardId)?.classList.contains('approved')?'Approved':'Draft';
      const photoLabel=document.getElementById(`feat-label-${cardId}`)?.textContent||'';
      const esc=s=>`"${(s||'').replace(/"/g,'""')}"`;
      rows.push([dateStr,`Day ${dayData.day}`,PLATFORM_LABELS[post.channel]||post.channel,status,esc(post.text),esc(photoLabel)]);
    });
  });
  const csv=rows.map(r=>r.join(',')).join('\n');
  const a=document.createElement('a');
  a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8;'}));
  a.download=`stoke-${(state.campaignMeta?.jobType||'campaign').replace(/[^a-z0-9]/gi,'-').toLowerCase()}-${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
}

// ── PARSE ─────────────────────────────────────────────────────────────────
function parseCampaign(text) {
  const days=[];const blocks=text.split(/===DAY(\d+)===/);
  for(let i=1;i<blocks.length;i+=2){
    const dayNum=parseInt(blocks[i]);const block=blocks[i+1]||'';
    let angle='General';const am=block.match(/ANGLE:\s*(.+)/);if(am)angle=am[1].trim();
    let photoHint=null;const pm=block.match(/PHOTO:\s*(\d+)/i);if(pm)photoHint=parseInt(pm[1])-1;
    const posts=[];const parts=block.split(/---([A-Z]+)---/);
    for(let j=1;j<parts.length;j+=2){
      const channel=parts[j].trim();let body=parts[j+1]||'';
      body=body.replace(/ANGLE:\s*.+\n?/g,'').replace(/PHOTO:\s*\d+\n?/gi,'').replace(/^\*{1,2}[A-Z][A-Z\s\/]+\*{1,2}\n+/gm,'').replace(/^(INSTAGRAM|FACEBOOK|TIKTOK|GOOGLE|EMAIL|YOUTUBE)\s*[:]\s*\n+/gim,'').replace(/^\s*\[.*?\]\s*\n?/,'').trim();
      if(body&&body.length>10)posts.push({channel,angle,text:body,photoHint});
    }
    if(posts.length>0)days.push({day:dayNum,posts});
  }
  return days;
}

// ── RENDER ────────────────────────────────────────────────────────────────
function renderDay(dayData,validPhotos) {
  const container=document.getElementById('posts-list');
  const MON=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const DNAMES=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const stateDay=state.campaign.find(d=>d.day===dayData.day);
  const date=stateDay?.scheduledDate||getDateFromOffset(dayData.day);
  let section=document.getElementById(`day-${dayData.day}`);
  if(!section){section=document.createElement('div');section.className='day-section';section.id=`day-${dayData.day}`;
    const sections=Array.from(container.querySelectorAll('.day-section'));
    const after=sections.find(s=>parseInt(s.id.replace('day-',''))>dayData.day);
    if(after)container.insertBefore(section,after);else container.appendChild(section);}
  section.innerHTML='';
  const hdr=document.createElement('div');hdr.className='day-header';hdr.id=`day-section-${dayData.day}`;
  hdr.innerHTML=`<span class="day-badge">Day ${dayData.day} — ${DNAMES[date.getDay()]} ${MON[date.getMonth()]} ${date.getDate()}</span><div class="day-line"></div>`;
  section.appendChild(hdr);
  section.style.opacity='0';section.style.transform='translateY(8px)';
  requestAnimationFrame(()=>{section.style.transition='opacity 0.3s ease,transform 0.3s ease';section.style.opacity='1';section.style.transform='translateY(0)';});
  // Drop zone for card drag
  section.addEventListener('dragover',e=>{if(e.dataTransfer.types.includes('fromday')){e.preventDefault();section.classList.add('drop-target');}});
  section.addEventListener('dragleave',e=>{if(!section.contains(e.relatedTarget))section.classList.remove('drop-target');});
  section.addEventListener('drop',e=>{e.preventDefault();section.classList.remove('drop-target');const fromDay=parseInt(e.dataTransfer.getData('fromDay'));const postIdx=parseInt(e.dataTransfer.getData('postIdx'));if(fromDay!==dayData.day)movePost(fromDay,postIdx,dayData.day);});

  dayData.posts.forEach(({channel,angle,text,photoHint},postIdx)=>{
    const color=PLATFORM_COLORS[channel]||'#888';const label=PLATFORM_LABELS[channel]||channel;
    const cardId=`card-${dayData.day}-${postIdx}`;const textId=`text-${cardId}`;
    const dayIdx=state.campaign.findIndex(d=>d.day===dayData.day);
    const safeHint=(photoHint!==null&&photoHint!==undefined&&photoHint<validPhotos.length)?photoHint:null;
    const featuredIdx=safeHint!==null?safeHint:(dayIdx%Math.max(validPhotos.length,1));
    const fp=validPhotos.length>0?validPhotos[Math.min(featuredIdx,validPhotos.length-1)]:null;
    const photoStripHtml=fp?`
      <div class="photo-strip" role="group">
        ${validPhotos.map((p,pi)=>`<div class="photo-strip-item${pi===featuredIdx?' featured':''}"><img src="${p.dataUrl}" class="photo-strip-thumb${pi===featuredIdx?' featured':''}" onclick="featurePhoto(this,'${cardId}')" title="${p.label}" alt="${p.label}"><span class="photo-strip-label">${p.label}</span></div>`).join('')}
        <span class="photo-strip-hint">Tap to change</span>
      </div>
      <div class="featured-wrap" id="feat-${cardId}">
        <img src="${fp.dataUrl}" alt="${fp.label}">
        <div class="featured-photo-label" id="feat-label-${cardId}">${fp.label}</div>
      </div>`:'';
    const card=document.createElement('div');card.className='content-card';card.id=cardId;card.draggable=true;
    card.addEventListener('dragstart',e=>{e.dataTransfer.setData('fromDay',String(dayData.day));e.dataTransfer.setData('postIdx',String(postIdx));e.dataTransfer.effectAllowed='move';setTimeout(()=>card.classList.add('dragging'),0);});
    card.addEventListener('dragend',()=>card.classList.remove('dragging'));
    card.innerHTML=`
      <div class="card-header">
        <div class="platform-badge">
          <span class="drag-card-handle" title="Drag to move to another day">⠿</span>
          <div class="platform-dot" style="background:${color}"></div>
          <span>${label}</span>
        </div>
        <div class="card-right">
          <span class="angle-tag">${angle}</span>
          <button class="regen-btn" onclick="regeneratePost('${cardId}',${dayData.day},${postIdx},'${channel}')" title="Rewrite this post">↺</button>
          <button class="copy-btn" onclick="copyCard('${textId}')">Copy</button>
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
  section.scrollIntoView({behavior:'smooth',block:'nearest'});
}

function movePost(fromDay,postIdx,toDay) {
  const fd=state.campaign.find(d=>d.day===fromDay);const td=state.campaign.find(d=>d.day===toDay);
  if(!fd||!td)return;
  td.posts.push(fd.posts.splice(postIdx,1)[0]);
  const vp=getValidPhotos();renderDay(fd,vp);renderDay(td,vp);
  if(fd.posts.length===0){state.campaign=state.campaign.filter(d=>d.day!==fromDay);document.getElementById(`day-${fromDay}`)?.remove();}
  renderCalendar();
}

// ── CALENDAR ──────────────────────────────────────────────────────────────
function renderCalendar() {
  const DAY_NAMES=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const MON_NAMES=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  document.getElementById('cal-header').innerHTML=DAY_NAMES.map(d=>`<div class="cal-day-name">${d}</div>`).join('');
  const grid=document.getElementById('calendar-grid');grid.innerHTML='';
  const dateMap={};
  state.campaign.forEach(d=>{if(!d.scheduledDate)d.scheduledDate=getDateFromOffset(d.day);const key=d.scheduledDate.toDateString();if(!dateMap[key])dateMap[key]=[];dateMap[key].push(d);});
  const today=new Date();
  for(let i=0;i<today.getDay();i++){const c=document.createElement('div');c.className='cal-cell cal-pad';grid.appendChild(c);}
  for(let i=0;i<14;i++){
    const date=new Date(today);date.setDate(today.getDate()+i);const key=date.toDateString();const days=dateMap[key]||[];
    const cell=document.createElement('div');cell.className='cal-cell'+(days.length>0?' has-posts':'');
    const dateEl=`<div class="cal-date">${MON_NAMES[date.getMonth()]} ${date.getDate()}</div>`;
    if(days.length>0){
      const dots=days.flatMap(d=>d.posts).map(p=>`<div class="cal-dot" style="background:${PLATFORM_COLORS[p.channel]||'#888'}"></div>`).join('');
      const total=days.reduce((a,d)=>a+d.posts.length,0);
      cell.innerHTML=`${dateEl}<div class="cal-dots">${dots}</div><div class="cal-post-count">${total} post${total!==1?'s':''}</div>`;
      cell.onclick=()=>scrollToDay(days[0].day);
    } else{cell.innerHTML=dateEl;}
    grid.appendChild(cell);
  }
}
function renderAllDayHeaders() {
  const MON=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const DNAMES=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  state.campaign.forEach(d=>{
    if(!d.scheduledDate)d.scheduledDate=getDateFromOffset(d.day);
    const badge=document.querySelector(`#day-section-${d.day} .day-badge`);
    if(badge)badge.textContent=`Day ${d.day} — ${DNAMES[d.scheduledDate.getDay()]} ${MON[d.scheduledDate.getMonth()]} ${d.scheduledDate.getDate()}`;
  });
}
function scrollToDay(dayNum){const el=document.getElementById(`day-${dayNum}`);if(el)el.scrollIntoView({behavior:'smooth',block:'start'});document.querySelectorAll('.day-section').forEach(s=>s.style.opacity='0.5');setTimeout(()=>{const t=document.getElementById(`day-section-${dayNum}`);if(t)t.style.opacity='1';},300);}
function getDateFromOffset(offset){const d=new Date();d.setDate(d.getDate()+offset-1);return d;}

// ── CARD ACTIONS ──────────────────────────────────────────────────────────
function featurePhoto(img,cardId){
  img.closest('.photo-strip')?.querySelectorAll('.photo-strip-item').forEach(i=>i.classList.remove('featured'));
  img.closest('.photo-strip')?.querySelectorAll('.photo-strip-thumb').forEach(t=>t.classList.remove('featured'));
  img.classList.add('featured');img.closest('.photo-strip-item')?.classList.add('featured');
  const wrap=document.getElementById(`feat-${cardId}`);
  if(wrap){wrap.querySelector('img').src=img.src;const lbl=document.getElementById(`feat-label-${cardId}`);if(lbl)lbl.textContent=img.alt;}
}
function approveCard(btn,cardId,label){document.getElementById(cardId).classList.add('approved');btn.parentElement.innerHTML=`<span class="approved-badge">&#10003; Approved for ${label}</span>`;}
function approveAll(){document.querySelectorAll('.approve-btn').forEach(b=>{if(b.closest('.content-card'))b.click();});}
function editCard(textId){const el=document.getElementById(textId);const cur=el.textContent;el.innerHTML=`<textarea style="width:100%;font-family:'DM Sans',sans-serif;font-size:14px;line-height:1.75;border:none;outline:none;background:transparent;resize:vertical;color:var(--text);padding:0" rows="${Math.max(4,cur.split('\n').length+2)}">${cur}</textarea>`;el.querySelector('textarea').focus();}
function discardCard(cardId){document.getElementById(cardId).classList.add('discarded');}
function copyCard(textId){
  const el=document.getElementById(textId);const btn=document.querySelector(`[onclick="copyCard('${textId}')"]`);
  navigator.clipboard.writeText(el.textContent).then(()=>{if(btn){btn.textContent='Copied!';btn.classList.add('copied');setTimeout(()=>{btn.textContent='Copy';btn.classList.remove('copied');},2000);}}).catch(()=>{const r=document.createRange();r.selectNode(el);window.getSelection().removeAllRanges();window.getSelection().addRange(r);});
}

// ── HISTORY — IndexedDB photos ─────────────────────────────────────────────
const HISTORY_KEY='stoke_history';const HISTORY_MAX=20;
function loadHistory(){try{const r=localStorage.getItem(HISTORY_KEY);return r?JSON.parse(r):[];}catch(e){return [];}}
async function saveToHistory(campaign,meta,photos) {
  try {
    const history=loadHistory();const id=Date.now().toString(36);
    const saveable=campaign.map(d=>({day:d.day,posts:d.posts,scheduledDateStr:d.scheduledDate?.toISOString()}));
    history.unshift({id,meta:{...meta},campaign:saveable});
    if(history.length>HISTORY_MAX){const removed=history.splice(HISTORY_MAX);removed.forEach(e=>deletePhotosIDB(e.id));}
    localStorage.setItem(HISTORY_KEY,JSON.stringify(history));
    updateHistoryBadge(history.length);
    if(photos&&photos.length>0)await savePhotosIDB(id,photos);
    // Also save to D1 if logged in
    if(auth.user){
      apiPost('/api/campaigns',{meta,campaign:saveable}).catch(e=>console.warn('[Stoke] D1 campaign save:',e.message));
    }
  } catch(e){console.warn('[Stoke] History:',e.message);}
}
function updateHistoryBadge(count){const badge=document.getElementById('history-badge');if(badge){badge.textContent=count;badge.style.display=count>0?'inline-flex':'none';}}
function openHistory(){const panel=document.getElementById('history-panel');panel.classList.add('open');panel.style.right='0';document.getElementById('history-overlay').style.display='block';renderHistoryList();}
function closeHistory(){const panel=document.getElementById('history-panel');panel.classList.remove('open');panel.style.right='-380px';document.getElementById('history-overlay').style.display='none';}
async function renderHistoryList() {
  const container=document.getElementById('history-list');
  const MON=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  // Show loading state
  container.innerHTML=`<div style="padding:1.5rem;text-align:center;color:var(--text-3);font-size:13px">Loading...</div>`;
  // Try D1 first if logged in, fall back to localStorage
  let history=[];
  if(auth.user){
    try{
      const apiHistory=await apiGet('/api/campaigns');
      if(apiHistory&&apiHistory.length>0){
        // Convert D1 format to history format
        history=apiHistory.map(c=>({
          id:c.id,
          meta:{jobType:c.job_type,customerMoment:c.customer_moment,productsUsed:c.products_used,tone:c.tone,days:c.days,startDate:c.start_date,generatedAt:new Date(c.created_at*1000).toISOString()},
          campaign:[],// posts loaded on demand
          post_count:c.post_count
        }));
      }
    }catch(e){console.warn('[Stoke] D1 history failed, using localStorage');history=loadHistory();}
  } else {
    history=loadHistory();
  }
  if(history.length===0){container.innerHTML=`<div style="padding:2rem;text-align:center;color:var(--text-3);font-size:13px">No campaigns yet. Generate your first one!</div>`;return;}
  container.innerHTML=history.map((entry,idx)=>{
    const date=new Date(entry.meta.generatedAt||Date.now());
    const total=entry.post_count||entry.campaign.reduce((a,d)=>a+(d.posts?.length||0),0);
    const channels=[...new Set(entry.campaign.flatMap(d=>(d.posts||[]).map(p=>p.channel)))];
    const fromD1=entry.campaign.length===0&&entry.post_count>0;
    return `<div class="history-item" onclick="restoreFromHistory(${idx})">
      <div class="history-item-header"><span class="history-job">${escHtml(entry.meta.jobType||'Job')}</span><span class="history-date">${MON[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()} · ${date.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}</span></div>
      <div class="history-meta">${total} post${total!==1?'s':''} · ${entry.campaign.length} day${entry.campaign.length!==1?'s':''} · ${entry.meta.tone==='personal'?'Personal':'General'}</div>
      ${entry.meta.customerMoment?`<div class="history-preview">${escHtml(entry.meta.customerMoment.substring(0,80))}${entry.meta.customerMoment.length>80?'…':''}</div>`:''}
      <div class="history-channels">${channels.map(ch=>`<span class="history-ch-dot" style="background:${PLATFORM_COLORS[ch]||'#888'}"></span>`).join('')}</div>
    </div>`;
  }).join('');
}
async function restoreFromHistory(idx) {
  const entry=loadHistory()[idx];if(!entry)return;
  closeHistory();
  state.campaign=entry.campaign.map(d=>({...d,scheduledDate:d.scheduledDateStr?new Date(d.scheduledDateStr):getDateFromOffset(d.day)}));
  state.campaignMeta=entry.meta;state.tone=entry.meta.tone||'general';
  const photos=await loadPhotosIDB(entry.id);state.photos=photos;
  document.getElementById('form-section').style.display='none';
  document.getElementById('posts-list').innerHTML='';
  state.campaign.forEach(d=>renderDay(d,photos));
  renderCalendar();renderAllDayHeaders();
  const totalPosts=state.campaign.reduce((a,d)=>a+d.posts.length,0);
  document.getElementById('results-subtitle').textContent=`${entry.meta.jobType||'Job'} — ${totalPosts} posts · Restored${photos.length>0?' (with photos)':''}`;
  document.getElementById('campaign-count').textContent=`${totalPosts} posts`;
  const exportBtn=document.getElementById('export-btn');if(exportBtn)exportBtn.style.display='inline-flex';
  document.getElementById('results-section').style.display='block';
  window.scrollTo({top:0,behavior:'smooth'});
}
function clearHistory(){
  if(!confirm('Clear all campaign history? This cannot be undone.'))return;
  loadHistory().forEach(e=>deletePhotosIDB(e.id));
  localStorage.removeItem(HISTORY_KEY);updateHistoryBadge(0);renderHistoryList();
}

// ── UTILS ─────────────────────────────────────────────────────────────────
function escHtml(s){return(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
function showError(msg){const el=document.getElementById('error-msg');el.textContent=msg;el.style.display='block';el.scrollIntoView({behavior:'smooth',block:'nearest'});}
function resetForm(){
  document.getElementById('form-section').style.display='block';
  document.getElementById('results-section').style.display='none';
  document.getElementById('error-msg').style.display='none';
  document.getElementById('generate-btn').disabled=false;
  const exportBtn=document.getElementById('export-btn');if(exportBtn)exportBtn.style.display='none';
  state.jobTypes=[];state.photos=[];state.campaign=[];streamBuffer='';streamRendered=new Set();
  document.querySelectorAll('[data-val].selected').forEach(b=>b.classList.remove('selected'));
  renderPreviews();updateSelectionCount('job-type-count',0);
}

// ── INIT ──────────────────────────────────────────────────────────────────
(function init(){
  // Check auth first, then load settings from API if logged in
  checkAuth().then(async user => {
    if (user) {
      try {
        const apiSettings = await loadSettingsFromAPI();
        if (apiSettings && Object.keys(apiSettings).length > 0) {
          // Sync API settings to localStorage so getSettings() picks them up
          localStorage.setItem('stoke_settings', JSON.stringify(apiSettings));
        }
      } catch(e) { console.warn('[Stoke] Could not load settings from API'); }
    }
    applySettingsToForm();
  });
  applySettingsToForm();updateHistoryBadge(loadHistory().length);
  const zone=document.getElementById('photo-zone');
  zone.addEventListener('dragover',e=>{e.preventDefault();zone.classList.add('drag-over');});
  zone.addEventListener('dragleave',()=>zone.classList.remove('drag-over'));
  zone.addEventListener('drop',e=>{e.preventDefault();zone.classList.remove('drag-over');const remaining=6-state.photos.length;Array.from(e.dataTransfer.files).filter(f=>f.type.startsWith('image/')).slice(0,remaining).forEach(f=>resizeImage(f,1024,0.75,d=>{state.photos.push({dataUrl:d,name:f.name,label:`Photo ${state.photos.length+1}`});renderPreviews();}));});
  const overlay=document.getElementById('history-overlay');if(overlay)overlay.addEventListener('click',closeHistory);
})();
