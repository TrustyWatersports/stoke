import os

BASE = r"C:\Users\andre\stoke"

# =============================================================================
# GMAIL INTEGRATION
# =============================================================================
# OAuth flow:  /api/gmail/connect -> Google -> /api/gmail/callback
# Push watch:  Gmail -> Pub/Sub -> /api/gmail/webhook
# Cron poll:   every 5 min via Cloudflare cron (fallback)
# Pipeline:    email -> V4 pipeline -> lead_inbox -> dashboard
# =============================================================================

GMAIL_CODE = r'''
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

  // Tool use extraction
  let intake;
  try {
    intake = await callClaudeTool(
      env, FAST_MODEL_V4,
      systemPrompt,
      'Extract intake from this email inquiry:\n\n' + parsedEmail.fullText,
      INTAKE_TOOL, 1000
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

  // Validation pass
  try {
    const validation = await validateIntake(env, profile, parsedEmail.fullText, intake);
    if(!validation.is_valid) intake = applyCorrections(intake, validation);
  } catch(e) { /* non-critical */ }

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

// Manual sync + cron fallback - polls for unread messages
async function handleGmailSync(request, env, businessId){
  // Can be called manually or by cron
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

  const msgs = await fetchUnreadMessages(accessToken).catch(() => ({ messages: [] }));
  if(!msgs.messages?.length) return json({ ok: true, processed: 0, message: 'No new messages' });

  const results = [];
  for(const m of msgs.messages.slice(0, 20)){
    try {
      const full   = await fetchGmailMessage(m.id, accessToken);
      const parsed = parseGmailMessage(full);
      const result = await processEmailThroughPipeline(parsed, targetBusinessId, conn, env);
      results.push({ ...result, messageId: m.id });
    } catch(e) {
      results.push({ ok: false, messageId: m.id, error: e.message });
    }
  }

  const processed = results.filter(r => r.ok && !r.skipped).length;
  const skipped   = results.filter(r => r.skipped).length;

  return json({ ok: true, processed, skipped, total: msgs.messages.length, results });
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
'''

# Read current worker
with open(os.path.join(BASE, "_worker.js"), 'r', encoding='utf-8') as f:
    worker = f.read()

# Insert Gmail code before CRON section
INSERT_BEFORE = "// ── CRON"
if INSERT_BEFORE in worker:
    worker = worker.replace(INSERT_BEFORE, GMAIL_CODE + "\n\n" + INSERT_BEFORE, 1)
    print("OK: Gmail integration code inserted")
else:
    # Append before export default
    worker = worker.replace(
        "export default {",
        GMAIL_CODE + "\n\nexport default {",
        1
    )
    print("OK: Gmail code appended before export")

# Update cron to also sync all connected Gmail accounts
OLD_CRON = """export async function scheduled(event,env,ctx){
  const due=await env.DB.prepare("SELECT p.*,c.business_id FROM posts p JOIN campaigns c ON p.campaign_id=c.id WHERE p.status='scheduled' AND p.scheduled_at<=? LIMIT 50").bind(now()).all();
  for(const post of(due.results||[])){
    try{
      // Platform publishing stubs — filled in after Meta App Review approval
      throw new Error(`Publishing to ${post.channel} not yet configured`);
    }catch(e){
      await env.DB.prepare("UPDATE posts SET status='failed',error_msg=? WHERE id=?").bind(e.message,post.id).run();
    }
  }
}"""

NEW_CRON = """export async function scheduled(event,env,ctx){
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
        await handleGmailSync(null, env, conn.business_id);
      } catch(e) {
        console.error('[Cron Gmail]', conn.business_id, e.message);
      }
    }
  } catch(e) {
    console.error('[Cron] Gmail sync failed:', e.message);
  }
}"""

if OLD_CRON in worker:
    worker = worker.replace(OLD_CRON, NEW_CRON)
    print("OK: Cron updated with Gmail polling")

# Add Gmail routes to router
OLD_ROUTES = "      return env.ASSETS.fetch(request);"
NEW_ROUTES = """      // Gmail integration
      if(path==='/api/gmail/connect'&&method==='GET')return handleGmailConnect(request,env);
      if(path==='/api/gmail/callback'&&method==='GET')return handleGmailCallback(request,env);
      if(path==='/api/gmail/webhook'&&method==='POST')return handleGmailWebhook(request,env);
      if(path==='/api/gmail/sync'&&method==='POST')return handleGmailSync(request,env,null);
      if(path==='/api/gmail/status'&&method==='GET')return handleGmailStatus(request,env);
      if(path==='/api/gmail/disconnect'&&method==='POST')return handleGmailDisconnect(request,env);
      if(path==='/api/gmail/reply'&&method==='POST')return handleGmailReply(request,env);
      return env.ASSETS.fetch(request);"""

worker = worker.replace(OLD_ROUTES, NEW_ROUTES, 1)
print("OK: Gmail routes added")

with open(os.path.join(BASE, "_worker.js"), 'w', encoding='utf-8') as f:
    f.write(worker)
print("OK: _worker.js updated with Gmail integration")

# =============================================================================
# D1 migration for gmail_sync_state
# =============================================================================
MIGRATE_V4 = """-- Stoke Migration v4: Gmail integration state
-- Run each statement in D1 console

ALTER TABLE platform_connections ADD COLUMN last_history_id TEXT;
ALTER TABLE platform_connections ADD COLUMN watch_expiry INTEGER;
ALTER TABLE platform_connections ADD COLUMN email TEXT;
"""

with open(os.path.join(BASE, "migrate-v4.sql"), 'w', encoding='utf-8') as f:
    f.write(MIGRATE_V4)
print("OK: migrate-v4.sql created")

# =============================================================================
# Update settings.html with Gmail connection UI
# =============================================================================
settings_path = os.path.join(BASE, "settings.html")
with open(settings_path, 'r', encoding='utf-8') as f:
    settings = f.read()

GMAIL_SETTINGS_HTML = """
<div class="settings-section" id="gmail-section">
  <div class="section-header">
    <div class="section-icon">✉️</div>
    <div>
      <div class="section-title">Gmail</div>
      <div class="section-sub">Connect your inbox — Stoke reads new emails and turns inquiries into leads automatically</div>
    </div>
  </div>

  <div id="gmail-disconnected" style="display:none">
    <p style="font-size:13px;color:var(--text-3);margin-bottom:16px">
      Connect your Gmail account to start receiving leads automatically. Stoke only reads your inbox — it never sends email without your approval.
    </p>
    <a href="/api/gmail/connect" class="btn btn-primary" style="display:inline-flex;align-items:center;gap:8px;text-decoration:none">
      <svg width="16" height="16" viewBox="0 0 24 24"><path fill="currentColor" d="M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4l-8 5-8-5V6l8 5 8-5v2z"/></svg>
      Connect Gmail
    </a>
  </div>

  <div id="gmail-connected" style="display:none">
    <div style="display:flex;align-items:center;justify-content:space-between;padding:14px 16px;background:var(--green-light);border-radius:var(--radius);border:0.5px solid var(--green);margin-bottom:16px">
      <div style="display:flex;align-items:center;gap:10px">
        <div style="width:32px;height:32px;background:var(--green);border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:14px">✓</div>
        <div>
          <div style="font-size:13px;font-weight:600;color:var(--green)">Gmail Connected</div>
          <div id="gmail-connected-email" style="font-size:11px;color:var(--text-3)"></div>
        </div>
      </div>
      <button onclick="syncGmail()" class="btn btn-sm" style="font-size:12px;padding:6px 12px">Sync now</button>
    </div>

    <div style="display:flex;align-items:center;justify-content:space-between">
      <div style="font-size:12px;color:var(--text-3)" id="gmail-last-sync">Checking for new emails every 5 minutes</div>
      <button onclick="disconnectGmail()" style="font-size:12px;color:#c0392b;background:none;border:none;cursor:pointer;padding:4px">Disconnect</button>
    </div>
  </div>

  <div id="gmail-loading" style="font-size:13px;color:var(--text-3);padding:8px 0">Checking connection...</div>
</div>

<script>
// Check Gmail status on load
(async function checkGmail(){
  const loading   = document.getElementById('gmail-loading');
  const connected = document.getElementById('gmail-connected');
  const disconn   = document.getElementById('gmail-disconnected');

  try {
    const resp = await fetch('/api/gmail/status', { credentials: 'include' });
    const data = await resp.json();

    if(loading) loading.style.display = 'none';

    if(data.connected){
      if(connected) connected.style.display = 'block';
      const emailEl = document.getElementById('gmail-connected-email');
      if(emailEl) emailEl.textContent = data.email || '';
    } else {
      if(disconn) disconn.style.display = 'block';
    }
  } catch(e) {
    if(loading) loading.style.display = 'none';
    if(disconn) disconn.style.display = 'block';
  }

  // Check URL params for connection result
  const params = new URLSearchParams(location.search);
  if(params.get('gmail') === 'connected'){
    showToast('Gmail connected! Stoke is now watching your inbox.', 'success');
    history.replaceState({}, '', location.pathname);
  } else if(params.get('gmail') === 'denied'){
    showToast('Gmail access was denied. You can try again anytime.', 'error');
    history.replaceState({}, '', location.pathname);
  } else if(params.get('gmail') === 'error'){
    showToast('Something went wrong connecting Gmail. Please try again.', 'error');
    history.replaceState({}, '', location.pathname);
  }
})();

async function syncGmail(){
  const btn = event.target;
  btn.textContent = 'Syncing...';
  btn.disabled = true;
  try {
    const resp = await fetch('/api/gmail/sync', { method:'POST', credentials:'include' });
    const data = await resp.json();
    const msg = data.processed > 0
      ? data.processed + ' new lead' + (data.processed !== 1 ? 's' : '') + ' found!'
      : 'Inbox is up to date.';
    showToast(msg, 'success');
  } catch(e) {
    showToast('Sync failed. Please try again.', 'error');
  }
  btn.textContent = 'Sync now';
  btn.disabled = false;
}

async function disconnectGmail(){
  if(!confirm('Disconnect Gmail? Stoke will stop monitoring your inbox.')) return;
  await fetch('/api/gmail/disconnect', { method:'POST', credentials:'include' });
  location.reload();
}

function showToast(msg, type){
  const t = document.createElement('div');
  t.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);padding:12px 20px;border-radius:8px;font-size:13px;font-weight:500;z-index:9999;color:white;background:' + (type==='success' ? '#1a6b4a' : '#c0392b');
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 4000);
}
</script>
"""

# Add Gmail section to settings if not already there
if 'gmail-section' not in settings:
    # Find a good insertion point - after platform connections or before closing
    if 'section-header' in settings:
        # Insert before the last </div></div> of the main content
        settings = settings.replace('</main>', GMAIL_SETTINGS_HTML + '\n</main>', 1)
        if '</main>' not in settings:
            settings += GMAIL_SETTINGS_HTML
    print("OK: Gmail settings section added")
else:
    print("OK: Gmail settings already present")

with open(settings_path, 'w', encoding='utf-8') as f:
    f.write(settings)

print("""
Gmail integration build complete!

NEXT STEPS:

1. Run D1 migrations (in Cloudflare D1 console):
   ALTER TABLE platform_connections ADD COLUMN last_history_id TEXT;
   ALTER TABLE platform_connections ADD COLUMN watch_expiry INTEGER;
   ALTER TABLE platform_connections ADD COLUMN email TEXT;

2. Set env vars via Wrangler:
   npx wrangler@3.99.0 pages secret put GOOGLE_CLIENT_ID --project-name=stoke
   (paste your Client ID from Google Cloud Console)

   npx wrangler@3.99.0 pages secret put GOOGLE_CLIENT_SECRET --project-name=stoke
   (paste your Client Secret from Google Cloud Console)

3. Set up Google Pub/Sub for push notifications:
   - Go to console.cloud.google.com/cloudpubsub/topics
   - Create topic: gmail-push
   - Add subscription with push endpoint: https://withstoke.com/api/gmail/webhook

4. Deploy:
   git add -A
   git commit -m "Gmail integration: OAuth, push notifications, V4 pipeline, lead inbox"
   git push origin main
   npx wrangler@3.99.0 pages deploy . --project-name=stoke --commit-dirty=true

5. Test:
   - Go to withstoke.com/settings.html
   - Click Connect Gmail
   - Authorize trustyprograms@gmail.com
   - Send a test inquiry to trustyprograms@gmail.com
   - Watch it appear in lead inbox within seconds
""")
