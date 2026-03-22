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
  const link = 'https://'+domain+'/auth/verify?token='+tok;
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
  return new Response(null,{status:302,headers:{'Location':`https://${url.host}/`,'Set-Cookie':`stoke_session=${sessionToken}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_TTL}`}});
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

// ── CRON — scheduled publishing ───────────────────────────────────────────
export async function scheduled(event,env,ctx){
  const due=await env.DB.prepare("SELECT p.*,c.business_id FROM posts p JOIN campaigns c ON p.campaign_id=c.id WHERE p.status='scheduled' AND p.scheduled_at<=? LIMIT 50").bind(now()).all();
  for(const post of(due.results||[])){
    try{
      // Platform publishing stubs — filled in after Meta App Review approval
      throw new Error(`Publishing to ${post.channel} not yet configured`);
    }catch(e){
      await env.DB.prepare("UPDATE posts SET status='failed',error_msg=? WHERE id=?").bind(e.message,post.id).run();
    }
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
      if(path==='/api/agent/route'&&method==='POST')return handleRoute(request,env);
      if(path==='/api/agent/lead'&&method==='POST')return handleLeadParse(request,env);
      if(path==='/api/agent/invoice'&&method==='POST')return handleInvoiceAgent(request,env);
      if(path==='/api/agent/reply'&&method==='POST')return handleReplyWriter(request,env);
      if(path==='/api/agent/social'&&method==='POST')return handleSocialAgent(request,env);
      return env.ASSETS.fetch(request);
    }catch(e){
      if(e instanceof Response)return e;
      console.error('[Stoke]',e.message);return err('Internal server error',500);
    }
  },
  scheduled,
};
