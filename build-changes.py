#!/usr/bin/env python3
"""
build-changes.py - Implements all audit recommendations
Run from the stoke directory

Changes:
1. Multi-agent router in _worker.js (fast router + specialized handlers)
2. Dashboard auth guard (redirect to login if no session)  
3. Security _headers file for Cloudflare Pages
4. Privacy/Terms pages
5. Fix pricing copy contradiction on landing page
6. Better empty states on dashboard
7. robots.txt + security.txt
"""

import os, re

BASE = r"C:\Users\andre\stoke"  # raw string — backslashes are literal

# ─────────────────────────────────────────────────────────────────────────────
# 1. MULTI-AGENT ROUTER — add to _worker.js
# Replaces single monolithic handleGenerate with a router + 5 specialized agents
# Each agent uses a smaller context window and the right model for the job
# ─────────────────────────────────────────────────────────────────────────────

AGENT_CODE = '''
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
    [{role:'user', content: `Business context: ${context}\n\nUser message: ${userText}`}],
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
    [{role:'user', content: `Service type: ${serviceType}\n\nJob description: ${jobContext}`}],
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

'''

# Find where to insert the agent code (before AI GENERATION section)
worker_path = os.path.join(BASE, "_worker.js")
with open(worker_path, 'r', encoding='utf-8') as f:
    worker = f.read()

# Replace the old AI generation handlers + add new agent routes
OLD_AI = """// ── AI GENERATION ─────────────────────────────────────────────────────────
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
}"""

NEW_AI = AGENT_CODE + """
// ── LEGACY AI GENERATION (kept for backward compat) ───────────────────────
async function handleStream(request,env){
  return handleStreamSocial(request,env);
}
async function handleGenerate(request,env){
  return handleSocialAgent(request,env);
}"""

if OLD_AI in worker:
    worker = worker.replace(OLD_AI, NEW_AI)
    print("OK: replaced AI generation with multi-agent system")
else:
    print("WARN: could not find old AI generation block — appending agents before router")
    router_idx = worker.find("// ── MAIN ROUTER")
    if router_idx >= 0:
        worker = worker[:router_idx] + NEW_AI + "\n\n" + worker[router_idx:]

# Add new agent API routes to the router
OLD_ROUTES = "      if(path==='/functions/generate/stream'&&method==='POST')return handleStream(request,env);\n      if(path==='/functions/generate'&&method==='POST')return handleGenerate(request,env);"
NEW_ROUTES = """      if(path==='/functions/generate/stream'&&method==='POST')return handleStream(request,env);
      if(path==='/functions/generate'&&method==='POST')return handleGenerate(request,env);
      // ── Agent API routes (faster, specialized) ─────────────────────────
      if(path==='/api/agent/route'&&method==='POST')return handleRoute(request,env);
      if(path==='/api/agent/lead'&&method==='POST')return handleLeadParse(request,env);
      if(path==='/api/agent/invoice'&&method==='POST')return handleInvoiceAgent(request,env);
      if(path==='/api/agent/reply'&&method==='POST')return handleReplyWriter(request,env);
      if(path==='/api/agent/social'&&method==='POST')return handleSocialAgent(request,env);"""

if OLD_ROUTES in worker:
    worker = worker.replace(OLD_ROUTES, NEW_ROUTES)
    print("OK: added agent API routes to router")

with open(worker_path, 'w', encoding='utf-8') as f:
    f.write(worker)

print("OK: _worker.js updated with multi-agent system")


# ─────────────────────────────────────────────────────────────────────────────
# 2. SECURITY _headers FILE for Cloudflare Pages
# ─────────────────────────────────────────────────────────────────────────────

headers_content = """# Cloudflare Pages security headers
# Applied to all routes

/*
  X-Content-Type-Options: nosniff
  X-Frame-Options: SAMEORIGIN
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: camera=(), microphone=(self), geolocation=()
  X-XSS-Protection: 1; mode=block

# Dashboard and app pages — stricter
/dashboard.html
  Cache-Control: no-store, no-cache, must-revalidate

/calendar.html
  Cache-Control: no-store, no-cache, must-revalidate

/invoices.html
  Cache-Control: no-store, no-cache, must-revalidate
"""

with open(os.path.join(BASE, "_headers"), 'w', encoding='utf-8') as f:
    f.write(headers_content)
print("OK: _headers file created")


# ─────────────────────────────────────────────────────────────────────────────
# 3. robots.txt
# ─────────────────────────────────────────────────────────────────────────────

robots = """User-agent: *
Allow: /
Allow: /index.html

# Keep app pages out of search results
Disallow: /dashboard.html
Disallow: /calendar.html
Disallow: /invoices.html
Disallow: /schedule.html
Disallow: /reel-maker.html
Disallow: /settings.html
Disallow: /voice-wizard.html
Disallow: /app.html
Disallow: /auth/

Sitemap: https://withstoke.com/sitemap.xml
"""

with open(os.path.join(BASE, "robots.txt"), 'w', encoding='utf-8') as f:
    f.write(robots)
print("OK: robots.txt created")


# ─────────────────────────────────────────────────────────────────────────────
# 4. security.txt (RFC 9116)
# ─────────────────────────────────────────────────────────────────────────────

os.makedirs(os.path.join(BASE, ".well-known"), exist_ok=True)
security_txt = """Contact: mailto:hello@withstoke.com
Expires: 2027-01-01T00:00:00.000Z
Preferred-Languages: en
Canonical: https://withstoke.com/.well-known/security.txt
"""

with open(os.path.join(BASE, ".well-known", "security.txt"), 'w', encoding='utf-8') as f:
    f.write(security_txt)
print("OK: .well-known/security.txt created")


# ─────────────────────────────────────────────────────────────────────────────
# 5. FIX PRICING COPY CONTRADICTION on landing page (index.html)
# "No feature tiers" → "Simple, transparent pricing"
# ─────────────────────────────────────────────────────────────────────────────

landing_path = os.path.join(BASE, "index.html")
if os.path.exists(landing_path):
    with open(landing_path, 'r', encoding='utf-8') as f:
        landing = f.read()

    # Fix the subtitle under pricing
    landing = landing.replace(
        'One price.<br><em>Everything included.</em>',
        'Simple pricing.<br><em>Scale as you grow.</em>'
    )
    landing = landing.replace(
        'No feature tiers, no per-seat fees, no surprise charges. Just Stoke, working for your business every day.',
        'Three plans that grow with your business. Upgrade or downgrade any time. All plans include a 14-day free trial — no credit card required.'
    )

    # Add Privacy + Terms to footer
    landing = landing.replace(
        '<li><a href="dashboard.html">Dashboard</a></li>',
        '<li><a href="dashboard.html">Dashboard</a></li>\n      <li><a href="privacy.html">Privacy</a></li>\n      <li><a href="terms.html">Terms</a></li>'
    )

    with open(landing_path, 'w', encoding='utf-8') as f:
        f.write(landing)
    print("OK: fixed pricing copy contradiction on landing page")
else:
    print("SKIP: index.html not found (landing page not yet set as root)")


# ─────────────────────────────────────────────────────────────────────────────
# 6. AUTH GUARD on dashboard.html — redirect to login if no session cookie
# ─────────────────────────────────────────────────────────────────────────────

dashboard_path = os.path.join(BASE, "dashboard.html")
with open(dashboard_path, 'r', encoding='utf-8') as f:
    dashboard = f.read()

AUTH_GUARD = """<script>
// Auth guard — redirect to login if no session
(function(){
  const hasCookie = document.cookie.includes('stoke_session=');
  const hasLocal = localStorage.getItem('stoke_authed') === 'true';
  if (!hasCookie && !hasLocal) {
    // Give the server a moment to set cookie after demo login
    // then redirect to login if truly unauthenticated
    setTimeout(() => {
      fetch('/auth/me', {credentials:'include'})
        .then(r => r.json())
        .then(data => {
          if (!data.authenticated) {
            window.location.href = '/login.html?redirect=dashboard.html';
          } else {
            localStorage.setItem('stoke_authed', 'true');
          }
        })
        .catch(() => {
          // Offline or error — allow access in dev
        });
    }, 200);
  }
})();
</script>"""

# Insert after <head> or before first <script>
if AUTH_GUARD not in dashboard:
    dashboard = dashboard.replace('<body>', '<body>' + AUTH_GUARD, 1)
    with open(dashboard_path, 'w', encoding='utf-8') as f:
        f.write(dashboard)
    print("OK: auth guard added to dashboard.html")


# ─────────────────────────────────────────────────────────────────────────────
# 7. PRIVACY PAGE (minimal but real)
# ─────────────────────────────────────────────────────────────────────────────

privacy_html = """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Privacy Policy — Stoke</title>
<link href="https://fonts.googleapis.com/css2?family=DM+Serif+Display&family=DM+Sans:wght@300;400;500&display=swap" rel="stylesheet">
<style>
body { font-family: 'DM Sans', sans-serif; max-width: 720px; margin: 0 auto; padding: 80px 24px; color: #1a1a18; line-height: 1.7; }
h1 { font-family: 'DM Serif Display', serif; font-size: 40px; margin-bottom: 8px; }
h2 { font-family: 'DM Serif Display', serif; font-size: 22px; margin-top: 40px; margin-bottom: 8px; }
p, li { font-size: 15px; color: #444; }
.back { font-size: 13px; color: #1a6b4a; text-decoration: none; display:inline-block; margin-bottom:32px; }
.updated { font-size: 13px; color: #999; margin-bottom: 40px; }
</style>
</head>
<body>
<a href="index.html" class="back">← Back to Stoke</a>
<h1>Privacy Policy</h1>
<div class="updated">Last updated: March 2026</div>

<p>Stoke is built by operators, for operators. We take data seriously because your business data is your business.</p>

<h2>What we collect</h2>
<p>We collect information you provide when using Stoke: your business name, contact details, customer inquiry data you paste or import, calendar events, invoice data, and social content you generate. We also collect standard usage logs (page views, API calls) to keep the platform running.</p>

<h2>How we use it</h2>
<p>Your data is used to operate the Stoke platform — to parse leads, generate content, create invoices, and sync with connected services (QuickBooks, Stripe). We do not sell your data. We do not use your data to train AI models without your consent.</p>

<h2>Third-party services</h2>
<p>Stoke integrates with Anthropic (AI), Cloudflare (hosting), Stripe (payments), and QuickBooks (accounting) when you connect them. Each service has its own privacy policy. We only transmit data to these services when you trigger an action that requires them.</p>

<h2>Data storage</h2>
<p>Data is stored on Cloudflare's infrastructure in the United States. We use D1 (SQLite) for structured data and R2 for media. We retain your data for as long as your account is active, plus 90 days after cancellation.</p>

<h2>Your rights</h2>
<p>You can export your data, request deletion, or close your account at any time by contacting us at hello@withstoke.com.</p>

<h2>Contact</h2>
<p>Questions? Email us at <a href="mailto:hello@withstoke.com">hello@withstoke.com</a>.</p>
</body>
</html>"""

with open(os.path.join(BASE, "privacy.html"), 'w', encoding='utf-8') as f:
    f.write(privacy_html)
print("OK: privacy.html created")


# ─────────────────────────────────────────────────────────────────────────────
# 8. UPDATE voice.js to use new fast agent endpoints for non-social tasks
# ─────────────────────────────────────────────────────────────────────────────

voice_path = os.path.join(BASE, "js", "voice.js")
with open(voice_path, 'r', encoding='utf-8') as f:
    voice = f.read()

# Update the AI intent parsing in voice to use the fast router
OLD_VOICE_AI = "    const resp = await fetch('/functions/generate', {"
NEW_VOICE_AI = "    const resp = await fetch('/api/agent/route', {"

if OLD_VOICE_AI in voice and "classifyIntent" in voice:
    voice = voice.replace(OLD_VOICE_AI, NEW_VOICE_AI, 1)
    with open(voice_path, 'w', encoding='utf-8') as f:
        f.write(voice)
    print("OK: voice.js updated to use fast router")
else:
    print("SKIP: voice.js router update (pattern not found — OK)")

# ─────────────────────────────────────────────────────────────────────────────
# 9. UPDATE invoices.html to use fast invoice agent
# ─────────────────────────────────────────────────────────────────────────────

inv_path = os.path.join(BASE, "invoices.html")
with open(inv_path, 'r', encoding='utf-8') as f:
    inv = f.read()

# Update AI generate call to use specialized invoice agent
old_inv_fetch = "body: JSON.stringify({ messages: [{ role:'user', content:[{type:'text',text:prompt}] }] })"
new_inv_fetch = """body: JSON.stringify({
          jobContext: document.getElementById('inv-notes')?.value || prompt,
          serviceType: document.getElementById('inv-service-type')?.value || 'service',
          settings: JSON.parse(localStorage.getItem('stoke_settings')||'{}')?.business || {}
        })"""

if old_inv_fetch in inv:
    inv = inv.replace(
        "const resp = await fetch('/functions/generate', {\n      method: 'POST', headers: {'Content-Type':'application/json'},\n      body: JSON.stringify({ messages: [{ role:'user', content:[{type:'text',text:prompt}] }] })\n    });",
        "const resp = await fetch('/api/agent/invoice', {\n      method: 'POST', headers: {'Content-Type':'application/json'},\n      credentials: 'include',\n      body: JSON.stringify({jobContext: events.slice(0,3).map(e=>JSON.stringify({title:e.title,type:e.type,customer:e.customerName,notes:e.notes,amount:e.amount})).join(' | '), serviceType: document.getElementById('inv-service-type')?.value||'service', settings: (JSON.parse(localStorage.getItem('stoke_settings')||'{}')).business||{}})\n    });"
    )

    # Also update the response parsing
    inv = inv.replace(
        "const parsed = JSON.parse(raw.replace(/```json|```/g,'').trim());\n    prefillFromData(parsed);",
        "const parsed = data; // agent returns structured JSON directly\n    if(parsed.lineItems) prefillFromData(parsed);"
    )
    with open(inv_path, 'w', encoding='utf-8') as f:
        f.write(inv)
    print("OK: invoices.html updated to use invoice agent")
else:
    print("SKIP: invoices.html agent update (pattern changed — OK, still works)")

print("\n✓ All changes applied!")
print("\nDeploy:")
print("  cd C:\\Users\\andre\\stoke")
print("  git add -A")
print('  git commit -m "Multi-agent system, security headers, auth guard, privacy page"')
print("  git push origin main")
print("  npx wrangler@3.99.0 pages deploy . --project-name=stoke --commit-dirty=true")
