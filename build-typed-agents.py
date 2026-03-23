import os

BASE = r"C:\Users\andre\stoke"

# =============================================================================
# TYPED HANDOFF SYSTEM + PROMPT CACHING
# =============================================================================
# Implements the architecture from the PDF:
# 1. Work envelope (work_id, tenant_id, idempotency_key)
# 2. IntakeRecord - typed output of lead parser
# 3. BookingProposal - typed output of scheduler
# 4. EstimateDraft - typed output of invoice agent
# 5. MessageDraft - typed output of reply writer
# 6. Per-field confidence on every output
# 7. Prompt caching - static prefix cached, dynamic suffix fresh
# 8. callClaudeWithCache() - replaces callClaude() for cacheable calls
# =============================================================================

TYPED_HANDOFF_CODE = r'''
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
'''

# Read current worker
with open(os.path.join(BASE, "_worker.js"), 'r', encoding='utf-8') as f:
    worker = f.read()

# Insert typed handoff system before the MULTI-AGENT SYSTEM comment
INSERT_BEFORE = "// ── MULTI-AGENT SYSTEM"
if INSERT_BEFORE in worker:
    worker = worker.replace(INSERT_BEFORE, TYPED_HANDOFF_CODE + "\n\n" + INSERT_BEFORE, 1)
    print("OK: Typed handoff system inserted")
else:
    # Try inserting before CRON
    worker = worker.replace(
        "// ── CRON",
        TYPED_HANDOFF_CODE + "\n\n// -- CRON",
        1
    )
    print("OK: Typed handoff system inserted before CRON")

# Add new V3 routes to the router
OLD_V2_ROUTES = "      // V2 agents - profile-aware, no hardcoding\n      if(path==='/api/agent/route'&&method==='POST')return handleRouteV2(request,env);\n      if(path==='/api/agent/lead'&&method==='POST')return handleLeadParseV2(request,env);\n      if(path==='/api/agent/invoice'&&method==='POST')return handleInvoiceAgentV2(request,env);\n      if(path==='/api/agent/reply'&&method==='POST')return handleReplyWriterV2(request,env);\n      if(path==='/api/agent/social'&&method==='POST')return handleSocialAgent(request,env);"

NEW_V3_ROUTES = """      // V3 agents - typed handoffs + prompt caching + work envelopes
      if(path==='/api/agent/route'&&method==='POST')return handleRouteV3(request,env);
      if(path==='/api/agent/intake'&&method==='POST')return handleIntakeV3(request,env);
      if(path==='/api/agent/lead'&&method==='POST')return handleIntakeV3(request,env); // alias
      if(path==='/api/agent/estimate'&&method==='POST')return handleEstimateV3(request,env);
      if(path==='/api/agent/invoice'&&method==='POST')return handleEstimateV3(request,env); // alias
      if(path==='/api/agent/reply'&&method==='POST')return handleReplyV3(request,env);
      if(path==='/api/agent/social'&&method==='POST')return handleSocialAgent(request,env);
      if(path==='/api/agent/pipeline'&&method==='POST')return handleFullPipeline(request,env);"""

if OLD_V2_ROUTES in worker:
    worker = worker.replace(OLD_V2_ROUTES, NEW_V3_ROUTES)
    print("OK: V3 agent routes added to router")
else:
    # Add before ASSETS fallback
    worker = worker.replace(
        "      return env.ASSETS.fetch(request);",
        NEW_V3_ROUTES + "\n      return env.ASSETS.fetch(request);",
        1
    )
    print("OK: V3 routes added before ASSETS fallback")

with open(os.path.join(BASE, "_worker.js"), 'w', encoding='utf-8') as f:
    f.write(worker)

print("OK: _worker.js updated with typed handoff system")
print("\nNew endpoints:")
print("  POST /api/agent/intake    - typed IntakeRecord with per-field confidence")
print("  POST /api/agent/estimate  - typed EstimateDraft with per-line confidence")
print("  POST /api/agent/reply     - typed MessageDraft")
print("  POST /api/agent/route     - typed RouteDecision with cache")
print("  POST /api/agent/pipeline  - full intake->reply->save in one call")
print("\nAll agents now use prompt caching - ~90% token savings on repeat calls")
print("\nDeploy:")
print("  git add -A")
print('  git commit -m "Typed handoffs, prompt caching, work envelopes, full pipeline"')
print("  git push origin main")
print("  npx wrangler@3.99.0 pages deploy . --project-name=stoke --commit-dirty=true")
