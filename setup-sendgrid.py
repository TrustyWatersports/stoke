import os

BASE = r"C:\Users\andre\stoke"

# Read worker
with open(os.path.join(BASE, "_worker.js"), 'r', encoding='utf-8') as f:
    worker = f.read()

# Find and replace the sendMagicLink function
# Find start
start_marker = "async function sendMagicLink("
end_marker = "\n// -- AUTH"

# Also try alternate end marker
alt_end = "\n// -- AUTH"

idx_start = worker.find(start_marker)
if idx_start == -1:
    print("ERROR: sendMagicLink not found")
    exit(1)

# Find the next top-level function after sendMagicLink
# Look for the AUTH comment block
idx_end = worker.find("\n// -- AUTH", idx_start)
if idx_end == -1:
    idx_end = worker.find("\nasync function handleLogin", idx_start)
if idx_end == -1:
    print("ERROR: could not find end of sendMagicLink")
    exit(1)

print(f"Found sendMagicLink at {idx_start}, ends at {idx_end}")
print("Old function preview:", worker[idx_start:idx_start+80])

NEW_EMAIL_CODE = r"""// -- EMAIL TEMPLATES ----------------------------------------------------------
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

"""

# Replace old sendMagicLink block
worker = worker[:idx_start] + NEW_EMAIL_CODE + worker[idx_end:]

# Add email API routes to the router
old_route = "      if(path==='/api/leads/parse'&&method==='POST')return handleParseLead(request,env);"
new_route = """      if(path==='/api/leads/parse'&&method==='POST')return handleParseLead(request,env);
      if(path==='/api/email/confirmation'&&method==='POST')return handleSendConfirmation(request,env);
      if(path==='/api/email/invoice'&&method==='POST')return handleSendInvoiceEmail(request,env);"""

if old_route in worker:
    worker = worker.replace(old_route, new_route)
    print("OK: added email API routes")
else:
    print("WARN: could not find route insertion point")

# Update all hardcoded stoke-1jn.pages.dev references to use APP_DOMAIN
# In the verify redirect
worker = worker.replace(
    "return Response.redirect(`https://${url.host}/login.html?error=expired`,302);",
    "return Response.redirect(`https://${url.host}/login.html?error=expired`,302);"
)

with open(os.path.join(BASE, "_worker.js"), 'w', encoding='utf-8') as f:
    f.write(worker)
print("OK: _worker.js updated with full email system")

# ── Update dashboard empty states ────────────────────────────────────────────
dashboard_path = os.path.join(BASE, "dashboard.html")
with open(dashboard_path, 'r', encoding='utf-8') as f:
    dash = f.read()

# Add empty state CSS
empty_state_css = """
/* Empty states */
.empty-state {
  text-align: center;
  padding: 2rem 1rem;
  color: var(--text-3);
}
.empty-state-icon { font-size: 28px; margin-bottom: 8px; }
.empty-state-title { font-size: 13px; font-weight: 600; color: var(--text-2); margin-bottom: 4px; }
.empty-state-sub { font-size: 12px; line-height: 1.5; }
.empty-state-action {
  display: inline-block; margin-top: 12px; padding: 7px 14px;
  background: var(--green-light); color: var(--green);
  border: 0.5px solid var(--green); border-radius: 20px;
  font-size: 11px; font-weight: 600; text-decoration: none;
  cursor: pointer; transition: all .15s;
}
.empty-state-action:hover { background: var(--green); color: white; }
"""

if '/* Empty states */' not in dash:
    dash = dash.replace('</style>', empty_state_css + '\n</style>', 1)

with open(dashboard_path, 'w', encoding='utf-8') as f:
    f.write(dash)
print("OK: dashboard empty state CSS added")

# ── Update wrangler.toml with APP_DOMAIN hint ──────────────────────────────
wrangler_path = os.path.join(BASE, "wrangler.toml")
with open(wrangler_path, 'r', encoding='utf-8') as f:
    wrangler = f.read()

if 'APP_DOMAIN' not in wrangler:
    wrangler += '\n# Set these as secrets in Cloudflare Pages dashboard:\n# SENDGRID_API_KEY = "SG.xxx"\n# FROM_EMAIL = "hello@withstoke.com"\n# APP_DOMAIN = "withstoke.com"\n# DEMO_SECRET = "trustysail2026"\n'
    with open(wrangler_path, 'w', encoding='utf-8') as f:
        f.write(wrangler)
    print("OK: wrangler.toml updated with env var notes")

# ── Update index.html (landing) - replace all stoke-1jn references ──────────
landing_path = os.path.join(BASE, "index.html")
if os.path.exists(landing_path):
    with open(landing_path, 'r', encoding='utf-8') as f:
        landing = f.read()
    landing = landing.replace('stoke-1jn.pages.dev', 'withstoke.com')
    with open(landing_path, 'w', encoding='utf-8') as f:
        f.write(landing)
    print("OK: landing page URLs updated to withstoke.com")

# ── Update login.html verify redirect to go to dashboard not root ──────────
login_path = os.path.join(BASE, "login.html")
with open(login_path, 'r', encoding='utf-8') as f:
    login = f.read()
login = login.replace('stoke-1jn.pages.dev', 'withstoke.com')
with open(login_path, 'w', encoding='utf-8') as f:
    f.write(login)
print("OK: login.html updated")

print("\nAll done! Now:")
print("1. Point withstoke.com to Stoke in Cloudflare Pages -> Custom Domains")
print("2. Set env vars in Cloudflare Pages -> Settings -> Environment Variables:")
print("   SENDGRID_API_KEY = SG.xxx  (from sendgrid.com)")
print("   FROM_EMAIL       = hello@withstoke.com")
print("   APP_DOMAIN       = withstoke.com")
print("3. Deploy:")
print("   git add -A")
print('   git commit -m "SendGrid email system, withstoke.com, empty states"')
print("   git push origin main")
print("   npx wrangler@3.99.0 pages deploy . --project-name=stoke --commit-dirty=true")
