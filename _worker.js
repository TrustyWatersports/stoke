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

async function sendMagicLink(email,tok,env){
  const domain=env.APP_DOMAIN||'stoke-1jn.pages.dev';
  const link=`https://${domain}/auth/verify?token=${tok}`;
  if(env.SENDGRID_API_KEY){
    const resp=await fetch('https://api.sendgrid.com/v3/mail/send',{method:'POST',headers:{'Authorization':`Bearer ${env.SENDGRID_API_KEY}`,'Content-Type':'application/json'},body:JSON.stringify({personalizations:[{to:[{email}]}],from:{email:env.FROM_EMAIL||'hello@withstoke.com',name:'Stoke'},subject:'Your Stoke login link',content:[{type:'text/html',value:`<div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:40px 20px"><div style="font-size:24px;font-weight:600;margin-bottom:24px">✦ Stoke</div><p style="font-size:16px;margin-bottom:32px">Click below to sign in. This link expires in 15 minutes.</p><a href="${link}" style="display:inline-block;background:#1a6b4a;color:white;padding:14px 28px;border-radius:8px;text-decoration:none;font-size:15px;font-weight:500">Sign in to Stoke</a></div>`}]})});
    if(!resp.ok)throw new Error(`SendGrid ${resp.status}`);
  } else {
    console.log(`[Stoke Auth] Magic link for ${email}: ${link}`);
  }
}

// ── AUTH ──────────────────────────────────────────────────────────────────
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

// ── AI GENERATION ─────────────────────────────────────────────────────────
async function handleStream(request,env){
  if(!env.ANTHROPIC_API_KEY)return err('MISSING_API_KEY',500);
  let body;try{body=await request.json();}catch(e){return err('Invalid request body');}
  if(!Array.isArray(body?.messages))return err('messages array required');
  const upstream=await fetch('https://api.anthropic.com/v1/messages',{method:'POST',headers:{'Content-Type':'application/json','x-api-key':env.ANTHROPIC_API_KEY,'anthropic-version':'2023-06-01'},body:JSON.stringify({model:MODEL,max_tokens:MAX_TOKENS,stream:true,messages:body.messages})});
  if(!upstream.ok){const t=await upstream.text();return err(`Anthropic error: ${t}`,upstream.status);}
  return new Response(upstream.body,{headers:{'Content-Type':'text/event-stream','Cache-Control':'no-cache',...CORS}});
}
async function handleGenerate(request,env){
  if(!env.ANTHROPIC_API_KEY)return err('MISSING_API_KEY',500);
  let body;try{body=await request.json();}catch(e){return err('Invalid request body');}
  if(!Array.isArray(body?.messages))return err('messages array required');
  const upstream=await fetch('https://api.anthropic.com/v1/messages',{method:'POST',headers:{'Content-Type':'application/json','x-api-key':env.ANTHROPIC_API_KEY,'anthropic-version':'2023-06-01'},body:JSON.stringify({model:MODEL,max_tokens:MAX_TOKENS,messages:body.messages})});
  const data=await upstream.json();
  return new Response(JSON.stringify(data),{status:upstream.status,headers:{'Content-Type':'application/json',...CORS}});
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
      if(path==='/auth/verify'&&method==='GET')return handleVerify(request,env);
      if(path==='/auth/logout'&&method==='POST')return handleLogout(request,env);
      if(path==='/auth/me'&&method==='GET')return handleMe(request,env);
      if(path==='/api/settings'&&method==='GET')return handleGetSettings(request,env);
      if(path==='/api/settings'&&method==='POST')return handleSaveSettings(request,env);
      if(path==='/api/campaigns'&&method==='GET')return handleListCampaigns(request,env);
      if(path==='/api/campaigns'&&method==='POST')return handleSaveCampaign(request,env);
      if(path==='/functions/generate/stream'&&method==='POST')return handleStream(request,env);
      if(path==='/functions/generate'&&method==='POST')return handleGenerate(request,env);
      return env.ASSETS.fetch(request);
    }catch(e){
      if(e instanceof Response)return e;
      console.error('[Stoke]',e.message);return err('Internal server error',500);
    }
  },
  scheduled,
};
