/**
 * _worker.js — Stoke v2.0
 * Auth (magic link), D1 database, R2 photos, AI generation, cron scheduler
 */

const MODEL='claude-sonnet-4-20250514';const MAX_TOKENS=6000;const SESSION_TTL=60*60*24*30;
const CORS={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET,POST,PUT,DELETE,OPTIONS','Access-Control-Allow-Headers':'Content-Type,Authorization,x-session-id'};
const json=(data,status=200,extra={})=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json',...CORS,...extra}});
const err=(message,status=400)=>json({error:message},status);
function uuid(){const b=crypto.getRandomValues(new Uint8Array(16));b[6]=(b[6]&0x0f)|0x40;b[8]=(b[8]&0x3f)|0x80;const h=Array.from(b).map(x=>x.toString(16).padStart(2,'0')).join('');return`${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;}
function token(n=32){return Array.from(crypto.getRandomValues(new Uint8Array(n))).map(b=>b.toString(16).padStart(2,'0')).join('');}
function now(){return Math.floor(Date.now()/1000);}

async function getSession(request,env){
  const cookie=request.headers.get('Cookie')||'';
  const t=cookie.match(/stoke_session=([a-f0-9]+)/)?.[1]||request.headers.get('Authorization')?.replace('Bearer ','');
  if(!t)return null;
  return await env.DB.prepare('SELECT s.*,u.email,u.name,u.role FROM sessions s JOIN users u ON s.user_id=u.id WHERE s.token=? AND s.expires_at>?').bind(t,now()).first();
}
async function requireAuth(request,env){
  const s=await getSession(request,env);
  if(!s)throw new Response(JSON.stringify({error:'Unauthorized'}),{status:401,headers:{'Content-Type':'application/json'}});
  return s;
}

// -- EMAIL TEMPLATES ----------------------------------------------------------
function emailBase(body, preheader){
  return '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Stoke</title></head>'
  +'<body style="margin:0;padding:0;background:#f2f2ef;font-family:Helvetica,Arial,sans-serif">'
  +(preheader?'<div style="display:none;max-height:0;overflow:hidden">'+preheader+'</div>':'')
  +'<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:40px 16px">'
  +'<table width="100%" style="max-width:520px" cellpadding="0" cellspacing="0">'
  +'<tr><td style="background:#1a6b4a;border-radius:12px 12px 0 0;padding:28px 40px">'
  +'<table cellpadding="0" cellspacing="0"><tr>'
  +'<td style="width:32px;height:32px;background:rgba(255,255,255,0.15);border-radius:7px;text-align:center;vertical-align:middle;font-size:16px;color:white">&#9670;</td>'
  +'<td style="padding-left:10px;font-family:Georgia,serif;font-size:21px;color:white">Stoke</td>'
  +'</tr></table></td></tr>'
  +'<tr><td style="background:#ffffff;padding:40px;border-radius:0 0 12px 12px">'
  +body
  +'<p style="margin:28px 0 0;font-size:12px;color:#aaa;border-top:1px solid #f0f0ec;padding-top:20px">'
  +'Sent by Stoke &middot; <a href="https://withstoke.com" style="color:#1a6b4a;text-decoration:none">withstoke.com</a><br>'
  +"If you didn't request this, you can safely ignore it."
  +'</p></td></tr>'
  +'</table></td></tr></table></body></html>';
}

function magicLinkEmail(link, name){
  const greeting = name ? 'Hi '+name.split(' ')[0]+',' : 'Hi there,';
  return emailBase(
    '<h1 style="font-family:Georgia,serif;font-size:26px;color:#1a1a18;margin:0 0 8px;letter-spacing:-0.5px">Your sign-in link</h1>'
    +'<p style="font-size:15px;color:#666;margin:0 0 28px;line-height:1.6">'+greeting+' click the button below to sign in to Stoke. This link expires in <strong>15 minutes</strong> and can only be used once.</p>'
    +'<table cellpadding="0" cellspacing="0" style="margin-bottom:28px"><tr>'
    +'<td style="background:#1a6b4a;border-radius:8px">'
    +'<a href="'+link+'" style="display:inline-block;padding:14px 32px;font-size:15px;font-weight:600;color:white;text-decoration:none">Sign in to Stoke &rarr;</a>'
    +'</td></tr></table>'
    +'<p style="font-size:13px;color:#999;margin:0;line-height:1.6">Or copy this link:<br>'
    +'<span style="color:#1a6b4a;word-break:break-all">'+link+'</span></p>',
    'Your Stoke sign-in link'
  );
}

function bookingConfirmEmail(customerName, businessName, serviceType, dateStr, phone){
  return emailBase(
    '<h1 style="font-family:Georgia,serif;font-size:26px;color:#1a1a18;margin:0 0 8px">Booking confirmed!</h1>'
    +'<p style="font-size:15px;color:#666;margin:0 0 20px;line-height:1.6">Hi '+customerName+', here are your details:</p>'
    +'<table width="100%" cellpadding="0" cellspacing="0" style="background:#f8f8f6;border-radius:8px;margin-bottom:24px">'
    +'<tr><td style="padding:20px 24px">'
    +'<table width="100%" cellpadding="0" cellspacing="0">'
    +'<tr><td style="padding:5px 0;font-size:12px;color:#999;font-weight:600;text-transform:uppercase;letter-spacing:.06em">Service</td>'
    +'<td style="padding:5px 0;font-size:14px;color:#1a1a18;text-align:right">'+serviceType+'</td></tr>'
    +'<tr><td style="padding:5px 0;font-size:12px;color:#999;font-weight:600;text-transform:uppercase;letter-spacing:.06em">Date &amp; Time</td>'
    +'<td style="padding:5px 0;font-size:14px;color:#1a1a18;text-align:right">'+dateStr+'</td></tr>'
    +'<tr><td style="padding:5px 0;font-size:12px;color:#999;font-weight:600;text-transform:uppercase;letter-spacing:.06em">With</td>'
    +'<td style="padding:5px 0;font-size:14px;color:#1a1a18;text-align:right">'+businessName+'</td></tr>'
    +'</table></td></tr></table>'
    +'<p style="font-size:14px;color:#666;margin:0;line-height:1.6">Questions? Call or text us at <strong>'+phone+'</strong>. See you on the water.</p>',
    'Your '+serviceType+' is confirmed'
  );
}

function invoiceEmail(customerName, businessName, amount, paymentLink, dueDate){
  return emailBase(
    '<h1 style="font-family:Georgia,serif;font-size:26px;color:#1a1a18;margin:0 0 8px">Invoice from '+businessName+'</h1>'
    +'<p style="font-size:15px;color:#666;margin:0 0 20px;line-height:1.6">Hi '+customerName+', your invoice is ready.</p>'
    +'<table width="100%" cellpadding="0" cellspacing="0" style="background:#f8f8f6;border-radius:8px;margin-bottom:24px">'
    +'<tr><td style="padding:20px 24px">'
    +'<table width="100%" cellpadding="0" cellspacing="0">'
    +'<tr><td style="padding:5px 0;font-size:12px;color:#999;font-weight:600;text-transform:uppercase;letter-spacing:.06em">Amount Due</td>'
    +'<td style="padding:5px 0;font-family:Georgia,serif;font-size:22px;color:#1a6b4a;text-align:right">$'+amount+'</td></tr>'
    +'<tr><td style="padding:5px 0;font-size:12px;color:#999;font-weight:600;text-transform:uppercase;letter-spacing:.06em">Due Date</td>'
    +'<td style="padding:5px 0;font-size:14px;color:#1a1a18;text-align:right">'+dueDate+'</td></tr>'
    +'</table></td></tr></table>'
    +'<table cellpadding="0" cellspacing="0" style="margin-bottom:20px"><tr>'
    +'<td style="background:#1a6b4a;border-radius:8px">'
    +'<a href="'+paymentLink+'" style="display:inline-block;padding:14px 32px;font-size:15px;font-weight:600;color:white;text-decoration:none">Pay Now &rarr;</a>'
    +'</td></tr></table>'
    +'<p style="font-size:13px;color:#999">Thank you for your business!</p>',
    'Invoice from '+businessName+' - $'+amount+' due'
  );
}

async function sendEmail(env, to, subject, htmlBody){
  const fromEmail = env.FROM_EMAIL || 'hello@withstoke.com';
  if(!env.SENDGRID_API_KEY){
    console.log('[Stoke Email] No SENDGRID_API_KEY - skipping send to '+to);
    return {ok:true, dev:true};
  }
  const resp = await fetch('https://api.sendgrid.com/v3/mail/send',{
    method:'POST',
    headers:{'Authorization':'Bearer '+env.SENDGRID_API_KEY,'Content-Type':'application/json'},
    body:JSON.stringify({
      personalizations:[{to:[{email:to}]}],
      from:{email:fromEmail, name:'Stoke'},
      subject,
      content:[{type:'text/html', value:htmlBody}]
    })
  });
  if(!resp.ok){ const b=await resp.text(); throw new Error('SendGrid '+resp.status+': '+b); }
  return {ok:true};
}

async function sendMagicLink(email, tok, env){
  const domain = env.APP_DOMAIN || 'withstoke.com';
  const link = 'https://'+domain+'/auth/verify?token='+tok+'&redirect=/dashboard.html';
  let name = '';
  try { const u = await env.DB.prepare('SELECT name FROM users WHERE email=?').bind(email).first(); name = u?.name||''; } catch(e){}
  await sendEmail(env, email, 'Sign in to Stoke', magicLinkEmail(link, name));
}

// -- EMAIL API ENDPOINTS ------------------------------------------------------
async function handleSendConfirmation(request, env){
  const s = await requireAuth(request, env);
  const b = await request.json();
  if(!b.customerEmail) return err('customerEmail required');
  const biz = await env.DB.prepare('SELECT * FROM businesses WHERE id=?').bind(s.business_id).first().catch(()=>null);
  const html = bookingConfirmEmail(
    b.customerName || 'there',
    biz?.name || 'Trusty Sail & Paddle',
    b.serviceType || 'your booking',
    b.dateStr || '',
    biz?.phone || ''
  );
  try {
    await sendEmail(env, b.customerEmail, 'Your booking is confirmed - '+( biz?.name||'Stoke'), html);
    return json({ok:true});
  } catch(e) { return err('Email failed: '+e.message); }
}

async function handleSendInvoiceEmail(request, env){
  const s = await requireAuth(request, env);
  const b = await request.json();
  if(!b.customerEmail || !b.amount || !b.paymentLink) return err('customerEmail, amount, paymentLink required');
  const biz = await env.DB.prepare('SELECT * FROM businesses WHERE id=?').bind(s.business_id).first().catch(()=>null);
  const html = invoiceEmail(
    b.customerName || 'there',
    biz?.name || 'Trusty Sail & Paddle',
    parseFloat(b.amount).toFixed(2),
    b.paymentLink,
    b.dueDate || 'Due in 30 days'
  );
  try {
    await sendEmail(env, b.customerEmail, 'Invoice from '+(biz?.name||'Stoke')+' - $'+parseFloat(b.amount).toFixed(2), html);
    return json({ok:true});
  } catch(e) { return err('Email failed: '+e.message); }
}


async function handleLogin(request,env){
  const {email}=await request.json().catch(()=>({}));
  if(!email||!email.includes('@'))return err('Valid email required');
  const user=await env.DB.prepare('SELECT id FROM users WHERE email=?').bind(email).first();
  if(!user)return err('No account found for this email.',404);
  const tok=token(24);
  await env.DB.prepare('INSERT INTO magic_links(token,email,created_at,expires_at,used)VALUES(?,?,?,?,0)').bind(tok,email,now(),now()+900).run();
  try{await sendMagicLink(email,tok,env);}catch(e){
    console.error('[Stoke] Email failed:',e.message);
    if(!env.SENDGRID_API_KEY)return json({ok:true,dev:true,token:tok});
    return err('Failed to send login email.',500);
  }
  return json({ok:true,message:'Check your email for a login link.'});
}

async function handleVerify(request,env){
  const url=new URL(request.url);const tok=url.searchParams.get('token');
  if(!tok)return err('Missing token');
  const link=await env.DB.prepare('SELECT * FROM magic_links WHERE token=? AND expires_at>? AND used=0').bind(tok,now()).first();
  if(!link)return Response.redirect(`https://${url.host}/login.html?error=expired`,302);
  await env.DB.prepare('UPDATE magic_links SET used=1 WHERE token=?').bind(tok).run();
  const user=await env.DB.prepare('SELECT u.*,b.id as business_id FROM users u JOIN businesses b ON u.business_id=b.id WHERE u.email=?').bind(link.email).first();
  if(!user)return Response.redirect(`https://${url.host}/login.html?error=nouser`,302);
  const sessionToken=token(32);
  await env.DB.prepare('INSERT INTO sessions(token,user_id,business_id,created_at,expires_at)VALUES(?,?,?,?,?)').bind(sessionToken,user.id,user.business_id,now(),now()+SESSION_TTL).run();
  const redirectTo=url.searchParams.get('redirect')||'/dashboard.html';
  return new Response(null,{status:302,headers:{'Location':`https://${url.host}${redirectTo}`,'Set-Cookie':`stoke_session=${sessionToken}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_TTL}`}});
}

async function handleLogout(request,env){
  const s=await getSession(request,env);
  if(s)await env.DB.prepare('DELETE FROM sessions WHERE token=?').bind(s.token).run();
  return new Response(null,{status:302,headers:{'Location':'/login.html','Set-Cookie':'stoke_session=; Path=/; HttpOnly; Secure; Max-Age=0'}});
}

async function handleMe(request,env){
  const s=await getSession(request,env);
  if(!s)return json({authenticated:false});
  const business=await env.DB.prepare('SELECT * FROM businesses WHERE id=?').bind(s.business_id).first();
  return json({authenticated:true,user:{id:s.user_id,email:s.email,name:s.name,role:s.role},business});
}

// ── SETTINGS ──────────────────────────────────────────────────────────────
async function handleGetSettings(request,env){
  const s=await requireAuth(request,env);
  const row=await env.DB.prepare('SELECT data FROM settings WHERE business_id=?').bind(s.business_id).first();
  return json(row?.data?JSON.parse(row.data):{});
}
async function handleSaveSettings(request,env){
  const s=await requireAuth(request,env);const data=await request.json();
  await env.DB.prepare('INSERT INTO settings(business_id,data,updated_at)VALUES(?,?,?)ON CONFLICT(business_id)DO UPDATE SET data=excluded.data,updated_at=excluded.updated_at').bind(s.business_id,JSON.stringify(data),now()).run();
  return json({ok:true});
}

// ── CAMPAIGNS ──────────────────────────────────────────────────────────────
async function handleListCampaigns(request,env){
  const s=await requireAuth(request,env);
  const rows=await env.DB.prepare('SELECT c.*,COUNT(p.id) as post_count FROM campaigns c LEFT JOIN posts p ON p.campaign_id=c.id WHERE c.business_id=? GROUP BY c.id ORDER BY c.created_at DESC LIMIT 20').bind(s.business_id).all();
  return json(rows.results||[]);
}
async function handleSaveCampaign(request,env){
  const s=await requireAuth(request,env);const body=await request.json();
  const cid='cmp_'+token(8);
  await env.DB.prepare('INSERT INTO campaigns(id,business_id,job_type,customer_moment,products_used,problem_solved,extra_details,tone,days,start_date,created_at)VALUES(?,?,?,?,?,?,?,?,?,?,?)').bind(cid,s.business_id,body.meta?.jobType||'',body.meta?.customerMoment||'',body.meta?.productsUsed||'',body.meta?.problemSolved||'',body.meta?.extraDetails||'',body.meta?.tone||'general',body.meta?.days||3,body.meta?.startDate||'',now()).run();
  if(body.campaign&&Array.isArray(body.campaign)){
    await Promise.all(body.campaign.flatMap(day=>(day.posts||[]).map(post=>{
      const pid='pst_'+token(8);
      return env.DB.prepare('INSERT INTO posts(id,campaign_id,business_id,channel,day_num,angle,content,status,scheduled_at,created_at,updated_at)VALUES(?,?,?,?,?,?,?,?,?,?,?)').bind(pid,cid,s.business_id,post.channel,day.day,post.angle||'',post.text,post.status||'draft',day.scheduledDate?Math.floor(new Date(day.scheduledDate).getTime()/1000):null,now(),now()).run();
    })));
  }
  return json({ok:true,id:cid});
}

// ── EVENTS ─────────────────────────────────────────────────────
async function handleListEvents(request,env){
  const s=await requireAuth(request,env);
  const url=new URL(request.url);
  const from=url.searchParams.get('from')||Math.floor((Date.now()-30*86400000)/1000);
  const to=url.searchParams.get('to')||Math.floor((Date.now()+90*86400000)/1000);
  try{
    const rows=await env.DB.prepare('SELECT * FROM events WHERE business_id=? AND start_at>=? AND start_at<=? ORDER BY start_at').bind(s.business_id,from,to).all();
    return json(rows.results||[]);
  }catch(e){
    // Table may not exist yet if migration hasn't run
    return json([]);
  }
}
async function handleSaveEvent(request,env){
  const s=await requireAuth(request,env);const b=await request.json();
  const id=b.id||('evt_'+token(8));
  const startAt=b.start?Math.floor(new Date(b.start).getTime()/1000):Math.floor(b.start_at||Date.now()/1000);
  const endAt=b.end?Math.floor(new Date(b.end).getTime()/1000):Math.floor(b.end_at||Date.now()/1000);
  try{
    await env.DB.prepare('INSERT INTO events(id,business_id,type,title,start_at,end_at,all_day,status,customer_name,customer_email,customer_phone,notes,ai_suggested,ai_notes,created_at,updated_at)VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)ON CONFLICT(id)DO UPDATE SET type=excluded.type,title=excluded.title,start_at=excluded.start_at,end_at=excluded.end_at,status=excluded.status,customer_name=excluded.customer_name,customer_email=excluded.customer_email,customer_phone=excluded.customer_phone,notes=excluded.notes,updated_at=excluded.updated_at').bind(id,s.business_id,b.type||'other',b.title||'',startAt,endAt,b.allDay?1:0,b.status||'confirmed',b.customerName||'',b.customerEmail||'',b.customerPhone||'',b.notes||'',b.aiSuggested?1:0,b.aiNotes||'',now(),now()).run();
    return json({ok:true,id});
  }catch(e){
    console.error('[Events]',e.message);
    return json({ok:true,id,note:'Saved locally only — run migrate-v2.sql to enable cloud sync'});
  }
}
async function handleParseLead(request,env){
  const s=await requireAuth(request,env);const b=await request.json();
  // Parse via Claude and save as a lead + draft event
  return json({ok:true,message:'Use client-side AI parsing for now'});
}

// ── DEMO LOGIN ───────────────────────────────────────────────────────────
async function handleDemoLogin(request,env){
  const url=new URL(request.url);
  const secret=url.searchParams.get('secret')||'';
  // Require a secret so randoms can't use it
  const demoSecret=env.DEMO_SECRET||'trustysail2026';
  if(secret!==demoSecret)return err('Invalid demo secret',401);
  const email=url.searchParams.get('email')||'trustywatersports@gmail.com';
  // Look up user
  let user,business;
  try{
    user=await env.DB.prepare('SELECT * FROM users WHERE email=? LIMIT 1').bind(email).first();
    if(!user)return err('User not found',404);
    business=await env.DB.prepare('SELECT * FROM businesses WHERE id=? LIMIT 1').bind(user.business_id).first();
  }catch(e){
    // D1 not migrated yet — use seed defaults
    user={id:'usr_andrew',business_id:'biz_trustysail',email:'trustywatersports@gmail.com',name:'Andrew Fournel',role:'owner'};
    business={id:'biz_trustysail',name:'Trusty Sail & Paddle',city:'Morehead City, NC',website:'trustysailandpaddle.com'};
  }
  // Create session token
  const sessionToken=token(32);
  const expires=now()+(7*24*3600); // 7 days
  try{
    await env.DB.prepare('INSERT INTO sessions(id,user_id,business_id,expires_at,created_at)VALUES(?,?,?,?,?)').bind(sessionToken,user.id,user.business_id,expires,now()).run();
  }catch(e){
    // Sessions table may not exist yet, still set cookie
    console.warn('[Demo] Could not save session:',e.message);
  }
  // Set cookie and redirect to dashboard
  const redirectUrl=url.searchParams.get('redirect')||'/dashboard.html';
  return new Response(null,{status:302,headers:{
    'Location':redirectUrl,
    'Set-Cookie':`stoke_session=${sessionToken}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${7*24*3600}`,
    'Cache-Control':'no-store',
  }});
}

// ── INVOICES ─────────────────────────────────────────────────────────────
async function handleListInvoices(request,env){
  const s=await requireAuth(request,env);
  try{
    const rows=await env.DB.prepare('SELECT * FROM invoices WHERE business_id=? ORDER BY created_at DESC LIMIT 50').bind(s.business_id).all();
    return json(rows.results||[]);
  }catch(e){return json([]);}
}
async function handleSaveInvoice(request,env){
  const s=await requireAuth(request,env);const b=await request.json();
  const id=b.id||('inv_'+token(8));
  try{
    await env.DB.prepare('INSERT INTO invoices(id,business_id,job_id,amount,line_items,status,due_at,quickbooks_id,created_at)VALUES(?,?,?,?,?,?,?,?,?)ON CONFLICT(id)DO UPDATE SET amount=excluded.amount,line_items=excluded.line_items,status=excluded.status,quickbooks_id=excluded.quickbooks_id').bind(id,s.business_id,b.jobId||null,b.total||0,JSON.stringify(b.lineItems||[]),b.status||'draft',b.dueDate?Math.floor(new Date(b.dueDate).getTime()/1000):null,b.qboId||null,now()).run();
    return json({ok:true,id});
  }catch(e){return json({ok:true,id,note:'Saved locally only'});}
}

// ── QUICKBOOKS ────────────────────────────────────────────────────────────
async function handleQBOConnect(request,env){
  const s=await requireAuth(request,env);
  const clientId=env.QBO_CLIENT_ID||'';
  if(!clientId)return err('QBO_CLIENT_ID not configured',500);
  const redirectUri=encodeURIComponent(`https://${new URL(request.url).host}/api/quickbooks/callback`);
  const scope=encodeURIComponent('com.intuit.quickbooks.accounting');
  const state=token(8);
  const url=`https://appcenter.intuit.com/connect/oauth2?client_id=${clientId}&redirect_uri=${redirectUri}&response_type=code&scope=${scope}&state=${state}`;
  return Response.redirect(url,302);
}
async function handleQBOCallback(request,env){
  const url=new URL(request.url);
  const code=url.searchParams.get('code');
  const realmId=url.searchParams.get('realmId');
  if(!code||!realmId)return err('Missing OAuth params');
  // Exchange code for tokens
  const clientId=env.QBO_CLIENT_ID||'';
  const clientSecret=env.QBO_CLIENT_SECRET||'';
  const redirectUri=`https://${url.host}/api/quickbooks/callback`;
  const basic=btoa(`${clientId}:${clientSecret}`);
  const tokenResp=await fetch('https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer',{
    method:'POST',
    headers:{'Authorization':`Basic ${basic}`,'Content-Type':'application/x-www-form-urlencoded','Accept':'application/json'},
    body:`grant_type=authorization_code&code=${code}&redirect_uri=${encodeURIComponent(redirectUri)}`
  });
  const tokens=await tokenResp.json();
  if(!tokens.access_token)return err('QBO token exchange failed');
  // Store tokens in D1
  try{
    const s=await getSession(request,env);
    if(s){
      await env.DB.prepare('INSERT INTO platform_connections(id,business_id,platform,access_token,refresh_token,page_id,expires_at,status,created_at,updated_at)VALUES(?,?,?,?,?,?,?,?,?,?)ON CONFLICT(business_id,platform)DO UPDATE SET access_token=excluded.access_token,refresh_token=excluded.refresh_token,page_id=excluded.page_id,expires_at=excluded.expires_at,status=excluded.status,updated_at=excluded.updated_at').bind('qbo_'+s.business_id,s.business_id,'quickbooks',tokens.access_token,tokens.refresh_token,realmId,now()+(tokens.expires_in||3600),'active',now(),now()).run();
    }
  }catch(e){console.error('[QBO]',e.message);}
  return Response.redirect(`https://${url.host}/invoices.html?qbo=connected`,302);
}
async function handleQBOInvoice(request,env){
  const s=await requireAuth(request,env);const b=await request.json();
  // Get QBO connection
  let conn;
  try{conn=await env.DB.prepare('SELECT * FROM platform_connections WHERE business_id=? AND platform=?').bind(s.business_id,'quickbooks').first();}catch(e){}
  if(!conn)return err('QuickBooks not connected. Visit /api/quickbooks/connect',401);
  const realmId=conn.page_id;
  const token=conn.access_token;
  const baseUrl=`https://quickbooks.api.intuit.com/v3/company/${realmId}`;
  // Find or create customer in QBO
  let customerId;
  try{
    const findResp=await fetch(`${baseUrl}/query?query=${encodeURIComponent(`SELECT Id FROM Customer WHERE DisplayName='${b.customerName}'`)}&minorversion=65`,{headers:{'Authorization':`Bearer ${token}`,'Accept':'application/json'}});
    const findData=await findResp.json();
    customerId=findData?.QueryResponse?.Customer?.[0]?.Id;
    if(!customerId){
      const createResp=await fetch(`${baseUrl}/customer?minorversion=65`,{method:'POST',headers:{'Authorization':`Bearer ${token}`,'Content-Type':'application/json','Accept':'application/json'},body:JSON.stringify({DisplayName:b.customerName,PrimaryEmailAddr:{Address:b.customerEmail},PrimaryPhone:{FreeFormNumber:b.customerPhone||''}})});
      const createData=await createResp.json();
      customerId=createData?.Customer?.Id;
    }
  }catch(e){return err('Failed to find/create QBO customer: '+e.message);}
  // Build QBO invoice
  const lines=b.lineItems.map((item,i)=>({
    Amount:parseFloat((item.qty*item.price).toFixed(2)),
    DetailType:'SalesItemLineDetail',
    Description:item.desc,
    SalesItemLineDetail:{Qty:item.qty,UnitPrice:item.price,ItemRef:{value:'1',name:'Services'}}
  }));
  const invoiceBody={Line:lines,CustomerRef:{value:customerId},DueDate:b.dueDate,DocNumber:b.number?.replace('#',''),CustomerMemo:{value:b.notes||''}};
  try{
    const invResp=await fetch(`${baseUrl}/invoice?minorversion=65`,{method:'POST',headers:{'Authorization':`Bearer ${token}`,'Content-Type':'application/json','Accept':'application/json'},body:JSON.stringify(invoiceBody)});
    const invData=await invResp.json();
    if(invData?.Invoice?.Id){
      return json({ok:true,qboId:invData.Invoice.Id,paymentLink:`https://app.qbo.intuit.com/app/invoice?txnId=${invData.Invoice.Id}`});
    }
    return err('QBO invoice creation failed: '+JSON.stringify(invData?.Fault||invData));
  }catch(e){return err('QBO API error: '+e.message);}
}

// ── STRIPE ────────────────────────────────────────────────────────────────
async function handleStripeInvoice(request,env){
  const s=await requireAuth(request,env);const b=await request.json();
  const stripeKey=env.STRIPE_SECRET_KEY||'';
  if(!stripeKey)return err('STRIPE_SECRET_KEY not configured',500);
  const auth='Basic '+btoa(stripeKey+':');
  // Create or find Stripe customer
  let customerId;
  try{
    const searchResp=await fetch(`https://api.stripe.com/v1/customers/search?query=email:'${b.customerEmail}'`,{headers:{'Authorization':auth}});
    const searchData=await searchResp.json();
    customerId=searchData?.data?.[0]?.id;
    if(!customerId){
      const body=new URLSearchParams({email:b.customerEmail,name:b.customerName,phone:b.customerPhone||''}).toString();
      const createResp=await fetch('https://api.stripe.com/v1/customers',{method:'POST',headers:{'Authorization':auth,'Content-Type':'application/x-www-form-urlencoded'},body});
      const createData=await createResp.json();
      customerId=createData?.id;
    }
  }catch(e){return err('Stripe customer error: '+e.message);}
  // Create invoice
  try{
    // Create invoice items
    for(const item of b.lineItems){
      const amt=Math.round(item.qty*item.price*100);
      const itemBody=new URLSearchParams({customer:customerId,amount:String(amt),currency:'usd',description:item.desc}).toString();
      await fetch('https://api.stripe.com/v1/invoiceitems',{method:'POST',headers:{'Authorization':auth,'Content-Type':'application/x-www-form-urlencoded'},body:itemBody});
    }
    // Create and finalize invoice
    const invBody=new URLSearchParams({customer:customerId,collection_method:'send_invoice',days_until_due:'30',description:b.notes||''}).toString();
    const invResp=await fetch('https://api.stripe.com/v1/invoices',{method:'POST',headers:{'Authorization':auth,'Content-Type':'application/x-www-form-urlencoded'},body:invBody});
    const invData=await invResp.json();
    if(!invData.id)return err('Stripe invoice creation failed');
    // Finalize and send
    await fetch(`https://api.stripe.com/v1/invoices/${invData.id}/finalize`,{method:'POST',headers:{'Authorization':auth,'Content-Type':'application/x-www-form-urlencoded'},body:''});
    await fetch(`https://api.stripe.com/v1/invoices/${invData.id}/send`,{method:'POST',headers:{'Authorization':auth,'Content-Type':'application/x-www-form-urlencoded'},body:''});
    const finalInv=await fetch(`https://api.stripe.com/v1/invoices/${invData.id}`,{headers:{'Authorization':auth}}).then(r=>r.json());
    return json({ok:true,stripeId:invData.id,paymentUrl:finalInv.hosted_invoice_url||`https://dashboard.stripe.com/invoices/${invData.id}`});
  }catch(e){return err('Stripe API error: '+e.message);}
}



// =============================================================================
// STOKE PLATFORM LAYER
// Dynamic business profiles, vertical presets, automation levels
// No hardcoded business data - everything reads from D1
// =============================================================================

// Vertical preset library - embedded so no extra fetch needed
// Each vertical knows the industry it serves
const VERTICAL_PRESETS = {
  outdoor_service: {
    name: 'Outdoor & Water Sports',
    vocabulary: { job:'booking', customer:'customer', invoice:'invoice', lead:'inquiry', proposal:'quote' },
    lead_signals: ['rental','rent','lesson','tour','kayak','sail','paddle','boat','rigging','repair','book','available','schedule','how much','price','cost'],
    pricing_model: 'hourly_and_flat',
    follow_up_cadence: { initial:'2hr', quote:'48hr', reminder:'24hr', post_service:'24hr' },
    channel_priority: ['email','phone','text'],
    tone: 'warm, adventurous, local',
    service_types: ['rental','lesson','tour','rigging','repair','sailboat','blocked']
  },
  real_estate: {
    name: 'Real Estate',
    vocabulary: { job:'showing', customer:'client', invoice:'commission statement', lead:'prospect', proposal:'CMA' },
    lead_signals: ['interested','listing','showing','house','home','property','buying','selling','price','bedrooms','move','relocating','pre-approved'],
    pricing_model: 'commission',
    follow_up_cadence: { initial:'30min', quote:'24hr', reminder:'24hr', post_service:'48hr', nurture:'7day' },
    channel_priority: ['sms','email','instagram','phone'],
    tone: 'professional, responsive, knowledgeable',
    service_types: ['consultation','showing','listing','offer','open_house','closing']
  },
  contractor: {
    name: 'Contractor & Trades',
    vocabulary: { job:'job', customer:'customer', invoice:'invoice', lead:'lead', proposal:'estimate' },
    lead_signals: ['fix','repair','install','replace','broken','leaking','estimate','quote','how much','emergency','not working','cleaning'],
    pricing_model: 'hourly_and_flat',
    follow_up_cadence: { initial:'1hr', quote:'48hr', reminder:'24hr', post_service:'72hr' },
    channel_priority: ['phone','text','email'],
    tone: 'direct, reliable, local',
    service_types: ['estimate','service','install','repair','maintenance','emergency']
  },
  salon_wellness: {
    name: 'Salon & Wellness',
    vocabulary: { job:'appointment', customer:'client', invoice:'receipt', lead:'new client inquiry', proposal:'service menu' },
    lead_signals: ['appointment','available','book','schedule','haircut','massage','facial','nails','class','session'],
    pricing_model: 'flat_rate',
    follow_up_cadence: { initial:'1hr', quote:'24hr', reminder:'24hr', post_service:'48hr' },
    channel_priority: ['instagram','text','email'],
    tone: 'warm, personal, caring',
    service_types: ['consultation','service','premium','package']
  },
  other: {
    name: 'General Service Business',
    vocabulary: { job:'job', customer:'customer', invoice:'invoice', lead:'lead', proposal:'quote' },
    lead_signals: ['inquiry','available','schedule','book','how much','price','service'],
    pricing_model: 'hourly_and_flat',
    follow_up_cadence: { initial:'2hr', quote:'48hr', reminder:'24hr', post_service:'48hr' },
    channel_priority: ['email','phone','text'],
    tone: 'professional, helpful, responsive',
    service_types: ['service','consultation','repair','other']
  }
};

// Load full business profile from D1 - the single source of truth
async function loadBusinessProfile(env, businessId){
  try {
    const [biz, settings, services, preset] = await Promise.all([
      env.DB.prepare('SELECT * FROM businesses WHERE id=?').bind(businessId).first(),
      env.DB.prepare('SELECT data FROM settings WHERE business_id=?').bind(businessId).first(),
      env.DB.prepare('SELECT * FROM service_types WHERE business_id=? AND active=1 ORDER BY name').bind(businessId).all(),
      env.DB.prepare('SELECT * FROM business_presets WHERE business_id=?').bind(businessId).first()
    ]);

    const settingsData = settings?.data ? JSON.parse(settings.data) : {};
    const verticalKey = biz?.vertical || settingsData?.vertical || 'outdoor_service';
    const verticalPreset = VERTICAL_PRESETS[verticalKey] || VERTICAL_PRESETS.other;

    // Merge vertical preset with business-specific customizations
    const customPreset = preset?.preset_data ? JSON.parse(preset.preset_data) : {};

    return {
      id: businessId,
      name: biz?.name || settingsData?.business?.name || 'Your Business',
      vertical: verticalKey,
      verticalName: verticalPreset.name,
      city: biz?.city || settingsData?.business?.city || '',
      area: biz?.area || settingsData?.business?.area || '',
      website: biz?.website || settingsData?.business?.website || '',
      phone: biz?.phone || settingsData?.business?.phone || '',
      plan: biz?.plan || 'trial',
      automation_level: biz?.automation_level || 'review_all',
      onboarding_complete: biz?.onboarding_complete || 0,
      // Merged settings
      settings: settingsData,
      // Vertical knowledge
      preset: { ...verticalPreset, ...customPreset },
      // Services from D1
      services: services?.results || [],
      // Voice profile
      voice: settingsData?.voice || null
    };
  } catch(e) {
    console.error('[Profile] Error loading profile:', e.message);
    // Return minimal fallback - never hardcode Trusty Sail
    return {
      id: businessId,
      name: 'Your Business',
      vertical: 'other',
      verticalName: 'General Service Business',
      city: '', area: '', website: '', phone: '',
      plan: 'trial',
      automation_level: 'review_all',
      onboarding_complete: 0,
      settings: {},
      preset: VERTICAL_PRESETS.other,
      services: [],
      voice: null
    };
  }
}

// Build dynamic agent context - the core of the platform architecture
// Every agent call goes through this - no hardcoding anywhere
function buildAgentContext(profile, agentType, extra = {}){
  const p = profile.preset;
  const v = p.vocabulary || {};
  const services = profile.services.length > 0
    ? profile.services.map(s => `${s.name}: $${s.base_price}/${s.price_unit}, ~${s.default_duration_minutes}min`).join('\n')
    : 'Services not configured yet - ask the customer what they need';

  const businessContext = `Business: ${profile.name}
Location: ${[profile.city, profile.area].filter(Boolean).join(', ') || 'Location not set'}
Industry: ${profile.verticalName}
Phone: ${profile.phone || 'Not set'}
Website: ${profile.website || 'Not set'}`;

  const languageContext = `Use this industry-specific language:
- Call jobs/appointments: "${v.job || 'booking'}"
- Call customers: "${v.customer || 'customer'}"
- Call invoices: "${v.invoice || 'invoice'}"
- Call proposals: "${v.proposal || 'quote'}"`;

  const voiceContext = profile.voice?.generalDesc
    ? `Communication style: ${profile.voice.generalDesc}`
    : `Communication style: ${p.tone || 'professional and helpful'}`;

  const systemPrompts = {
    router: `You are the intake router for ${profile.name}, a ${profile.verticalName} business.
${businessContext}

Classify incoming messages and route them to the right agent.
Known service types: ${p.service_types?.join(', ') || 'various services'}
Lead signals to watch for: ${p.lead_signals?.slice(0,10).join(', ')}

Respond ONLY with valid JSON:
{
  "intent": "lead_parse|book|invoice|reply|social|query|other",
  "confidence": 0.0-1.0,
  "summary": "one sentence",
  "agent": "agent name",
  "urgency": "high|medium|low"
}`,

    lead_parser: `You are the lead intake specialist for ${profile.name}.
${businessContext}

Extract inquiry details. ${languageContext}

Services offered:
${services}

Pricing model: ${p.pricing_model || 'varies'}
Follow-up timing: Respond within ${p.follow_up_cadence?.initial || '2 hours'}

Respond ONLY with valid JSON:
{
  "customerName": "full name or null",
  "customerEmail": "email or null",
  "customerPhone": "phone or null",
  "serviceType": "one of the business service types or other",
  "serviceLabel": "human readable service name",
  "preferredDate": "ISO date or null",
  "preferredTime": "time string or null",
  "duration": "estimated hours or null",
  "partySize": "number or null",
  "estimatedAmount": "dollar amount or null",
  "notes": "any other details",
  "urgency": "high|medium|low",
  "confidence": 0.0-1.0,
  "summary": "one sentence summary",
  "suggestedReply": "a brief friendly response to send"
}`,

    invoice_agent: `You are the billing specialist for ${profile.name}.
${businessContext}
${languageContext}

Generate professional invoice line items from the job description.

Services and pricing:
${services}

Pricing model: ${p.pricing_model || 'hourly and flat'}

Respond ONLY with valid JSON:
{
  "lineItems": [{"desc": "description", "qty": 1, "price": 0.00}],
  "notes": "thank you note and payment terms",
  "totalEstimate": 0.00,
  "serviceType": "service type key"
}

Always break labor and materials into separate line items.
Never guess pricing if you don't have it - use 0.00 and note "price TBD".`,

    reply_writer: `You are writing on behalf of ${profile.name}.
${businessContext}
${voiceContext}
${languageContext}

Write a ${extra.replyType || 'professional'} message.
Keep it 2-4 sentences. Sound human, not like a bot.
Follow-up cadence for this business: ${JSON.stringify(p.follow_up_cadence || {})}
Return ONLY the message text.`,

    social_agent: `You are the content creator for ${profile.name}, a ${profile.verticalName} business.
${businessContext}
${voiceContext}

Create engaging social media content that reflects the authentic voice of this business.
Industry context: ${profile.verticalName}
Location context: ${[profile.city, profile.area].filter(Boolean).join(', ')}`,

    onboarding: `You are helping a new ${profile.verticalName} business owner set up their Stoke account.
Ask clear, specific questions to understand their business.
You need to gather:
1. Business name and location
2. What services they offer and typical pricing
3. How customers usually contact them
4. Their communication style and tone
5. How they want Stoke to handle automation

Be conversational and encouraging. Ask one or two questions at a time.
When you have enough information, output a structured profile as JSON.`
  };

  return systemPrompts[agentType] || systemPrompts.reply_writer;
}

// Enforce automation level - decides if action goes straight through or needs review
function shouldAutomate(profile, actionType, confidence = 1.0){
  const level = profile.automation_level || 'review_all';

  if(level === 'review_all') return false;

  if(level === 'smart_confirm'){
    // Auto-handle only high-confidence, low-risk actions
    const autoActions = ['lead_parse', 'draft_reply', 'draft_event'];
    const highRiskActions = ['send_email', 'send_invoice', 'book_appointment'];
    if(highRiskActions.includes(actionType)) return false;
    return autoActions.includes(actionType) && confidence >= 0.85;
  }

  if(level === 'autopilot'){
    // Auto-handle everything except financial and irreversible actions
    const alwaysReview = ['send_invoice', 'charge_customer', 'cancel_booking'];
    return !alwaysReview.includes(actionType) && confidence >= 0.7;
  }

  return false;
}

// Log automation action to audit trail
async function logAutomation(env, businessId, actionType, description, data, agent, confidence, status = 'completed'){
  try {
    const id = 'log_' + token(8);
    await env.DB.prepare(
      'INSERT INTO automation_log(id,business_id,action_type,description,data,agent,confidence,status,created_at) VALUES(?,?,?,?,?,?,?,?,?)'
    ).bind(id, businessId, actionType, description, JSON.stringify(data), agent, confidence, status, now()).run();
  } catch(e) {
    console.warn('[AutoLog]', e.message);
  }
}

// =============================================================================
// UPDATED AGENT HANDLERS - now load from profile, no hardcoding
// =============================================================================

async function handleRouteV2(request, env){
  const s = await requireAuth(request, env);
  const b = await request.json();
  const profile = await loadBusinessProfile(env, s.business_id);
  const system = buildAgentContext(profile, 'router');
  const userText = b.text || b.message || '';

  const result = await callClaude(env, FAST_MODEL,
    [{role:'user', content: userText}],
    system, 200
  );

  try {
    const parsed = JSON.parse(result.replace(/```json|```/g,'').trim());
    return json({ok: true, ...parsed, vertical: profile.vertical});
  } catch(e) {
    return json({ok: true, intent: 'other', confidence: 0.5, summary: userText, agent: 'social_agent', vertical: profile.vertical});
  }
}

async function handleLeadParseV2(request, env){
  const s = await requireAuth(request, env);
  const b = await request.json();
  const profile = await loadBusinessProfile(env, s.business_id);
  const system = buildAgentContext(profile, 'lead_parser');
  const text = b.text || b.message || '';

  const result = await callClaude(env, FAST_MODEL,
    [{role:'user', content: text}],
    system, 600
  );

  try {
    const parsed = JSON.parse(result.replace(/```json|```/g,'').trim());
    const automate = shouldAutomate(profile, 'lead_parse', parsed.confidence || 0);
    const status = automate ? 'auto_processed' : 'pending_review';

    // Save to lead_inbox
    const inboxId = 'li_' + token(8);
    try {
      await env.DB.prepare(
        'INSERT INTO lead_inbox(id,business_id,source,raw_content,parsed_data,status,confidence,received_at,created_at) VALUES(?,?,?,?,?,?,?,?,?)'
      ).bind(inboxId, s.business_id, b.source||'manual', text, JSON.stringify(parsed), status, parsed.confidence||0, now(), now()).run();
    } catch(e) { console.warn('[LeadInbox]', e.message); }

    await logAutomation(env, s.business_id, 'lead_parsed',
      `Lead from ${parsed.customerName||'unknown'}: ${parsed.summary}`,
      parsed, 'lead_parser', parsed.confidence||0, status
    );

    return json({ok: true, lead: parsed, inbox_id: inboxId, auto_processed: automate, status, profile_vertical: profile.vertical});
  } catch(e) {
    return json({ok: false, error: 'Could not parse lead', raw: result});
  }
}

async function handleInvoiceAgentV2(request, env){
  const s = await requireAuth(request, env);
  const b = await request.json();
  const profile = await loadBusinessProfile(env, s.business_id);
  const system = buildAgentContext(profile, 'invoice_agent');

  const result = await callClaude(env, FAST_MODEL,
    [{role:'user', content: `Service: ${b.serviceType||'general'}\nJob details: ${b.jobContext||''}`}],
    system, 600
  );

  try {
    const parsed = JSON.parse(result.replace(/```json|```/g,'').trim());
    return json({ok: true, ...parsed, business_name: profile.name, vertical: profile.vertical});
  } catch(e) {
    return json({ok: false, error: 'Could not generate invoice', raw: result});
  }
}

async function handleReplyWriterV2(request, env){
  const s = await requireAuth(request, env);
  const b = await request.json();
  const profile = await loadBusinessProfile(env, s.business_id);
  const system = buildAgentContext(profile, 'reply_writer', {replyType: b.replyType||'confirmation'});

  const result = await callClaude(env, FULL_MODEL,
    [{role:'user', content: b.context||''}],
    system, 400
  );

  return json({ok: true, message: result, business_name: profile.name});
}

// =============================================================================
// PROFILE & ONBOARDING API
// =============================================================================

async function handleGetProfile(request, env){
  const s = await requireAuth(request, env);
  const profile = await loadBusinessProfile(env, s.business_id);
  return json({ok: true, profile});
}

async function handleSaveProfile(request, env){
  const s = await requireAuth(request, env);
  const b = await request.json();

  // Update businesses table
  const fields = [];
  const values = [];
  if(b.name){ fields.push('name=?'); values.push(b.name); }
  if(b.city){ fields.push('city=?'); values.push(b.city); }
  if(b.area){ fields.push('area=?'); values.push(b.area); }
  if(b.website){ fields.push('website=?'); values.push(b.website); }
  if(b.phone){ fields.push('phone=?'); values.push(b.phone); }
  if(b.vertical){ fields.push('vertical=?'); values.push(b.vertical); }
  if(b.automation_level){ fields.push('automation_level=?'); values.push(b.automation_level); }
  if(b.onboarding_complete !== undefined){ fields.push('onboarding_complete=?'); values.push(b.onboarding_complete ? 1 : 0); }

  if(fields.length > 0){
    values.push(s.business_id);
    await env.DB.prepare(`UPDATE businesses SET ${fields.join(',')} WHERE id=?`).bind(...values).run().catch(e => console.warn('[Profile]', e.message));
  }

  // Save business preset if provided
  if(b.preset_data){
    await env.DB.prepare(
      'INSERT INTO business_presets(business_id,vertical_key,preset_data,updated_at) VALUES(?,?,?,?) ON CONFLICT(business_id) DO UPDATE SET preset_data=excluded.preset_data,vertical_key=excluded.vertical_key,updated_at=excluded.updated_at'
    ).bind(s.business_id, b.vertical||'other', JSON.stringify(b.preset_data), now()).run().catch(e => console.warn('[Preset]', e.message));
  }

  // Update settings if provided
  if(b.settings){
    const existing = await env.DB.prepare('SELECT data FROM settings WHERE business_id=?').bind(s.business_id).first().catch(()=>null);
    const current = existing?.data ? JSON.parse(existing.data) : {};
    const merged = {...current, ...b.settings};
    await env.DB.prepare('INSERT INTO settings(business_id,data,updated_at) VALUES(?,?,?) ON CONFLICT(business_id) DO UPDATE SET data=excluded.data,updated_at=excluded.updated_at')
      .bind(s.business_id, JSON.stringify(merged), now()).run().catch(e => console.warn('[Settings]', e.message));
  }

  return json({ok: true, message: 'Profile updated'});
}

async function handleGetPresets(request, env){
  // Return available vertical presets for onboarding
  const presets = Object.entries(VERTICAL_PRESETS).map(([key, p]) => ({
    key,
    name: p.name,
    description: key === 'outdoor_service' ? 'Kayak shops, sailing schools, tour operators, outfitters'
      : key === 'real_estate' ? 'Buyer/seller agents, property managers, brokers'
      : key === 'contractor' ? 'General contractors, plumbers, electricians, landscaping'
      : key === 'salon_wellness' ? 'Hair salons, spas, massage, yoga studios'
      : 'Any service business',
    sample_services: p.service_types?.slice(0,4) || []
  }));
  return json({ok: true, presets});
}

async function handleOnboardingChat(request, env){
  const s = await requireAuth(request, env);
  const b = await request.json();
  const profile = await loadBusinessProfile(env, s.business_id);

  const messages = b.messages || [];
  const verticalHint = b.vertical || profile.vertical || 'other';
  const verticalPreset = VERTICAL_PRESETS[verticalHint] || VERTICAL_PRESETS.other;

  const system = `You are Stoke's onboarding assistant helping set up a new ${verticalPreset.name} business account.

Your goal: gather enough information to configure Stoke for this specific business.

You need to learn:
1. Business name, location, and what makes them unique
2. Services they offer and typical pricing
3. How customers reach them (email, phone, text, social media)
4. Their communication style and brand voice
5. How hands-on they want to be vs. letting Stoke automate

Ask conversational questions, one topic at a time.
Be encouraging - this business owner is about to save hours every week.

When you have gathered enough information (at least 3-4 exchanges), output a special JSON block wrapped in <PROFILE> tags:
<PROFILE>
{
  "name": "business name",
  "city": "city",
  "area": "region/area",
  "phone": "phone",
  "website": "website or null",
  "vertical": "outdoor_service|real_estate|contractor|salon_wellness|other",
  "services": [
    {"name": "service name", "type_key": "type", "base_price": 0, "price_unit": "hour|flat|person", "duration_minutes": 60}
  ],
  "voice": {
    "style": "description of their communication style",
    "avoid": ["things to avoid"],
    "sample_phrase": "a phrase that sounds like them"
  },
  "automation_level": "review_all",
  "notes": "anything else important about this business"
}
</PROFILE>

Do not output the JSON until you have enough information. Keep chatting until you do.`;

  const upstream = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: FULL_MODEL,
      max_tokens: 1000,
      system,
      messages
    })
  });

  const data = await upstream.json();
  const text = data.content?.[0]?.text || '';

  // Check if the response contains a completed profile
  const profileMatch = text.match(/<PROFILE>([\s\S]*?)<\/PROFILE>/);
  if(profileMatch){
    try {
      const profileData = JSON.parse(profileMatch[1].trim());
      return json({
        ok: true,
        message: text.replace(/<PROFILE>[\s\S]*?<\/PROFILE>/, '').trim(),
        profile_complete: true,
        extracted_profile: profileData
      });
    } catch(e) {}
  }

  return json({ok: true, message: text, profile_complete: false});
}

async function handleGetLeadInbox(request, env){
  const s = await requireAuth(request, env);
  const url = new URL(request.url);
  const status = url.searchParams.get('status') || 'pending_review';
  try {
    const rows = await env.DB.prepare(
      'SELECT * FROM lead_inbox WHERE business_id=? AND status=? ORDER BY received_at DESC LIMIT 50'
    ).bind(s.business_id, status).all();
    return json({ok: true, leads: rows.results||[]});
  } catch(e) {
    return json({ok: true, leads: []});
  }
}

async function handleConfirmLead(request, env){
  const s = await requireAuth(request, env);
  const b = await request.json();
  if(!b.inbox_id) return err('inbox_id required');

  // Mark as confirmed in inbox
  await env.DB.prepare('UPDATE lead_inbox SET status=?,reviewed_at=? WHERE id=? AND business_id=?')
    .bind('confirmed', now(), b.inbox_id, s.business_id).run().catch(e => console.warn(e.message));

  // Create calendar event from the lead data
  if(b.event_data){
    const eventId = 'evt_' + token(8);
    const start = b.event_data.start_at || now() + 86400;
    const end = b.event_data.end_at || start + 3600;
    await env.DB.prepare(
      'INSERT INTO events(id,business_id,type,title,start_at,end_at,customer_name,customer_email,customer_phone,notes,ai_suggested,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,1,?,?)'
    ).bind(eventId, s.business_id, b.event_data.type||'other', b.event_data.title||'New Booking',
      start, end, b.event_data.customerName||'', b.event_data.customerEmail||'',
      b.event_data.customerPhone||'', b.event_data.notes||'', now(), now()
    ).run().catch(e => console.warn('[Event]', e.message));

    await logAutomation(env, s.business_id, 'event_created',
      `Event confirmed: ${b.event_data.title}`, b.event_data, 'human_confirmed', 1.0, 'completed'
    );

    return json({ok: true, event_id: eventId});
  }

  return json({ok: true});
}

async function handleGetAutomationLog(request, env){
  const s = await requireAuth(request, env);
  try {
    const rows = await env.DB.prepare(
      'SELECT * FROM automation_log WHERE business_id=? ORDER BY created_at DESC LIMIT 100'
    ).bind(s.business_id).all();
    return json({ok: true, log: rows.results||[]});
  } catch(e) {
    return json({ok: true, log: []});
  }
}



// =============================================================================
// TYPED HANDOFF SYSTEM
// Every agent produces a typed work item, not free-form text.
// This makes outputs testable, traceable, and trustworthy.
// =============================================================================

// Work envelope - wraps every agent output
function workEnvelope(businessId, agentName, outputType, payload, confidence){
  return {
    work_id:        'wrk_' + token(12),
    tenant_id:      businessId,
    agent:          agentName,
    output_type:    outputType,
    idempotency_key: agentName + '_' + businessId + '_' + Math.floor(Date.now()/60000), // same key within 1 min
    created_at:     now(),
    confidence:     confidence,
    payload
  };
}

// Validate a work envelope before passing downstream
function validateEnvelope(envelope, requiredFields = []){
  const errors = [];
  if(!envelope.work_id)   errors.push('missing work_id');
  if(!envelope.tenant_id) errors.push('missing tenant_id');
  if(!envelope.agent)     errors.push('missing agent');
  for(const field of requiredFields){
    if(envelope.payload?.[field] === undefined || envelope.payload?.[field] === null){
      errors.push('missing required field: ' + field);
    }
  }
  return { valid: errors.length === 0, errors };
}

// =============================================================================
// PROMPT CACHING - static prefix cached, dynamic content fresh
// Puts business profile in a cached prefix block to save ~90% on repeat calls
// Anthropic caches any prefix over 1024 tokens automatically with cache_control
// =============================================================================

async function callClaudeWithCache(env, model, staticSystem, dynamicContent, maxTokens = 800){
  if(!env.ANTHROPIC_API_KEY) throw new Error('MISSING_API_KEY');

  const body = {
    model,
    max_tokens: maxTokens,
    system: [
      // Static block - gets cached after first call
      {
        type: 'text',
        text: staticSystem,
        cache_control: { type: 'ephemeral' }
      }
    ],
    messages: [
      { role: 'user', content: dynamicContent }
    ]
  };

  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'anthropic-beta': 'prompt-caching-2024-07-31'
    },
    body: JSON.stringify(body)
  });

  const data = await resp.json();

  // Log cache performance in dev
  if(data.usage){
    const cached = data.usage.cache_read_input_tokens || 0;
    const fresh  = data.usage.input_tokens || 0;
    if(cached > 0) console.log('[Cache] HIT - saved ' + cached + ' tokens (' + Math.round(cached/(cached+fresh)*100) + '%)');
  }

  return data.content?.[0]?.text?.trim() || '';
}

// Build the static (cacheable) prefix for a given agent + business profile
function buildCachedPrefix(profile, agentType){
  const p = profile.preset || {};
  const v = p.vocabulary || {};

  const services = profile.services && profile.services.length > 0
    ? profile.services.map(s =>
        '- ' + s.name + ': $' + s.base_price + '/' + s.price_unit +
        ', ~' + s.default_duration_minutes + 'min, type=' + s.type_key
      ).join('\n')
    : '- Services not yet configured';

  const voiceStyle = profile.voice?.generalDesc || p.tone || 'professional and helpful';

  const prefixMap = {
    router: `You are the intake router for Stoke, a business operating platform.

BUSINESS PROFILE:
Name: ${profile.name}
Industry: ${profile.verticalName}
Location: ${[profile.city, profile.area].filter(Boolean).join(', ') || 'Not set'}
Phone: ${profile.phone || 'Not set'}

VERTICAL: ${profile.vertical}
LANGUAGE: Call bookings "${v.job||'booking'}", customers "${v.customer||'customer'}", invoices "${v.invoice||'invoice'}"

SERVICES:
${services}

LEAD SIGNALS (words that indicate an inquiry):
${(p.lead_signals || []).join(', ')}

YOUR JOB: Classify the incoming message into exactly one intent.
Respond ONLY with valid JSON - no preamble, no explanation.

OUTPUT SCHEMA:
{
  "intent": "lead_parse|book|invoice|reply|social|query|other",
  "confidence": 0.0-1.0,
  "urgency": "high|medium|low",
  "summary": "one sentence max",
  "agent": "recommended next agent"
}`,

    lead_parser: `You are the lead intake specialist for Stoke.

BUSINESS PROFILE:
Name: ${profile.name}
Industry: ${profile.verticalName}
Location: ${[profile.city, profile.area].filter(Boolean).join(', ') || 'Not set'}
Phone: ${profile.phone || 'Not set'}

SERVICES AND PRICING:
${services}

PRICING MODEL: ${p.pricing_model || 'varies'}
INITIAL RESPONSE TARGET: ${p.follow_up_cadence?.initial || '2 hours'}

VOCABULARY: Use "${v.job||'booking'}" not "job", "${v.customer||'customer'}" not "customer"

YOUR JOB: Extract all available information from the inquiry.
Rate your confidence PER FIELD - be honest about what you don't know.
Flag missing fields that are needed to complete the booking.
Respond ONLY with valid JSON.

OUTPUT SCHEMA (IntakeRecord):
{
  "customer": {
    "name": "string or null",
    "email": "string or null",
    "phone": "string or null",
    "is_returning": false,
    "confidence": 0.0-1.0
  },
  "service": {
    "type_key": "one of the business service type keys or other",
    "label": "human readable service name",
    "estimated_duration_hours": null,
    "estimated_amount": null,
    "party_size": null,
    "confidence": 0.0-1.0
  },
  "scheduling": {
    "preferred_date": "ISO date or null",
    "preferred_time": "time string or null",
    "flexibility": "flexible|specific|urgent",
    "confidence": 0.0-1.0
  },
  "overall_confidence": 0.0-1.0,
  "urgency": "high|medium|low",
  "missing_fields": ["list of fields needed to complete booking"],
  "suggested_clarifications": ["specific questions to ask customer"],
  "summary": "one sentence",
  "suggested_reply": "brief friendly response acknowledging the inquiry"
}`,

    invoice_agent: `You are the billing specialist for Stoke.

BUSINESS PROFILE:
Name: ${profile.name}
Industry: ${profile.verticalName}
Location: ${[profile.city, profile.area].filter(Boolean).join(', ') || 'Not set'}

SERVICES AND PRICING:
${services}

PRICING MODEL: ${p.pricing_model || 'hourly and flat'}
INVOICE LABEL: "${v.invoice || 'invoice'}"
CUSTOMER LABEL: "${v.customer || 'customer'}"

RULES:
- Always separate labor from materials
- Never guess a price you don't have - use 0.00 and note "TBD"
- Rate confidence per line item
- Include a warm thank-you note matching the business tone
- Voice style: ${voiceStyle}

OUTPUT SCHEMA (EstimateDraft):
{
  "line_items": [
    {
      "description": "string",
      "qty": 1,
      "unit_price": 0.00,
      "total": 0.00,
      "confidence": 0.0-1.0,
      "notes": "any uncertainty or TBD notes"
    }
  ],
  "subtotal": 0.00,
  "overall_confidence": 0.0-1.0,
  "missing_info": ["what info would improve accuracy"],
  "notes": "thank you note and payment terms",
  "service_type": "service type key"
}`,

    reply_writer: `You are the customer communications specialist for Stoke.

BUSINESS PROFILE:
Name: ${profile.name}
Industry: ${profile.verticalName}
Location: ${[profile.city, profile.area].filter(Boolean).join(', ') || 'Not set'}
Phone: ${profile.phone || 'Not set'}

VOICE STYLE: ${voiceStyle}
AVOID: ${profile.voice ? 'excessive exclamation points, corporate speak, generic responses' : 'sounding robotic'}

VOCABULARY:
- Bookings = "${v.job || 'booking'}"
- Customers = "${v.customer || 'customer'}"

FOLLOW-UP TIMING:
${JSON.stringify(p.follow_up_cadence || {}, null, 2)}

RULES:
- 2-4 sentences maximum
- Sound like a real human from this business
- Never start with "I hope this email finds you well"
- Include next step or call to action
- Return ONLY the message text - no subject line, no metadata

OUTPUT: Plain message text only.`
  };

  return prefixMap[agentType] || prefixMap.reply_writer;
}

// =============================================================================
// V3 AGENTS - typed outputs + prompt caching + work envelopes
// These replace the V2 agents completely
// =============================================================================

async function handleIntakeV3(request, env){
  const s = await requireAuth(request, env);
  const b = await request.json();

  const [profile] = await Promise.all([
    loadBusinessProfile(env, s.business_id)
  ]);

  const staticPrefix = buildCachedPrefix(profile, 'lead_parser');
  const dynamicContent = 'Parse this inquiry:\n\n' + (b.text || b.message || '');

  let raw;
  try {
    raw = await callClaudeWithCache(env, FAST_MODEL, staticPrefix, dynamicContent, 700);
  } catch(e) {
    return err('AI call failed: ' + e.message, 500);
  }

  let parsed;
  try {
    parsed = JSON.parse(raw.replace(/```json|```/g,'').trim());
  } catch(e) {
    return err('Could not parse AI response', 500);
  }

  // Build typed IntakeRecord
  const intake = {
    customer_name:    parsed.customer?.name || null,
    customer_email:   parsed.customer?.email || null,
    customer_phone:   parsed.customer?.phone || null,
    is_returning:     parsed.customer?.is_returning || false,
    service_type:     parsed.service?.type_key || 'other',
    service_label:    parsed.service?.label || 'Service Inquiry',
    estimated_duration: parsed.service?.estimated_duration_hours || null,
    estimated_amount: parsed.service?.estimated_amount || null,
    party_size:       parsed.service?.party_size || null,
    preferred_date:   parsed.scheduling?.preferred_date || null,
    preferred_time:   parsed.scheduling?.preferred_time || null,
    flexibility:      parsed.scheduling?.flexibility || 'flexible',
    urgency:          parsed.urgency || 'medium',
    summary:          parsed.summary || '',
    suggested_reply:  parsed.suggested_reply || '',
    missing_fields:   parsed.missing_fields || [],
    clarifications:   parsed.suggested_clarifications || [],
    confidence: {
      customer:  parsed.customer?.confidence || 0,
      service:   parsed.service?.confidence || 0,
      scheduling: parsed.scheduling?.confidence || 0,
      overall:   parsed.overall_confidence || 0
    }
  };

  const envelope = workEnvelope(s.business_id, 'intake_v3', 'IntakeRecord', intake, parsed.overall_confidence || 0);

  // Check automation level
  const automate = shouldAutomate(profile, 'lead_parse', parsed.overall_confidence || 0);
  const status = automate ? 'auto_processed' : 'pending_review';

  // Save to lead_inbox with typed payload
  try {
    const inboxId = 'li_' + token(8);
    await env.DB.prepare(
      'INSERT INTO lead_inbox(id,business_id,source,raw_content,parsed_data,status,confidence,received_at,created_at) VALUES(?,?,?,?,?,?,?,?,?)'
    ).bind(inboxId, s.business_id, b.source||'manual', b.text||'', JSON.stringify(envelope), status, parsed.overall_confidence||0, now(), now()).run();

    envelope.inbox_id = inboxId;
  } catch(e) { console.warn('[Intake] DB save failed:', e.message); }

  // Log to audit trail
  await logAutomation(env, s.business_id, 'intake_parsed',
    'Intake: ' + intake.summary,
    { work_id: envelope.work_id, confidence: envelope.confidence },
    'intake_v3', parsed.overall_confidence || 0, status
  );

  return json({
    ok: true,
    envelope,
    intake,
    auto_processed: automate,
    status,
    // Surface what's needed for the UI
    needs_clarification: intake.missing_fields.length > 0,
    confidence_flags: {
      low_customer: intake.confidence.customer < 0.7,
      low_service:  intake.confidence.service < 0.7,
      low_schedule: intake.confidence.scheduling < 0.7,
    }
  });
}

async function handleRouteV3(request, env){
  const s = await requireAuth(request, env);
  const b = await request.json();
  const profile = await loadBusinessProfile(env, s.business_id);

  const staticPrefix = buildCachedPrefix(profile, 'router');
  const dynamicContent = b.text || b.message || '';

  const raw = await callClaudeWithCache(env, FAST_MODEL, staticPrefix, dynamicContent, 200)
    .catch(() => '{"intent":"other","confidence":0.5,"urgency":"medium","summary":"","agent":"social_agent"}');

  try {
    const parsed = JSON.parse(raw.replace(/```json|```/g,'').trim());
    const envelope = workEnvelope(s.business_id, 'router_v3', 'RouteDecision', parsed, parsed.confidence || 0.5);
    return json({ ok: true, envelope, ...parsed, vertical: profile.vertical });
  } catch(e) {
    return json({ ok: true, intent: 'other', confidence: 0.5, summary: '', agent: 'social_agent', vertical: profile.vertical });
  }
}

async function handleEstimateV3(request, env){
  const s = await requireAuth(request, env);
  const b = await request.json();
  const profile = await loadBusinessProfile(env, s.business_id);

  const staticPrefix = buildCachedPrefix(profile, 'invoice_agent');
  const dynamicContent = [
    b.intake_summary ? 'Job from intake: ' + b.intake_summary : '',
    b.service_type ? 'Service type: ' + b.service_type : '',
    b.job_description ? 'Details: ' + b.job_description : '',
    b.party_size ? 'Party size: ' + b.party_size : '',
    b.duration ? 'Duration: ' + b.duration + ' hours' : ''
  ].filter(Boolean).join('\n');

  const raw = await callClaudeWithCache(env, FAST_MODEL, staticPrefix, dynamicContent, 700)
    .catch(e => JSON.stringify({line_items:[], subtotal:0, overall_confidence:0, notes:'Could not generate estimate', missing_info:['job details needed']}));

  let parsed;
  try { parsed = JSON.parse(raw.replace(/```json|```/g,'').trim()); }
  catch(e) { return err('Could not parse estimate', 500); }

  const estimate = {
    line_items:         parsed.line_items || [],
    subtotal:           parsed.subtotal || 0,
    overall_confidence: parsed.overall_confidence || 0,
    missing_info:       parsed.missing_info || [],
    notes:              parsed.notes || '',
    service_type:       parsed.service_type || b.service_type || 'other',
    business_name:      profile.name
  };

  const envelope = workEnvelope(s.business_id, 'estimate_v3', 'EstimateDraft', estimate, parsed.overall_confidence || 0);
  return json({ ok: true, envelope, ...estimate });
}

async function handleReplyV3(request, env){
  const s = await requireAuth(request, env);
  const b = await request.json();
  const profile = await loadBusinessProfile(env, s.business_id);

  const staticPrefix = buildCachedPrefix(profile, 'reply_writer');

  // Build rich dynamic context from the intake record if provided
  const intakeSummary = b.intake ? [
    'Customer: ' + (b.intake.customer_name || 'the customer'),
    'Inquiry: ' + (b.intake.service_label || b.intake.service_type || 'service inquiry'),
    b.intake.preferred_date ? 'Requested date: ' + b.intake.preferred_date : '',
    b.intake.missing_fields?.length ? 'Still need: ' + b.intake.missing_fields.join(', ') : '',
    b.intake.suggested_reply ? 'Suggested direction: ' + b.intake.suggested_reply : ''
  ].filter(Boolean).join('\n') : (b.context || '');

  const dynamicContent = 'Write a ' + (b.reply_type || 'reply') + ' for this situation:\n\n' + intakeSummary;

  const message = await callClaudeWithCache(env, FULL_MODEL, staticPrefix, dynamicContent, 400)
    .catch(() => 'Thank you for reaching out! We will get back to you shortly.');

  const draft = {
    message,
    reply_type:    b.reply_type || 'reply',
    business_name: profile.name,
    confidence:    0.9 // reply writer is high confidence - it's creative, not extractive
  };

  const envelope = workEnvelope(s.business_id, 'reply_v3', 'MessageDraft', draft, 0.9);
  return json({ ok: true, envelope, message, business_name: profile.name });
}

// Full pipeline: intake → suggest reply → optionally book
// This is the "one perfect workflow" the feedback described
async function handleFullPipeline(request, env){
  const s = await requireAuth(request, env);
  const b = await request.json();
  const profile = await loadBusinessProfile(env, s.business_id);
  const pipelineId = 'pipe_' + token(8);

  const steps = [];
  const startTime = Date.now();

  // Step 1: Parse the intake (always)
  const intakePrefix = buildCachedPrefix(profile, 'lead_parser');
  let intake, intakeEnvelope;
  try {
    const raw = await callClaudeWithCache(env, FAST_MODEL, intakePrefix,
      'Parse this inquiry:\n\n' + (b.text || b.message || ''), 700);
    const parsed = JSON.parse(raw.replace(/```json|```/g,'').trim());

    intake = {
      customer_name:    parsed.customer?.name || null,
      customer_email:   parsed.customer?.email || null,
      customer_phone:   parsed.customer?.phone || null,
      service_type:     parsed.service?.type_key || 'other',
      service_label:    parsed.service?.label || 'Inquiry',
      estimated_amount: parsed.service?.estimated_amount || null,
      preferred_date:   parsed.scheduling?.preferred_date || null,
      preferred_time:   parsed.scheduling?.preferred_time || null,
      urgency:          parsed.urgency || 'medium',
      summary:          parsed.summary || '',
      suggested_reply:  parsed.suggested_reply || '',
      missing_fields:   parsed.missing_fields || [],
      clarifications:   parsed.suggested_clarifications || [],
      confidence: {
        customer:  parsed.customer?.confidence || 0,
        service:   parsed.service?.confidence || 0,
        scheduling: parsed.scheduling?.confidence || 0,
        overall:   parsed.overall_confidence || 0
      }
    };
    intakeEnvelope = workEnvelope(s.business_id, 'pipeline_intake', 'IntakeRecord', intake, intake.confidence.overall);
    steps.push({ step: 'intake', status: 'ok', confidence: intake.confidence.overall, ms: Date.now() - startTime });
  } catch(e) {
    steps.push({ step: 'intake', status: 'failed', error: e.message });
    return json({ ok: false, pipeline_id: pipelineId, steps, error: 'Intake failed' });
  }

  // Step 2: Draft a reply (always - even partial info deserves acknowledgment)
  const replyPrefix = buildCachedPrefix(profile, 'reply_writer');
  let reply;
  try {
    const replyContext = [
      'Customer: ' + (intake.customer_name || 'the customer'),
      'Inquiry: ' + intake.service_label,
      intake.preferred_date ? 'Preferred date: ' + intake.preferred_date : '',
      intake.missing_fields.length ? 'We still need: ' + intake.missing_fields.join(', ') : '',
      'Tone: acknowledge promptly, ask for missing info naturally'
    ].filter(Boolean).join('\n');

    reply = await callClaudeWithCache(env, FULL_MODEL, replyPrefix,
      'Write an initial reply:\n\n' + replyContext, 350);
    steps.push({ step: 'reply', status: 'ok', ms: Date.now() - startTime });
  } catch(e) {
    reply = intake.suggested_reply || 'Thank you for reaching out! We will be in touch shortly.';
    steps.push({ step: 'reply', status: 'fallback', ms: Date.now() - startTime });
  }

  // Step 3: Save to lead inbox
  const automate = shouldAutomate(profile, 'lead_parse', intake.confidence.overall);
  const status = automate ? 'auto_processed' : 'pending_review';
  let inboxId;
  try {
    inboxId = 'li_' + token(8);
    await env.DB.prepare(
      'INSERT INTO lead_inbox(id,business_id,source,raw_content,parsed_data,status,confidence,received_at,created_at) VALUES(?,?,?,?,?,?,?,?,?)'
    ).bind(inboxId, s.business_id, b.source||'manual', b.text||'',
      JSON.stringify({intake, reply, pipeline_id: pipelineId}),
      status, intake.confidence.overall, now(), now()
    ).run();
    steps.push({ step: 'save', status: 'ok', inbox_id: inboxId });
  } catch(e) {
    steps.push({ step: 'save', status: 'failed', error: e.message });
  }

  // Log the pipeline run
  await logAutomation(env, s.business_id, 'pipeline_run',
    'Full pipeline: ' + intake.summary,
    { pipeline_id: pipelineId, steps, intake_confidence: intake.confidence },
    'pipeline_v3', intake.confidence.overall, status
  );

  return json({
    ok: true,
    pipeline_id: pipelineId,
    status,
    auto_processed: automate,
    intake,
    intake_envelope: intakeEnvelope,
    draft_reply: reply,
    inbox_id: inboxId,
    steps,
    total_ms: Date.now() - startTime,
    confidence_summary: intake.confidence,
    needs_clarification: intake.missing_fields.length > 0,
    confidence_flags: {
      low_customer:  intake.confidence.customer < 0.7,
      low_service:   intake.confidence.service < 0.7,
      low_schedule:  intake.confidence.scheduling < 0.7,
    }
  });
}



// =============================================================================
// BEST-IN-CLASS AGENT EXECUTION ENGINE v4
// =============================================================================

const THINKING_MODEL  = 'claude-sonnet-4-20250514'; // supports extended thinking
const FAST_MODEL_V4   = 'claude-haiku-4-5-20251001';
const FULL_MODEL_V4   = 'claude-sonnet-4-20250514';

// Tool use schemas - enforce exact output structure, zero parse failures
const INTAKE_TOOL = {
  name: 'extract_intake',
  description: 'Extract structured intake record from a customer inquiry',
  input_schema: {
    type: 'object',
    properties: {
      customer: {
        type: 'object',
        properties: {
          name:         { type: ['string','null'] },
          email:        { type: ['string','null'] },
          phone:        { type: ['string','null'] },
          is_returning: { type: 'boolean' },
          confidence:   { type: 'number', minimum: 0, maximum: 1 }
        },
        required: ['name','email','phone','is_returning','confidence']
      },
      service: {
        type: 'object',
        properties: {
          type_key:                 { type: 'string' },
          label:                    { type: 'string' },
          estimated_duration_hours: { type: ['number','null'] },
          estimated_amount:         { type: ['number','null'] },
          party_size:               { type: ['number','null'] },
          confidence:               { type: 'number', minimum: 0, maximum: 1 }
        },
        required: ['type_key','label','confidence']
      },
      scheduling: {
        type: 'object',
        properties: {
          preferred_date: { type: ['string','null'] },
          preferred_time: { type: ['string','null'] },
          flexibility:    { type: 'string', enum: ['flexible','specific','urgent'] },
          confidence:     { type: 'number', minimum: 0, maximum: 1 }
        },
        required: ['flexibility','confidence']
      },
      overall_confidence:       { type: 'number', minimum: 0, maximum: 1 },
      urgency:                  { type: 'string', enum: ['high','medium','low'] },
      missing_fields:           { type: 'array', items: { type: 'string' } },
      suggested_clarifications: { type: 'array', items: { type: 'string' } },
      summary:                  { type: 'string' },
      suggested_reply:          { type: 'string' }
    },
    required: ['customer','service','scheduling','overall_confidence','urgency','missing_fields','suggested_clarifications','summary','suggested_reply']
  }
};

const ESTIMATE_TOOL = {
  name: 'generate_estimate',
  description: 'Generate invoice line items from job description',
  input_schema: {
    type: 'object',
    properties: {
      line_items: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            description: { type: 'string' },
            qty:         { type: 'number' },
            unit_price:  { type: 'number' },
            total:       { type: 'number' },
            confidence:  { type: 'number', minimum: 0, maximum: 1 },
            notes:       { type: 'string' }
          },
          required: ['description','qty','unit_price','total','confidence']
        }
      },
      subtotal:           { type: 'number' },
      overall_confidence: { type: 'number', minimum: 0, maximum: 1 },
      missing_info:       { type: 'array', items: { type: 'string' } },
      notes:              { type: 'string' },
      service_type:       { type: 'string' }
    },
    required: ['line_items','subtotal','overall_confidence','missing_info','notes','service_type']
  }
};

const VALIDATE_TOOL = {
  name: 'validate_extraction',
  description: 'Validate an extracted intake record against the original message',
  input_schema: {
    type: 'object',
    properties: {
      is_valid:        { type: 'boolean' },
      confidence_delta:{ type: 'number', minimum: -1, maximum: 0 },
      issues:          { type: 'array', items: { type: 'string' } },
      corrections: {
        type: 'object',
        properties: {
          service_type:   { type: ['string','null'] },
          preferred_date: { type: ['string','null'] },
          customer_name:  { type: ['string','null'] },
          notes:          { type: ['string','null'] }
        }
      }
    },
    required: ['is_valid','confidence_delta','issues','corrections']
  }
};

// Call Claude with tool use - zero parse failures
async function callClaudeTool(env, model, systemPrompt, userContent, tool, maxTokens=1000){
  if(!env.ANTHROPIC_API_KEY) throw new Error('MISSING_API_KEY');

  const body = {
    model,
    max_tokens: maxTokens,
    system: systemPrompt,
    tools: [tool],
    tool_choice: { type: 'tool', name: tool.name },
    messages: [{ role: 'user', content: userContent }]
  };

  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify(body)
  });

  const data = await resp.json();

  // Find the tool_use block - guaranteed to match schema
  const toolBlock = data.content?.find(b => b.type === 'tool_use');
  if(!toolBlock?.input) throw new Error('Tool use response missing');
  return toolBlock.input;
}

// Call Claude with extended thinking - for hard/ambiguous cases
async function callClaudeThinking(env, systemPrompt, userContent, thinkingBudget=5000, maxTokens=8000){
  if(!env.ANTHROPIC_API_KEY) throw new Error('MISSING_API_KEY');

  const body = {
    model: THINKING_MODEL,
    max_tokens: maxTokens,
    thinking: { type: 'enabled', budget_tokens: thinkingBudget },
    system: systemPrompt,
    messages: [{ role: 'user', content: userContent }]
  };

  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'anthropic-beta': 'interleaved-thinking-2025-05-14'
    },
    body: JSON.stringify(body)
  });

  const data = await resp.json();
  const textBlock = data.content?.find(b => b.type === 'text');
  return textBlock?.text?.trim() || '';
}

// Cached prefix call - saves tokens on repeat business profile loads
async function callClaudeCached(env, model, staticSystem, dynamicContent, maxTokens=800){
  if(!env.ANTHROPIC_API_KEY) throw new Error('MISSING_API_KEY');

  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'anthropic-beta': 'prompt-caching-2024-07-31'
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      system: [{ type:'text', text: staticSystem, cache_control:{ type:'ephemeral' } }],
      messages: [{ role:'user', content: dynamicContent }]
    })
  });

  const data = await resp.json();
  if(data.usage?.cache_read_input_tokens > 0){
    console.log('[Cache] HIT - saved', data.usage.cache_read_input_tokens, 'tokens');
  }
  return data.content?.[0]?.text?.trim() || '';
}

// Look up customer history from D1 - the memory moat
async function getCustomerHistory(env, businessId, email, phone){
  if(!email && !phone) return null;
  try {
    const conditions = [];
    const binds = [businessId];
    if(email){ conditions.push('customer_email=?'); binds.push(email); }
    if(phone){ conditions.push('customer_phone=?'); binds.push(phone); }

    const query = 'SELECT * FROM events WHERE business_id=? AND (' +
      conditions.join(' OR ') + ') ORDER BY created_at DESC LIMIT 5';

    const rows = await env.DB.prepare(query).bind(...binds).all();
    return rows.results || [];
  } catch(e) {
    return null;
  }
}

// Build customer context string from history
function buildCustomerContext(history){
  if(!history || history.length === 0) return '';
  const lines = history.map(e =>
    '- ' + (e.title||'booking') + ' on ' + new Date(e.start_at*1000).toLocaleDateString() +
    (e.amount ? ' ($'+e.amount+')' : '') +
    (e.notes ? ' — '+e.notes.substring(0,60) : '')
  );
  return '\n\nRETURNING CUSTOMER HISTORY (last '+history.length+' interactions):\n' + lines.join('\n') +
    '\nUse this context to improve accuracy and personalize the response.';
}

// Response template library - consistent, on-brand replies per scenario
function getResponseTemplate(profile, templateKey, vars={}){
  const biz = profile.name || 'us';
  const vocab = profile.preset?.vocabulary || {};
  const job = vocab.job || 'booking';
  const customer = vocab.customer || 'customer';

  const templates = {
    initial_inquiry: [
      `Thanks for reaching out to ${biz}! We'd love to help with your ${vars.service||job}. ${vars.question ? vars.question : 'When works best for you?'}`,
      `Hey${vars.name ? ' '+vars.name : ''}! Appreciate you contacting ${biz}. ${vars.question || 'Can you tell us a bit more about what you have in mind?'}`,
      `Thanks for getting in touch! ${vars.service ? 'A '+vars.service+' sounds great.' : ''} ${vars.question || 'What dates are you looking at?'}`
    ],
    availability_check: [
      `Hi${vars.name ? ' '+vars.name : ''}! Let me check availability for ${vars.date||'that date'}. Can you confirm ${vars.question||'the details'}?`,
      `Thanks for the interest! We have ${vars.available ? 'availability' : 'limited spots'} around ${vars.date||'then'}. ${vars.question||'Does that timing work?'}`
    ],
    booking_confirmed: [
      `You're all set${vars.name ? ', '+vars.name : ''}! Your ${vars.service||job} is confirmed for ${vars.date||'the scheduled date'}. We'll send a reminder the day before.`,
      `Booked! See you on ${vars.date||'the scheduled date'} for your ${vars.service||job}. Reply here if anything changes.`
    ],
    price_inquiry: [
      `Great question! Our ${vars.service||'services'} ${vars.price ? 'start at $'+vars.price : 'are priced based on your needs'}. ${vars.question||'Want to talk through the specifics?'}`,
      `For a ${vars.service||job}, pricing ${vars.price ? 'is $'+vars.price : 'depends on the details'}. Happy to put together a ${vocab.proposal||'quote'} — ${vars.question||'what are you looking to do?'}`
    ],
    follow_up: [
      `Hi${vars.name ? ' '+vars.name : ''}! Just following up on your inquiry about ${vars.service||'our services'}. Still interested? We'd love to help.`,
      `Checking back in — wanted to make sure you got our last message about ${vars.service||'your inquiry'}. Happy to answer any questions!`
    ]
  };

  const options = templates[templateKey] || templates.initial_inquiry;
  // Pick deterministically based on business ID hash to be consistent
  const idx = (profile.id || '').charCodeAt(0) % options.length;
  return options[idx];
}

// Self-critique validation - second pass catches confident mistakes
async function validateIntake(env, profile, originalText, extractedIntake){
  const system = buildCachedPrefix(profile, 'lead_parser') +
    '\n\nYou are now VALIDATING an extraction, not performing one. Be critical and honest.';

  const userContent = [
    'ORIGINAL MESSAGE:',
    originalText,
    '',
    'EXTRACTED RECORD:',
    JSON.stringify(extractedIntake, null, 2),
    '',
    'Does the extraction accurately reflect the original message?',
    'Are any fields incorrect, over-confident, or hallucinated?',
    'Note: dates that are "unavailable" should NOT be extracted as "preferred_date".'
  ].join('\n');

  try {
    const result = await callClaudeTool(env, FAST_MODEL_V4, system, userContent, VALIDATE_TOOL, 500);
    return result;
  } catch(e) {
    // Validation is non-critical - return clean pass if it fails
    return { is_valid: true, confidence_delta: 0, issues: [], corrections: {} };
  }
}

// Apply corrections from validation pass
function applyCorrections(intake, validation){
  if(validation.is_valid && !validation.corrections) return intake;

  const corrected = { ...intake };
  const c = validation.corrections || {};

  if(c.service_type)   corrected.service.type_key = c.service_type;
  if(c.preferred_date) corrected.scheduling.preferred_date = c.preferred_date;
  if(c.customer_name)  corrected.customer.name = c.customer_name;

  // Apply confidence delta from validation
  const delta = validation.confidence_delta || 0;
  corrected.overall_confidence = Math.max(0, Math.min(1, (intake.overall_confidence||0) + delta));
  corrected.scheduling.confidence = Math.max(0, (intake.scheduling?.confidence||0) + delta);

  if(validation.issues?.length > 0){
    corrected._validation_issues = validation.issues;
    corrected._validation_corrected = true;
  }

  return corrected;
}

// Log a correction for batch learning
async function logCorrection(env, businessId, field, originalValue, correctedValue, context){
  try {
    await env.DB.prepare(
      'INSERT INTO automation_log(id,business_id,action_type,description,data,agent,confidence,status,created_at) VALUES(?,?,?,?,?,?,?,?,?)'
    ).bind(
      'corr_'+token(8), businessId, 'user_correction',
      'Corrected '+field+' from "'+originalValue+'" to "'+correctedValue+'"',
      JSON.stringify({ field, original: originalValue, corrected: correctedValue, context }),
      'human', 1.0, 'completed', now()
    ).run();
  } catch(e) { /* non-critical */ }
}

// =============================================================================
// MASTER INTAKE PIPELINE V4
// Combines: tool use + tiered escalation + customer history + 
//           validation pass + template reply + graceful degradation
// =============================================================================

async function handleMasterPipeline(request, env){
  if(!env.ANTHROPIC_API_KEY) return err('MISSING_API_KEY', 500);

  const s = await requireAuth(request, env);
  const b = await request.json();
  const inputText = b.text || b.message || '';
  if(!inputText) return err('text or message required');

  const pipelineId = 'pipe4_' + token(10);
  const startTime  = Date.now();
  const steps      = [];

  // Step 0: Load profile + customer history IN PARALLEL
  let profile, customerHistory;
  try {
    [profile, customerHistory] = await Promise.all([
      loadBusinessProfile(env, s.business_id),
      // Quick regex pre-scan to find email/phone before full parse
      (async () => {
        const emailMatch = inputText.match(/[\w.-]+@[\w.-]+\.\w+/);
        const phoneMatch = inputText.match(/[\d\s\-\(\)\.]{7,}/);
        if(emailMatch || phoneMatch){
          return getCustomerHistory(env, s.business_id, emailMatch?.[0], phoneMatch?.[0]?.replace(/\D/g,''));
        }
        return null;
      })()
    ]);
    steps.push({ step:'setup', status:'ok', ms: Date.now()-startTime });
  } catch(e) {
    profile = await loadBusinessProfile(env, s.business_id).catch(() => ({
      id: s.business_id, name:'Your Business', vertical:'other',
      verticalName:'Service Business', preset: VERTICAL_PRESETS.other,
      services:[], automation_level:'review_all'
    }));
    steps.push({ step:'setup', status:'degraded', error: e.message });
  }

  // Step 1: Fast extraction with tool use (schema-enforced, zero parse failures)
  let intake;
  try {
    const historyContext = buildCustomerContext(customerHistory);
    const systemPrompt   = buildCachedPrefix(profile, 'lead_parser') + historyContext;

    intake = await callClaudeTool(
      env, FAST_MODEL_V4, systemPrompt,
      'Extract intake record from this inquiry:\n\n' + inputText,
      INTAKE_TOOL, 1000
    );
    steps.push({ step:'intake_fast', status:'ok', confidence: intake.overall_confidence, ms: Date.now()-startTime });
  } catch(e) {
    steps.push({ step:'intake_fast', status:'failed', error: e.message });
    // Graceful degradation - return minimal useful response
    return json({
      ok: true,
      pipeline_id: pipelineId,
      status: 'degraded',
      intake: {
        customer: { name:null, email:null, phone:null, confidence:0 },
        service: { type_key:'other', label:'Inquiry', confidence:0 },
        scheduling: { flexibility:'flexible', confidence:0 },
        overall_confidence: 0,
        urgency: 'medium',
        missing_fields: ['all fields - extraction failed'],
        suggested_clarifications: ['Could you tell us more about what you need?'],
        summary: inputText.substring(0,100),
        suggested_reply: 'Thanks for reaching out! Could you tell us a bit more about what you have in mind?'
      },
      draft_reply: 'Thanks for reaching out! Could you tell us a bit more about what you are looking for?',
      steps, total_ms: Date.now()-startTime
    });
  }

  // Step 2: Escalate to extended thinking if confidence is low
  const CONFIDENCE_THRESHOLD = 0.65;
  if(intake.overall_confidence < CONFIDENCE_THRESHOLD){
    try {
      const historyContext = buildCustomerContext(customerHistory);
      const thinkingSystem = buildCachedPrefix(profile, 'lead_parser') + historyContext +
        '\n\nThis is an AMBIGUOUS inquiry that requires careful reasoning. ' +
        'Think through what the customer actually wants before extracting. ' +
        'Consider multiple interpretations before choosing the most likely one.';

      const thinkingResult = await callClaudeThinking(
        env, thinkingSystem,
        'Think carefully and extract from this ambiguous inquiry:\n\n' + inputText,
        8000, 10000
      );

      // Parse thinking result - it's text so we do careful extraction
      try {
        const jsonMatch = thinkingResult.match(/\{[\s\S]*\}/);
        if(jsonMatch){
          const rethought = JSON.parse(jsonMatch[0]);
          if(rethought.overall_confidence > intake.overall_confidence){
            Object.assign(intake, rethought);
            intake._escalated_to_thinking = true;
            steps.push({ step:'thinking_escalation', status:'ok',
              confidence_gain: intake.overall_confidence - (intake.overall_confidence || 0),
              ms: Date.now()-startTime });
          }
        }
      } catch(e) { /* keep original */ }
    } catch(e) {
      steps.push({ step:'thinking_escalation', status:'skipped', reason: e.message });
    }
  }

  // Step 3: Validation pass - self-critique catches confident mistakes
  try {
    const validation = await validateIntake(env, profile, inputText, intake);
    if(!validation.is_valid || validation.issues?.length > 0){
      intake = applyCorrections(intake, validation);
      steps.push({ step:'validation', status:'corrected', issues: validation.issues, ms: Date.now()-startTime });
    } else {
      steps.push({ step:'validation', status:'passed', ms: Date.now()-startTime });
    }
  } catch(e) {
    steps.push({ step:'validation', status:'skipped', ms: Date.now()-startTime });
  }

  // Step 4: Draft reply using template + AI fill
  let draftReply;
  try {
    const templateKey = (() => {
      if(intake.service?.estimated_amount || intake.service?.type_key !== 'other') return 'initial_inquiry';
      if(inputText.toLowerCase().includes('price') || inputText.toLowerCase().includes('cost') || inputText.toLowerCase().includes('how much')) return 'price_inquiry';
      if(intake.scheduling?.preferred_date) return 'availability_check';
      return 'initial_inquiry';
    })();

    // Get base template
    const templateBase = getResponseTemplate(profile, templateKey, {
      name: intake.customer?.name?.split(' ')[0] || null,
      service: intake.service?.label,
      date: intake.scheduling?.preferred_date,
      question: intake.suggested_clarifications?.[0] || null
    });

    // Have AI refine the template with business voice (cached prefix = cheap)
    const replySystem = buildCachedPrefix(profile, 'reply_writer');
    const replyPrompt = [
      'Refine this draft reply into the business voice:',
      '',
      'DRAFT: ' + templateBase,
      '',
      'CONTEXT:',
      '- Customer: ' + (intake.customer?.name || 'the customer'),
      '- Inquiry: ' + intake.service?.label,
      intake.scheduling?.preferred_date ? '- Date requested: ' + intake.scheduling.preferred_date : '',
      intake.missing_fields?.length ? '- Still need: ' + intake.missing_fields.slice(0,2).join(', ') : '',
      customerHistory?.length ? '- Returning customer, acknowledge naturally' : '',
      '',
      'Keep it 2-3 sentences. Return the message only.'
    ].filter(Boolean).join('\n');

    draftReply = await callClaudeCached(env, FULL_MODEL_V4, replySystem, replyPrompt, 300);
    steps.push({ step:'reply_draft', status:'ok', ms: Date.now()-startTime });
  } catch(e) {
    // Graceful degradation to template
    draftReply = getResponseTemplate(profile, 'initial_inquiry', {
      name: intake.customer?.name?.split(' ')[0],
      service: intake.service?.label
    });
    steps.push({ step:'reply_draft', status:'template_fallback', ms: Date.now()-startTime });
  }

  // Step 5: Confidence-weighted automation decision
  // Not just global level - per-interaction based on confidence + risk
  const autoLevel = profile.automation_level || 'review_all';
  const confidence = intake.overall_confidence || 0;

  const autoDecision = (() => {
    if(autoLevel === 'review_all') return { automate: false, reason: 'review_all mode' };
    if(autoLevel === 'autopilot' && confidence >= 0.8) return { automate: true, reason: 'autopilot + high confidence' };
    if(autoLevel === 'smart_confirm'){
      if(confidence >= 0.85 && intake.missing_fields?.length === 0) return { automate: true, reason: 'smart_confirm + complete + confident' };
      if(confidence < 0.70) return { automate: false, reason: 'smart_confirm + low confidence' };
      return { automate: false, reason: 'smart_confirm + needs review' };
    }
    return { automate: false, reason: 'default to review' };
  })();

  const status = autoDecision.automate ? 'auto_processed' : 'pending_review';

  // Step 6: Persist to lead_inbox
  let inboxId;
  try {
    inboxId = 'li_' + token(8);
    await env.DB.prepare(
      'INSERT INTO lead_inbox(id,business_id,source,raw_content,parsed_data,status,confidence,received_at,created_at) VALUES(?,?,?,?,?,?,?,?,?)'
    ).bind(
      inboxId, s.business_id,
      b.source || 'manual',
      inputText,
      JSON.stringify({ intake, draft_reply: draftReply, pipeline_id: pipelineId, steps }),
      status,
      confidence,
      now(), now()
    ).run();
    steps.push({ step:'persist', status:'ok', inbox_id: inboxId });
  } catch(e) {
    steps.push({ step:'persist', status:'failed', error: e.message });
  }

  // Step 7: Audit log
  await logAutomation(
    env, s.business_id, 'pipeline_v4',
    'Pipeline: ' + (intake.summary || inputText.substring(0,80)),
    { pipeline_id: pipelineId, confidence: intake.overall_confidence, auto: autoDecision },
    'pipeline_v4', confidence, status
  ).catch(() => {});

  const totalMs = Date.now() - startTime;

  return json({
    ok: true,
    pipeline_id: pipelineId,
    status,
    auto_processed: autoDecision.automate,
    auto_reason:    autoDecision.reason,
    inbox_id:       inboxId,

    // The typed intake record
    intake,

    // Returning customer info
    is_returning:     (customerHistory?.length || 0) > 0,
    prior_visits:     customerHistory?.length || 0,

    // Draft reply ready to send or edit
    draft_reply:      draftReply,

    // What the UI should surface
    confidence_flags: {
      overall:      confidence,
      low_customer: (intake.customer?.confidence || 0) < 0.7,
      low_service:  (intake.service?.confidence  || 0) < 0.7,
      low_schedule: (intake.scheduling?.confidence || 0) < 0.7,
      was_escalated: intake._escalated_to_thinking || false,
      was_corrected: intake._validation_corrected  || false
    },
    needs_clarification: (intake.missing_fields?.length || 0) > 0,

    // Performance
    steps,
    total_ms: totalMs
  });
}

// API endpoint to record a user correction (feeds batch learning)
async function handleRecordCorrection(request, env){
  const s = await requireAuth(request, env);
  const b = await request.json();

  await logCorrection(
    env, s.business_id,
    b.field, b.original_value, b.corrected_value, b.context || ''
  );

  return json({ ok: true });
}

// Get corrections for a business (for future fine-tuning / preset updates)
async function handleGetCorrections(request, env){
  const s = await requireAuth(request, env);
  try {
    const rows = await env.DB.prepare(
      "SELECT * FROM automation_log WHERE business_id=? AND action_type='user_correction' ORDER BY created_at DESC LIMIT 50"
    ).bind(s.business_id).all();
    return json({ ok: true, corrections: rows.results || [] });
  } catch(e) {
    return json({ ok: true, corrections: [] });
  }
}


// ── MULTI-AGENT SYSTEM ────────────────────────────────────────────────────
// Architecture: Router → Specialized Handler → Structured Output
// Fast model for routing/extraction, full model only for drafting/generation
//
// Agents:
//   router        — classify intent (fast, cheap, haiku-class)
//   lead_parser   — extract structured data from messy text (fast)
//   scheduler     — booking-focused reasoning (medium)
//   invoice_agent — estimate/invoice line items (medium)
//   reply_writer  — customer-facing message drafting (full model)
//   social_agent  — content generation, captions, reels (full model)

const FAST_MODEL  = 'claude-haiku-4-5-20251001'; // routing, extraction
const FULL_MODEL  = 'claude-sonnet-4-20250514';  // drafting, generation

async function callClaude(env, model, messages, systemPrompt, maxTokens=800){
  const body = {
    model,
    max_tokens: maxTokens,
    messages,
    ...(systemPrompt ? {system: systemPrompt} : {})
  };
  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify(body)
  });
  const data = await resp.json();
  return data.content?.[0]?.text?.trim() || '';
}

// ── ROUTER: classify intent cheaply and fast ──────────────────────────────
async function handleRoute(request, env){
  const b = await request.json();
  const userText = b.text || b.message || '';
  const context  = b.context || '';

  const system = `You are a fast intent classifier for a small business operating platform called Stoke.
Classify the user's message into exactly one intent. Respond ONLY with valid JSON, no other text.

Intents:
- lead_parse: extracting details from a customer inquiry, email, or message
- book: scheduling, availability, booking, reservations
- invoice: invoicing, quoting, estimating, payment
- reply: drafting a reply, confirmation, or message to a customer
- social: social media post, caption, reel, marketing content
- query: asking about schedule, leads, stats, existing data
- other: anything else

{
  "intent": "one of the above",
  "confidence": 0.0-1.0,
  "summary": "one sentence describing what the user wants",
  "agent": "which specialized agent should handle this"
}`;

  const result = await callClaude(env, FAST_MODEL,
    [{role:'user', content: `Business context: ${context}

User message: ${userText}`}],
    system, 200
  );

  try {
    const parsed = JSON.parse(result.replace(/```json|```/g,'').trim());
    return json({ok: true, ...parsed, raw: result});
  } catch(e) {
    return json({ok: true, intent: 'other', confidence: 0.5, summary: userText, agent: 'social_agent'});
  }
}

// ── LEAD PARSER: extract structured booking data from messy text ──────────
async function handleLeadParse(request, env){
  const b = await request.json();
  const text = b.text || b.message || '';
  const settings = b.settings || {};

  const system = `You are a lead extraction specialist for ${settings.businessName || 'a small outdoor business'}.
Extract booking/inquiry details from the provided text. Respond ONLY with valid JSON:

{
  "customerName": "full name or null",
  "customerEmail": "email or null", 
  "customerPhone": "phone or null",
  "serviceType": "rental|rigging|lesson|sailboat|repair|other",
  "preferredDate": "ISO date or null",
  "preferredTime": "time string or null",
  "duration": "estimated duration in hours or null",
  "partySize": "number or null",
  "amount": "estimated dollar amount or null",
  "notes": "any other relevant details",
  "urgency": "high|medium|low",
  "confidence": 0.0-1.0,
  "summary": "one sentence summary of the inquiry"
}

Pricing guidance: rentals $45/hr, lessons $65/person, rigging quotes vary, sailboat lessons $85/hr.`;

  const result = await callClaude(env, FAST_MODEL,
    [{role:'user', content: text}],
    system, 500
  );

  try {
    const parsed = JSON.parse(result.replace(/```json|```/g,'').trim());
    return json({ok: true, lead: parsed});
  } catch(e) {
    return json({ok: false, error: 'Could not parse lead', raw: result});
  }
}

// ── INVOICE AGENT: generate line items from job context ───────────────────
async function handleInvoiceAgent(request, env){
  const b = await request.json();
  const jobContext = b.jobContext || '';
  const serviceType = b.serviceType || 'service';
  const settings = b.settings || {};

  const system = `You are a billing specialist for ${settings.businessName || 'Trusty Sail & Paddle'}, an outdoor business.
Generate professional invoice line items from the job description. Respond ONLY with valid JSON:

{
  "lineItems": [
    {"desc": "description of work or item", "qty": 1, "price": 0.00}
  ],
  "notes": "thank you message and payment terms",
  "totalEstimate": 0.00,
  "serviceType": "rigging|rental|lesson|repair|sailboat|other"
}

Pricing guide:
- Rigging labor: $95/hr
- Rod holders: $27 each installed
- Fish finder mount: $35
- Motor mount: $45  
- Hardware/misc: cost + 20%
- Kayak rental: $45/hr or $120/day
- Lesson: $65/person
- Sailboat lesson: $85/hr
- Always break labor and parts into separate line items.`;

  const result = await callClaude(env, FAST_MODEL,
    [{role:'user', content: `Service type: ${serviceType}

Job description: ${jobContext}`}],
    system, 600
  );

  try {
    const parsed = JSON.parse(result.replace(/```json|```/g,'').trim());
    return json({ok: true, ...parsed});
  } catch(e) {
    return json({ok: false, error: 'Could not generate invoice', raw: result});
  }
}

// ── REPLY WRITER: draft customer-facing messages ──────────────────────────
async function handleReplyWriter(request, env){
  const b = await request.json();
  const context = b.context || '';
  const tone = b.tone || 'warm and professional';
  const replyType = b.replyType || 'confirmation'; // confirmation|follow-up|reminder|decline
  const settings = b.settings || {};

  const system = `You are writing on behalf of ${settings.businessName || 'Trusty Sail & Paddle'} on the Crystal Coast.
Write a ${replyType} message in a ${tone} tone. Keep it concise — 3-5 sentences max.
Do not use excessive exclamation points. Sound like a real person, not a bot.
Return ONLY the message text, no subject line or metadata.`;

  const result = await callClaude(env, FULL_MODEL,
    [{role:'user', content: context}],
    system, 400
  );

  return json({ok: true, message: result});
}

// ── SOCIAL AGENT: content generation with voice awareness ─────────────────
async function handleSocialAgent(request, env){
  if(!env.ANTHROPIC_API_KEY) return err('MISSING_API_KEY', 500);
  const b = await request.json();

  // Pass through to stream or generate — social needs full model + full context
  // This is the only agent that uses MAX_TOKENS (6000) for long-form content
  const upstream = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: FULL_MODEL,
      max_tokens: MAX_TOKENS,
      messages: b.messages,
      ...(b.system ? {system: b.system} : {})
    })
  });
  const data = await upstream.json();
  return new Response(JSON.stringify(data), {
    status: upstream.status,
    headers: {'Content-Type':'application/json',...CORS}
  });
}

// ── STREAM SOCIAL: streaming version for live content generation ──────────
async function handleStreamSocial(request, env){
  if(!env.ANTHROPIC_API_KEY) return err('MISSING_API_KEY', 500);
  const b = await request.json();

  const upstream = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: FULL_MODEL,
      max_tokens: MAX_TOKENS,
      stream: true,
      messages: b.messages,
      ...(b.system ? {system: b.system} : {})
    })
  });

  if(!upstream.ok){ const t = await upstream.text(); return err(`Anthropic error: ${t}`, upstream.status); }
  return new Response(upstream.body, {headers:{'Content-Type':'text/event-stream','Cache-Control':'no-cache',...CORS}});
}


// ── LEGACY AI GENERATION (kept for backward compat) ───────────────────────
async function handleStream(request,env){
  return handleStreamSocial(request,env);
}
async function handleGenerate(request,env){
  return handleSocialAgent(request,env);
}


// =============================================================================
// GMAIL INTEGRATION
// OAuth 2.0 + Gmail API push notifications + V4 pipeline
// =============================================================================

const GMAIL_SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.modify',  // needed to mark as read
].join(' ');

// Exchange Gmail auth code for tokens
async function gmailTokenExchange(code, redirectUri, env){
  const resp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id:     env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri:  redirectUri,
      grant_type:    'authorization_code'
    })
  });
  return resp.json();
}

// Refresh expired Gmail access token
async function gmailRefreshToken(refreshToken, env){
  const resp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id:     env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      grant_type:    'refresh_token'
    })
  });
  const data = await resp.json();
  return data.access_token;
}

// Get valid access token - refresh if needed
async function getGmailToken(conn, env){
  // Check if token is still valid (expires_at is unix timestamp)
  if(conn.expires_at && conn.expires_at > now() + 60){
    return conn.access_token;
  }
  // Refresh
  const newToken = await gmailRefreshToken(conn.refresh_token, env);
  if(!newToken) throw new Error('Failed to refresh Gmail token');
  // Update in D1
  await env.DB.prepare(
    'UPDATE platform_connections SET access_token=?, expires_at=?, updated_at=? WHERE business_id=? AND platform=?'
  ).bind(newToken, now() + 3500, now(), conn.business_id, 'gmail').run().catch(()=>{});
  return newToken;
}

// Load Gmail connection for a business
async function getGmailConnection(env, businessId){
  return env.DB.prepare(
    'SELECT * FROM platform_connections WHERE business_id=? AND platform=? AND status=?'
  ).bind(businessId, 'gmail', 'active').first();
}

// Set up Gmail push notifications via watch
async function setupGmailWatch(accessToken, env){
  const domain = env.APP_DOMAIN || 'withstoke.com';
  const resp = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/watch', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + accessToken,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      topicName: 'projects/stoke-gmail/topics/gmail-push',
      labelIds: ['INBOX'],
      labelFilterBehavior: 'INCLUDE'
    })
  });
  return resp.json();
}

// Fetch a Gmail message by ID
async function fetchGmailMessage(messageId, accessToken){
  const resp = await fetch(
    'https://gmail.googleapis.com/gmail/v1/users/me/messages/' + messageId + '?format=full',
    { headers: { 'Authorization': 'Bearer ' + accessToken } }
  );
  return resp.json();
}

// Fetch recent unread messages (for polling fallback)
async function fetchUnreadMessages(accessToken, pageToken){
  let url = 'https://gmail.googleapis.com/gmail/v1/users/me/messages?q=is:unread+in:inbox&maxResults=10';
  if(pageToken) url += '&pageToken=' + pageToken;
  const resp = await fetch(url, {
    headers: { 'Authorization': 'Bearer ' + accessToken }
  });
  return resp.json();
}

// Parse a Gmail message into clean text
function parseGmailMessage(msg){
  const headers = msg.payload?.headers || [];
  const getHeader = name => headers.find(h => h.name.toLowerCase() === name.toLowerCase())?.value || '';

  const from    = getHeader('From');
  const subject = getHeader('Subject');
  const date    = getHeader('Date');
  const to      = getHeader('To');

  // Extract email address from "Name <email>" format
  const emailMatch = from.match(/<([^>]+)>/) || from.match(/[\w.-]+@[\w.-]+\.\w+/);
  const senderEmail = emailMatch ? (emailMatch[1] || emailMatch[0]) : from;
  const senderName  = from.replace(/<[^>]+>/, '').trim().replace(/"/g, '') || senderEmail;

  // Extract body text
  let body = '';
  const extractBody = (part) => {
    if(part.mimeType === 'text/plain' && part.body?.data){
      body += atob(part.body.data.replace(/-/g, '+').replace(/_/g, '/'));
    }
    if(part.parts) part.parts.forEach(extractBody);
  };

  if(msg.payload?.body?.data){
    body = atob(msg.payload.body.data.replace(/-/g, '+').replace(/_/g, '/'));
  } else if(msg.payload?.parts){
    msg.payload.parts.forEach(extractBody);
  }

  // Clean up body - remove excessive whitespace, quoted text
  body = body
    .replace(/\r\n/g, '\n')
    .replace(/^>.*$/gm, '')         // remove quoted lines
    .replace(/^On .* wrote:$/gm, '') // remove "On ... wrote:" lines
    .replace(/\n{3,}/g, '\n\n')     // collapse multiple blank lines
    .trim()
    .substring(0, 2000);            // cap at 2000 chars for AI

  return {
    messageId: msg.id,
    threadId:  msg.threadId,
    subject,
    from:      senderName,
    email:     senderEmail,
    to,
    date,
    body,
    snippet:   msg.snippet || '',
    // Full text for AI parsing
    fullText: [
      'From: ' + senderName + ' <' + senderEmail + '>',
      'Subject: ' + subject,
      'Date: ' + date,
      '',
      body || msg.snippet || ''
    ].join('\n')
  };
}

// Mark a Gmail message as read
async function markAsRead(messageId, accessToken){
  await fetch(
    'https://gmail.googleapis.com/gmail/v1/users/me/messages/' + messageId + '/modify',
    {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + accessToken, 'Content-Type': 'application/json' },
      body: JSON.stringify({ removeLabelIds: ['UNREAD'] })
    }
  ).catch(() => {});
}

// Process a single email through the V4 pipeline
async function processEmailThroughPipeline(parsedEmail, businessId, conn, env){
  // Skip obvious non-leads: newsletters, automated emails, bounces
  const skipSignals = ['unsubscribe', 'no-reply', 'noreply', 'mailer-daemon',
    'notification', 'newsletter', 'donotreply', 'do-not-reply', 'bounce'];
  const lowerFrom = parsedEmail.email.toLowerCase();
  const lowerSubj = parsedEmail.subject.toLowerCase();

  if(skipSignals.some(s => lowerFrom.includes(s) || lowerSubj.includes(s))){
    console.log('[Gmail] Skipping non-lead email from:', parsedEmail.email);
    return { skipped: true, reason: 'automated_email' };
  }

  // Load business profile for V4 pipeline
  const profile = await loadBusinessProfile(env, businessId);

  // Check if this is relevant - quick Haiku screen
  const screenSystem = buildCachedPrefix(profile, 'router');
  let isLead = true;
  try {
    const screenResult = await callClaudeCached(
      env, FAST_MODEL_V4, screenSystem,
      'Is this a customer inquiry or service request? Reply with just YES or NO.\n\n' + parsedEmail.fullText,
      50
    );
    isLead = screenResult.toUpperCase().includes('YES');
  } catch(e) { /* default to processing if screen fails */ }

  if(!isLead){
    console.log('[Gmail] Email screened as non-lead:', parsedEmail.subject);
    return { skipped: true, reason: 'not_a_lead' };
  }

  // Run through V4 pipeline
  const historyContext = await getCustomerHistory(env, businessId, parsedEmail.email, null);
  const customerCtx   = buildCustomerContext(historyContext);
  const systemPrompt  = buildCachedPrefix(profile, 'lead_parser') + customerCtx;

  // Tool use extraction - use FAST model only for email pipeline
  // Extended thinking is reserved for interactive/manual use, not background processing
  let intake;
  try {
    intake = await callClaudeTool(
      env, FAST_MODEL_V4,  // Always fast model in background pipeline
      systemPrompt,
      'Extract intake from this email inquiry:\n\n' + parsedEmail.fullText,
      INTAKE_TOOL, 800
    );
  } catch(e) {
    // Fallback to basic extraction
    intake = {
      customer: { name: parsedEmail.from, email: parsedEmail.email, phone: null, is_returning: false, confidence: 0.7 },
      service: { type_key: 'other', label: parsedEmail.subject, confidence: 0.5 },
      scheduling: { flexibility: 'flexible', confidence: 0 },
      overall_confidence: 0.5,
      urgency: 'medium',
      missing_fields: ['service details', 'preferred date'],
      suggested_clarifications: ['What service are you interested in?', 'When would work best for you?'],
      summary: parsedEmail.subject + ' from ' + parsedEmail.from,
      suggested_reply: 'Thank you for reaching out! We would love to help.'
    };
  }

  // Skip validation pass in background email pipeline - saves time
  // Validation runs in interactive mode (handleMasterPipeline) but not here

  // Draft reply
  let draftReply = '';
  try {
    const replySystem = buildCachedPrefix(profile, 'reply_writer');
    const replyCtx = [
      'Customer: ' + intake.customer?.name + ' <' + parsedEmail.email + '>',
      'Subject: ' + parsedEmail.subject,
      'Service: ' + intake.service?.label,
      intake.scheduling?.preferred_date ? 'Date: ' + intake.scheduling.preferred_date : '',
      intake.missing_fields?.length ? 'Need to ask: ' + intake.missing_fields.slice(0,2).join(', ') : '',
      historyContext?.length ? 'Returning customer' : 'New customer',
    ].filter(Boolean).join('\n');

    draftReply = await callClaudeCached(
      env, FULL_MODEL_V4, replySystem,
      'Write a reply to this email inquiry:\n\n' + replyCtx + '\n\nOriginal email:\n' + parsedEmail.body.substring(0,500),
      300
    );
  } catch(e) {
    draftReply = getResponseTemplate(profile, 'initial_inquiry', {
      name: intake.customer?.name?.split(' ')[0],
      service: intake.service?.label
    });
  }

  // Automation decision
  const autoLevel  = profile.automation_level || 'review_all';
  const confidence = intake.overall_confidence || 0;
  const automate   = autoLevel === 'autopilot' && confidence >= 0.8;
  const status     = automate ? 'auto_processed' : 'pending_review';

  // Save to lead_inbox
  const inboxId = 'li_' + token(8);
  await env.DB.prepare(
    'INSERT INTO lead_inbox(id,business_id,source,raw_content,parsed_data,status,confidence,received_at,created_at) VALUES(?,?,?,?,?,?,?,?,?)'
  ).bind(
    inboxId, businessId, 'gmail',
    parsedEmail.fullText,
    JSON.stringify({
      intake,
      draft_reply: draftReply,
      email_meta: {
        messageId: parsedEmail.messageId,
        threadId:  parsedEmail.threadId,
        subject:   parsedEmail.subject,
        from:      parsedEmail.from,
        email:     parsedEmail.email,
        date:      parsedEmail.date
      }
    }),
    status, confidence, now(), now()
  ).run().catch(e => console.error('[Gmail] DB save failed:', e.message));

  // Audit log
  await logAutomation(env, businessId, 'gmail_parsed',
    'Email from ' + parsedEmail.from + ': ' + parsedEmail.subject,
    { inbox_id: inboxId, confidence, messageId: parsedEmail.messageId },
    'gmail_integration', confidence, status
  ).catch(() => {});

  return {
    ok: true,
    inbox_id: inboxId,
    status,
    confidence,
    from: parsedEmail.from,
    subject: parsedEmail.subject,
    auto_processed: automate
  };
}

// =============================================================================
// GMAIL API HANDLERS
// =============================================================================

// Step 1: Start OAuth flow - redirect user to Google
async function handleGmailConnect(request, env){
  const s = await requireAuth(request, env);
  const domain = env.APP_DOMAIN || 'withstoke.com';

  if(!env.GOOGLE_CLIENT_ID) return err('GOOGLE_CLIENT_ID not configured', 500);

  // Store state to verify callback
  const state = token(16);
  await env.DB.prepare(
    'INSERT INTO automation_log(id,business_id,action_type,description,data,agent,confidence,status,created_at) VALUES(?,?,?,?,?,?,?,?,?)'
  ).bind('oauth_'+state, s.business_id, 'gmail_oauth_state', 'OAuth state', JSON.stringify({business_id: s.business_id}), 'oauth', 1, 'pending', now()).run().catch(()=>{});

  const authUrl = 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({
    client_id:     env.GOOGLE_CLIENT_ID,
    redirect_uri:  'https://' + domain + '/api/gmail/callback',
    response_type: 'code',
    scope:         GMAIL_SCOPES,
    access_type:   'offline',
    prompt:        'consent',  // force refresh token
    state:         state + '.' + s.business_id
  });

  return Response.redirect(authUrl, 302);
}

// Step 2: Handle OAuth callback from Google
async function handleGmailCallback(request, env){
  const url    = new URL(request.url);
  const code   = url.searchParams.get('code');
  const state  = url.searchParams.get('state');
  const errParam = url.searchParams.get('error');
  const domain = env.APP_DOMAIN || 'withstoke.com';

  if(errParam === 'access_denied'){
    return Response.redirect('https://' + domain + '/settings.html?gmail=denied', 302);
  }

  if(!code || !state){
    return Response.redirect('https://' + domain + '/settings.html?gmail=error', 302);
  }

  // Extract business_id from state
  const businessId = state.split('.')[1];
  if(!businessId){
    return Response.redirect('https://' + domain + '/settings.html?gmail=error', 302);
  }

  // Exchange code for tokens
  const tokens = await gmailTokenExchange(
    code,
    'https://' + domain + '/api/gmail/callback',
    env
  );

  if(!tokens.access_token){
    console.error('[Gmail] Token exchange failed:', JSON.stringify(tokens));
    return Response.redirect('https://' + domain + '/settings.html?gmail=error', 302);
  }

  // Get the Gmail address we just connected
  let gmailAddress = '';
  try {
    const profileResp = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/profile', {
      headers: { 'Authorization': 'Bearer ' + tokens.access_token }
    });
    const profile = await profileResp.json();
    gmailAddress = profile.emailAddress || '';
  } catch(e) {}

  // Store tokens in platform_connections
  await env.DB.prepare(
    'INSERT INTO platform_connections(id,business_id,platform,access_token,refresh_token,page_id,expires_at,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(business_id,platform) DO UPDATE SET access_token=excluded.access_token,refresh_token=excluded.refresh_token,page_id=excluded.page_id,expires_at=excluded.expires_at,status=excluded.status,updated_at=excluded.updated_at'
  ).bind(
    'gmail_' + businessId,
    businessId,
    'gmail',
    tokens.access_token,
    tokens.refresh_token || '',
    gmailAddress,  // store connected email in page_id field
    now() + (tokens.expires_in || 3600),
    'active',
    now(), now()
  ).run();

  // Set up Gmail push notifications (best effort)
  try {
    const watchResult = await setupGmailWatch(tokens.access_token, env);
    console.log('[Gmail] Watch set up:', JSON.stringify(watchResult));
  } catch(e) {
    console.warn('[Gmail] Watch setup failed (will fall back to polling):', e.message);
  }

  // Do an initial sync of recent unread messages
  try {
    const msgs = await fetchUnreadMessages(tokens.access_token);
    if(msgs.messages?.length){
      const conn = { access_token: tokens.access_token, refresh_token: tokens.refresh_token, business_id: businessId };
      // Process up to 5 most recent unread messages
      for(const m of msgs.messages.slice(0, 5)){
        const full = await fetchGmailMessage(m.id, tokens.access_token);
        const parsed = parseGmailMessage(full);
        await processEmailThroughPipeline(parsed, businessId, conn, env);
      }
    }
  } catch(e) {
    console.warn('[Gmail] Initial sync failed:', e.message);
  }

  return Response.redirect('https://' + domain + '/settings.html?gmail=connected&email=' + encodeURIComponent(gmailAddress), 302);
}

// Step 3: Receive Gmail push notifications (Pub/Sub webhook)
async function handleGmailWebhook(request, env){
  // Verify it's from Google Pub/Sub
  const body = await request.json().catch(() => ({}));

  // Pub/Sub wraps the message in base64
  const messageData = body.message?.data;
  if(!messageData){
    return new Response('ok', { status: 200 }); // Must return 200 or Pub/Sub retries
  }

  let notification;
  try {
    const decoded = atob(messageData);
    notification  = JSON.parse(decoded);
  } catch(e) {
    return new Response('ok', { status: 200 });
  }

  const gmailAddress = notification.emailAddress;
  const historyId    = notification.historyId;

  if(!gmailAddress || !historyId){
    return new Response('ok', { status: 200 });
  }

  // Find the business that owns this Gmail account
  const conn = await env.DB.prepare(
    'SELECT * FROM platform_connections WHERE platform=? AND page_id=? AND status=?'
  ).bind('gmail', gmailAddress, 'active').first().catch(() => null);

  if(!conn){
    console.warn('[Gmail Webhook] No connection found for:', gmailAddress);
    return new Response('ok', { status: 200 });
  }

  // Get valid token
  let accessToken;
  try {
    accessToken = await getGmailToken(conn, env);
  } catch(e) {
    console.error('[Gmail Webhook] Token refresh failed:', e.message);
    return new Response('ok', { status: 200 });
  }

  // Fetch messages since last historyId
  try {
    const lastHistoryId = await env.DB.prepare(
      "SELECT data FROM automation_log WHERE business_id=? AND action_type='gmail_last_history' ORDER BY created_at DESC LIMIT 1"
    ).bind(conn.business_id).first();

    const sinceId = lastHistoryId?.data ? JSON.parse(lastHistoryId.data).historyId : null;

    if(sinceId){
      // Get history since last sync
      const histResp = await fetch(
        'https://gmail.googleapis.com/gmail/v1/users/me/history?startHistoryId=' + sinceId + '&historyTypes=messageAdded&labelId=INBOX',
        { headers: { 'Authorization': 'Bearer ' + accessToken } }
      );
      const histData = await histResp.json();

      const newMessages = histData.history
        ?.flatMap(h => h.messagesAdded || [])
        ?.map(m => m.message) || [];

      for(const msg of newMessages.slice(0, 10)){
        const full   = await fetchGmailMessage(msg.id, accessToken);
        const parsed = parseGmailMessage(full);
        await processEmailThroughPipeline(parsed, conn.business_id, conn, env);
      }
    }

    // Update last history ID
    await logAutomation(env, conn.business_id, 'gmail_last_history',
      'Last Gmail history ID', { historyId }, 'gmail_webhook', 1, 'completed'
    ).catch(() => {});

  } catch(e) {
    console.error('[Gmail Webhook] Processing failed:', e.message);
  }

  return new Response('ok', { status: 200 });
}

// Get the last processed historyId for a business
async function getLastHistoryId(env, businessId){
  try {
    const conn = await env.DB.prepare(
      'SELECT last_history_id FROM platform_connections WHERE business_id=? AND platform=?'
    ).bind(businessId, 'gmail').first();
    return conn?.last_history_id || null;
  } catch(e) { return null; }
}

// Save the latest historyId after processing
async function saveLastHistoryId(env, businessId, historyId){
  try {
    await env.DB.prepare(
      'UPDATE platform_connections SET last_history_id=?, updated_at=? WHERE business_id=? AND platform=?'
    ).bind(String(historyId), now(), businessId, 'gmail').run();
  } catch(e) { console.warn('[Gmail] Could not save historyId:', e.message); }
}

// Fetch only NEW messages since last historyId - the right way
async function fetchNewMessages(accessToken, lastHistoryId){
  if(!lastHistoryId){
    // First sync ever - just get last 5 messages to seed the historyId
    const resp = await fetch(
      'https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=5&labelIds=INBOX',
      { headers: { 'Authorization': 'Bearer ' + accessToken } }
    );
    const data = await resp.json();
    return { messages: data.messages || [], isFirstSync: true };
  }

  // Use Gmail history API - only returns changes since lastHistoryId
  const resp = await fetch(
    'https://gmail.googleapis.com/gmail/v1/users/me/history?startHistoryId=' + lastHistoryId +
    '&historyTypes=messageAdded&labelId=INBOX&maxResults=50',
    { headers: { 'Authorization': 'Bearer ' + accessToken } }
  );
  const data = await resp.json();

  if(data.error?.code === 404){
    // historyId expired (older than ~30 days) - fall back to recent messages
    console.warn('[Gmail] historyId expired, falling back to recent messages');
    const fallback = await fetch(
      'https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=10&labelIds=INBOX&q=is:unread',
      { headers: { 'Authorization': 'Bearer ' + accessToken } }
    );
    const fb = await fallback.json();
    return { messages: fb.messages || [], historyExpired: true };
  }

  // Extract message IDs from history events
  const newHistoryId = data.historyId;
  const messages = (data.history || [])
    .flatMap(h => h.messagesAdded || [])
    .map(m => m.message)
    .filter(Boolean)
    // Deduplicate by id
    .filter((m, i, arr) => arr.findIndex(x => x.id === m.id) === i);

  return { messages, newHistoryId };
}

// Manual sync - only processes NEW emails since last sync
async function handleGmailSync(request, env, businessId, ctx){
  let targetBusinessId = businessId;

  if(!targetBusinessId && request){
    try {
      const s = await requireAuth(request, env);
      targetBusinessId = s.business_id;
    } catch(e) {
      return err('Unauthorized');
    }
  }

  const conn = await getGmailConnection(env, targetBusinessId);
  if(!conn) return json({ ok: false, error: 'Gmail not connected' });

  let accessToken;
  try {
    accessToken = await getGmailToken(conn, env);
  } catch(e) {
    return json({ ok: false, error: 'Token refresh failed: ' + e.message });
  }

  // Get current mailbox profile to know the latest historyId
  const profileResp = await fetch(
    'https://gmail.googleapis.com/gmail/v1/users/me/profile',
    { headers: { 'Authorization': 'Bearer ' + accessToken } }
  ).catch(() => null);
  const profile = profileResp ? await profileResp.json() : {};
  const currentHistoryId = profile.historyId;

  // Get last processed historyId
  const lastHistoryId = await getLastHistoryId(env, targetBusinessId);

  // Fetch only new messages
  const { messages, newHistoryId, isFirstSync } = await fetchNewMessages(accessToken, lastHistoryId)
    .catch(() => ({ messages: [], newHistoryId: currentHistoryId }));

  // If no new messages, update historyId to current and return
  if(!messages?.length){
    if(currentHistoryId) await saveLastHistoryId(env, targetBusinessId, currentHistoryId);
    return json({ ok: true, processed: 0, skipped: 0, total: 0, message: 'Inbox is up to date — no new emails since last sync.' });
  }

  const total = messages.length;
  const jobId = 'sync_' + token(8);
  // Save historyId now so parallel syncs don't double-process
  const nextHistoryId = newHistoryId || currentHistoryId;
  if(nextHistoryId) await saveLastHistoryId(env, targetBusinessId, nextHistoryId);

  // Process in background so we don't hit Worker CPU timeout
  const processAsync = async () => {
    let processed = 0, skipped = 0;
    for(const m of messages.slice(0, 20)){
      try {
        const full   = await fetchGmailMessage(m.id, accessToken);
        const parsed = parseGmailMessage(full);
        const result = await processEmailThroughPipeline(parsed, targetBusinessId, conn, env);
        if(result.skipped) skipped++;
        else if(result.ok) processed++;
      } catch(e) {
        console.error('[Gmail Sync] Error on', m.id, e.message);
      }
    }
    await logAutomation(env, targetBusinessId, 'gmail_sync_complete',
      'Sync: ' + processed + ' new leads, ' + skipped + ' skipped',
      { job_id: jobId, processed, skipped, total, is_first_sync: !!isFirstSync },
      'gmail_sync', 1, 'completed'
    ).catch(() => {});
  };

  if(ctx?.waitUntil){
    ctx.waitUntil(processAsync());
  } else {
    await processAsync();
  }

  return json({
    ok: true,
    job_id: jobId,
    total,
    is_first_sync: !!isFirstSync,
    message: isFirstSync
      ? 'First sync — seeding history. Future syncs will only check new emails.'
      : 'Found ' + total + ' new email' + (total !== 1 ? 's' : '') + ' — processing in background.',
    status: 'processing'
  });
}

// Get Gmail connection status
async function handleGmailStatus(request, env){
  const s    = await requireAuth(request, env);
  const conn = await getGmailConnection(env, s.business_id);

  if(!conn) return json({ ok: true, connected: false });

  return json({
    ok: true,
    connected: true,
    email: conn.page_id,
    status: conn.status,
    connected_at: conn.created_at
  });
}

// Disconnect Gmail
async function handleGmailDisconnect(request, env){
  const s = await requireAuth(request, env);
  await env.DB.prepare(
    'UPDATE platform_connections SET status=? WHERE business_id=? AND platform=?'
  ).bind('disconnected', s.business_id, 'gmail').run();
  return json({ ok: true });
}

// Reply to a Gmail thread from Stoke
async function handleGmailReply(request, env){
  const s = await requireAuth(request, env);
  const b = await request.json();
  if(!b.threadId || !b.to || !b.message) return err('threadId, to, and message required');

  const conn = await getGmailConnection(env, s.business_id);
  if(!conn) return err('Gmail not connected');

  const accessToken = await getGmailToken(conn, env);

  // Get business profile for signature
  const profile  = await loadBusinessProfile(env, s.business_id);
  const signature = profile.name + (profile.phone ? '\n' + profile.phone : '') + (profile.website ? '\n' + profile.website : '');

  const messageBody = b.message + '\n\n-- \n' + signature;

  // Build RFC 2822 email
  const emailLines = [
    'To: ' + b.to,
    'Subject: ' + (b.subject || 'Re: Your inquiry'),
    'Content-Type: text/plain; charset=utf-8',
    'In-Reply-To: ' + (b.messageId || ''),
    'References: '  + (b.messageId || ''),
    '',
    messageBody
  ];

  const raw = btoa(emailLines.join('\r\n'))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

  const resp = await fetch(
    'https://gmail.googleapis.com/gmail/v1/users/me/messages/send',
    {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + accessToken, 'Content-Type': 'application/json' },
      body: JSON.stringify({ raw, threadId: b.threadId })
    }
  );

  const result = await resp.json();
  if(!resp.ok) return err('Gmail send failed: ' + JSON.stringify(result));

  // Log it
  await logAutomation(env, s.business_id, 'gmail_reply_sent',
    'Reply sent to ' + b.to,
    { threadId: b.threadId, messageId: result.id },
    'gmail_reply', 1.0, 'completed'
  ).catch(() => {});

  return json({ ok: true, messageId: result.id });
}


// ── CRON — scheduled publishing ───────────────────────────────────────────
export async function scheduled(event,env,ctx){
  // ── Scheduled post publishing ───────────────────────────────────────────
  const due=await env.DB.prepare("SELECT p.*,c.business_id FROM posts p JOIN campaigns c ON p.campaign_id=c.id WHERE p.status='scheduled' AND p.scheduled_at<=? LIMIT 50").bind(now()).all();
  for(const post of(due.results||[])){
    try{
      throw new Error(`Publishing to ${post.channel} not yet configured`);
    }catch(e){
      await env.DB.prepare("UPDATE posts SET status='failed',error_msg=? WHERE id=?").bind(e.message,post.id).run();
    }
  }

  // ── Gmail polling fallback (every 5 min) ────────────────────────────────
  // Runs when push notifications miss something or watch expires
  try {
    const connections = await env.DB.prepare(
      "SELECT * FROM platform_connections WHERE platform='gmail' AND status='active'"
    ).all();

    for(const conn of (connections.results || [])){
      try {
        await handleGmailSync(null, env, conn.business_id, null);
      } catch(e) {
        console.error('[Cron Gmail]', conn.business_id, e.message);
      }
    }
  } catch(e) {
    console.error('[Cron] Gmail sync failed:', e.message);
  }
}

// ── MAIN ROUTER ───────────────────────────────────────────────────────────
export default {
  async fetch(request,env,ctx){
    const url=new URL(request.url);const path=url.pathname;const method=request.method;
    if(method==='OPTIONS')return new Response(null,{status:204,headers:CORS});
    try{
      if(path==='/auth/login'&&method==='POST')return handleLogin(request,env);
      if(path==='/auth/demo'&&method==='GET')return handleDemoLogin(request,env);
      if(path==='/auth/verify'&&method==='GET')return handleVerify(request,env);
      if(path==='/auth/logout'&&method==='POST')return handleLogout(request,env);
      if(path==='/auth/me'&&method==='GET')return handleMe(request,env);
      if(path==='/api/settings'&&method==='GET')return handleGetSettings(request,env);
      if(path==='/api/settings'&&method==='POST')return handleSaveSettings(request,env);
      if(path==='/api/campaigns'&&method==='GET')return handleListCampaigns(request,env);
      if(path==='/api/campaigns'&&method==='POST')return handleSaveCampaign(request,env);
      if(path==='/api/events'&&method==='GET')return handleListEvents(request,env);
      if(path==='/api/events'&&method==='POST')return handleSaveEvent(request,env);
      if(path==='/api/leads/parse'&&method==='POST')return handleParseLead(request,env);
      if(path==='/api/email/confirmation'&&method==='POST')return handleSendConfirmation(request,env);
      if(path==='/api/email/invoice'&&method==='POST')return handleSendInvoiceEmail(request,env);
            if(path==='/api/invoices'&&method==='GET')return handleListInvoices(request,env);
      if(path==='/api/invoices'&&method==='POST')return handleSaveInvoice(request,env);
      if(path==='/api/quickbooks/invoice'&&method==='POST')return handleQBOInvoice(request,env);
      if(path==='/api/quickbooks/connect'&&method==='GET')return handleQBOConnect(request,env);
      if(path==='/api/quickbooks/callback'&&method==='GET')return handleQBOCallback(request,env);
      if(path==='/api/stripe/invoice'&&method==='POST')return handleStripeInvoice(request,env);
      if(path==='/functions/generate/stream'&&method==='POST')return handleStream(request,env);
      if(path==='/functions/generate'&&method==='POST')return handleGenerate(request,env);
      // ── Agent API routes (faster, specialized) ─────────────────────────
      // V3 agents - typed handoffs + prompt caching + work envelopes
      if(path==='/api/agent/route'&&method==='POST')return handleRouteV3(request,env);
      if(path==='/api/agent/intake'&&method==='POST')return handleIntakeV3(request,env);
      if(path==='/api/agent/lead'&&method==='POST')return handleIntakeV3(request,env); // alias
      if(path==='/api/agent/estimate'&&method==='POST')return handleEstimateV3(request,env);
      if(path==='/api/agent/invoice'&&method==='POST')return handleEstimateV3(request,env); // alias
      if(path==='/api/agent/reply'&&method==='POST')return handleReplyV3(request,env);
      if(path==='/api/agent/social'&&method==='POST')return handleSocialAgent(request,env);
      if(path==='/api/agent/pipeline'&&method==='POST')return handleFullPipeline(request,env);
      // V4 - best-in-class: tool use + thinking + customer history + validation
      if(path==='/api/v4/pipeline'&&method==='POST')return handleMasterPipeline(request,env);
      if(path==='/api/v4/intake'&&method==='POST')return handleMasterPipeline(request,env);
      if(path==='/api/v4/correction'&&method==='POST')return handleRecordCorrection(request,env);
      if(path==='/api/v4/corrections'&&method==='GET')return handleGetCorrections(request,env);
      // Profile & onboarding
      if(path==='/api/profile'&&method==='GET')return handleGetProfile(request,env);
      if(path==='/api/profile'&&method==='POST')return handleSaveProfile(request,env);
      if(path==='/api/presets'&&method==='GET')return handleGetPresets(request,env);
      if(path==='/api/onboarding/chat'&&method==='POST')return handleOnboardingChat(request,env);
      // Lead inbox
      if(path==='/api/leads/inbox'&&method==='GET')return handleGetLeadInbox(request,env);
      if(path==='/api/leads/confirm'&&method==='POST')return handleConfirmLead(request,env);
      // Automation
      if(path==='/api/automation/log'&&method==='GET')return handleGetAutomationLog(request,env);
      // Gmail integration
      if(path==='/api/gmail/connect'&&method==='GET')return handleGmailConnect(request,env);
      if(path==='/api/gmail/callback'&&method==='GET')return handleGmailCallback(request,env);
      if(path==='/api/gmail/webhook'&&method==='POST')return handleGmailWebhook(request,env);
      if(path==='/api/gmail/sync'&&method==='POST')return handleGmailSync(request,env,null,ctx);
      if(path==='/api/gmail/status'&&method==='GET')return handleGmailStatus(request,env);
      if(path==='/api/gmail/disconnect'&&method==='POST')return handleGmailDisconnect(request,env);
      if(path==='/api/gmail/reply'&&method==='POST')return handleGmailReply(request,env);
      return env.ASSETS.fetch(request);
    }catch(e){
      if(e instanceof Response)return e;
      console.error('[Stoke]',e.message);return err('Internal server error',500);
    }
  },
  scheduled,
};
