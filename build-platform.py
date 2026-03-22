import os

BASE = r"C:\Users\andre\stoke"

# =============================================================================
# STOKE PLATFORM REFACTOR
# =============================================================================
# 1. Vertical preset library (outdoor_service, real_estate, contractor)
# 2. Dynamic agent prompt builder - loads from D1, no hardcoding
# 3. Automation level system (review_all / smart_confirm / autopilot)
# 4. D1 migration for presets + automation_level
# 5. New onboarding API endpoints
# 6. Settings page upgrade with automation toggle
# =============================================================================

# -----------------------------------------------------------------------------
# PART 1: migrate-v3.sql — adds vertical_preset + automation_level to settings
# -----------------------------------------------------------------------------

MIGRATE_V3 = """-- Stoke Migration v3: Platform Architecture
-- Adds vertical preset support and automation level to settings
-- Run in D1 console: paste each statement

-- Add vertical column to businesses table
ALTER TABLE businesses ADD COLUMN vertical TEXT DEFAULT 'outdoor_service';
ALTER TABLE businesses ADD COLUMN onboarding_complete INTEGER DEFAULT 0;
ALTER TABLE businesses ADD COLUMN automation_level TEXT DEFAULT 'review_all';

-- Vertical presets table - stores the industry knowledge for each vertical
CREATE TABLE IF NOT EXISTS vertical_presets (
  id            TEXT PRIMARY KEY,
  vertical_key  TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  description   TEXT,
  preset_data   TEXT NOT NULL, -- JSON blob
  created_at    INTEGER NOT NULL
);

-- Business presets - customized preset per business (overrides vertical defaults)
CREATE TABLE IF NOT EXISTS business_presets (
  business_id   TEXT PRIMARY KEY REFERENCES businesses(id) ON DELETE CASCADE,
  vertical_key  TEXT NOT NULL,
  preset_data   TEXT NOT NULL, -- JSON blob, merged with vertical preset
  updated_at    INTEGER NOT NULL
);

-- Lead inbox - holds parsed leads before they become calendar events
CREATE TABLE IF NOT EXISTS lead_inbox (
  id              TEXT PRIMARY KEY,
  business_id     TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  source          TEXT DEFAULT 'email',
  raw_content     TEXT,
  parsed_data     TEXT, -- JSON: extracted lead fields
  status          TEXT DEFAULT 'pending', -- pending | confirmed | dismissed
  confidence      REAL DEFAULT 0,
  event_id        TEXT, -- set when confirmed to calendar
  received_at     INTEGER NOT NULL,
  reviewed_at     INTEGER,
  created_at      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_lead_inbox_business ON lead_inbox(business_id, status, received_at DESC);

-- Automation log - audit trail of everything Stoke did automatically
CREATE TABLE IF NOT EXISTS automation_log (
  id            TEXT PRIMARY KEY,
  business_id   TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  action_type   TEXT NOT NULL, -- email_parsed | event_created | reply_sent | invoice_sent
  description   TEXT,
  data          TEXT, -- JSON context
  agent         TEXT, -- which agent performed this
  confidence    REAL,
  status        TEXT DEFAULT 'completed', -- completed | pending_review | failed
  reviewed_by   TEXT,
  created_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_automation_log_business ON automation_log(business_id, created_at DESC);
"""

with open(os.path.join(BASE, "migrate-v3.sql"), 'w', encoding='utf-8') as f:
    f.write(MIGRATE_V3)
print("OK: migrate-v3.sql created")


# -----------------------------------------------------------------------------
# PART 2: vertical-presets.json — the industry knowledge library
# -----------------------------------------------------------------------------

PRESETS = r"""{
  "outdoor_service": {
    "key": "outdoor_service",
    "name": "Outdoor & Water Sports",
    "description": "Kayak shops, sailing schools, tour operators, outfitters",
    "vocabulary": {
      "job": "booking",
      "jobs": "bookings",
      "invoice": "invoice",
      "customer": "customer",
      "customers": "customers",
      "appointment": "booking",
      "lead": "inquiry",
      "proposal": "quote",
      "service_area": "service area",
      "transaction": "booking"
    },
    "services_template": [
      {"name": "Kayak Rental", "type_key": "rental", "price_unit": "hour", "base_price": 45, "duration_minutes": 120, "color": "#2196F3"},
      {"name": "Guided Tour", "type_key": "rental", "price_unit": "person", "base_price": 75, "duration_minutes": 180, "color": "#42A5F5"},
      {"name": "Kayak Lesson", "type_key": "lesson", "price_unit": "person", "base_price": 65, "duration_minutes": 90, "color": "#2E7D32"},
      {"name": "Sailing Lesson", "type_key": "lesson", "price_unit": "person", "base_price": 85, "duration_minutes": 120, "color": "#1B5E20"},
      {"name": "Custom Rigging", "type_key": "rigging", "price_unit": "flat", "base_price": 250, "duration_minutes": 480, "color": "#FF6D00"},
      {"name": "Repair & Service", "type_key": "repair", "price_unit": "hour", "base_price": 95, "duration_minutes": 180, "color": "#E65100"},
      {"name": "Sailboat Demo", "type_key": "sailboat", "price_unit": "flat", "base_price": 0, "duration_minutes": 120, "color": "#6A1B9A"}
    ],
    "pricing_model": "hourly_and_flat",
    "follow_up_cadence": {
      "initial_response": "2hr",
      "quote_follow_up": "48hr",
      "booking_reminder": "24hr",
      "post_service": "24hr",
      "seasonal_outreach": "90day"
    },
    "channel_priority": ["email", "phone", "text"],
    "lead_signals": ["rental", "rent", "lesson", "tour", "kayak", "sail", "paddle", "boat", "rigging", "repair", "book", "available", "schedule", "how much", "price", "cost", "group", "family"],
    "seasonal_notes": "Peak season spring-fall. Water temperature affects demand. Weather-dependent cancellations common.",
    "automation_hints": {
      "high_confidence_signals": ["price inquiry", "specific date mentioned", "party size mentioned"],
      "always_review": ["complaint", "refund", "cancellation", "large group over 10"],
      "quick_reply_triggers": ["availability", "pricing", "how long"]
    },
    "tone_defaults": {
      "style": "warm, adventurous, local",
      "avoid": ["corporate language", "overly formal", "excessive exclamation points"],
      "sample_phrase": "We love getting people out on the water"
    }
  },
  "real_estate": {
    "key": "real_estate",
    "name": "Real Estate",
    "description": "Buyer/seller agents, property managers, brokers",
    "vocabulary": {
      "job": "showing",
      "jobs": "showings",
      "invoice": "commission statement",
      "customer": "client",
      "customers": "clients",
      "appointment": "showing",
      "lead": "prospect",
      "proposal": "CMA",
      "service_area": "market area",
      "transaction": "transaction"
    },
    "services_template": [
      {"name": "Buyer Consultation", "type_key": "consultation", "price_unit": "flat", "base_price": 0, "duration_minutes": 60, "color": "#2196F3"},
      {"name": "Property Showing", "type_key": "showing", "price_unit": "flat", "base_price": 0, "duration_minutes": 60, "color": "#1565C0"},
      {"name": "Listing Appointment", "type_key": "listing", "price_unit": "flat", "base_price": 0, "duration_minutes": 90, "color": "#FF6D00"},
      {"name": "Offer Presentation", "type_key": "offer", "price_unit": "flat", "base_price": 0, "duration_minutes": 60, "color": "#2E7D32"},
      {"name": "Open House", "type_key": "open_house", "price_unit": "flat", "base_price": 0, "duration_minutes": 180, "color": "#6A1B9A"},
      {"name": "Closing", "type_key": "closing", "price_unit": "flat", "base_price": 0, "duration_minutes": 120, "color": "#E65100"}
    ],
    "pricing_model": "commission",
    "follow_up_cadence": {
      "initial_response": "30min",
      "showing_follow_up": "24hr",
      "nurture_cold_lead": "7day",
      "market_update": "30day",
      "long_nurture": "90day"
    },
    "channel_priority": ["sms", "email", "instagram", "phone"],
    "lead_signals": ["interested", "listing", "showing", "house", "home", "property", "pre-approved", "buying", "selling", "price", "neighborhood", "school district", "bedrooms", "move", "relocating"],
    "seasonal_notes": "Spring and fall are peak buying seasons. Holiday season is slow. Inventory affects urgency.",
    "automation_hints": {
      "high_confidence_signals": ["specific address mentioned", "budget mentioned", "timeline mentioned", "pre-approved"],
      "always_review": ["offer submission", "contract terms", "price negotiation"],
      "quick_reply_triggers": ["is this available", "can I see it", "what is the price"]
    },
    "tone_defaults": {
      "style": "professional, responsive, knowledgeable",
      "avoid": ["pushy sales language", "generic responses", "delayed replies"],
      "sample_phrase": "I can help you find exactly what you are looking for"
    }
  },
  "contractor": {
    "key": "contractor",
    "name": "Contractor & Trades",
    "description": "General contractors, plumbers, electricians, HVAC, landscaping, pressure washing",
    "vocabulary": {
      "job": "job",
      "jobs": "jobs",
      "invoice": "invoice",
      "customer": "customer",
      "customers": "customers",
      "appointment": "site visit",
      "lead": "lead",
      "proposal": "estimate",
      "service_area": "service area",
      "transaction": "job"
    },
    "services_template": [
      {"name": "Free Estimate", "type_key": "estimate", "price_unit": "flat", "base_price": 0, "duration_minutes": 60, "color": "#2196F3"},
      {"name": "Service Call", "type_key": "service", "price_unit": "hour", "base_price": 125, "duration_minutes": 120, "color": "#FF6D00"},
      {"name": "Installation", "type_key": "install", "price_unit": "flat", "base_price": 500, "duration_minutes": 480, "color": "#2E7D32"},
      {"name": "Repair", "type_key": "repair", "price_unit": "hour", "base_price": 95, "duration_minutes": 120, "color": "#E65100"},
      {"name": "Maintenance", "type_key": "maintenance", "price_unit": "flat", "base_price": 150, "duration_minutes": 60, "color": "#6A1B9A"},
      {"name": "Emergency Call", "type_key": "emergency", "price_unit": "hour", "base_price": 175, "duration_minutes": 120, "color": "#c0392b"}
    ],
    "pricing_model": "hourly_and_flat",
    "follow_up_cadence": {
      "initial_response": "1hr",
      "estimate_follow_up": "48hr",
      "job_reminder": "24hr",
      "payment_reminder": "7day",
      "repeat_customer": "180day"
    },
    "channel_priority": ["phone", "text", "email"],
    "lead_signals": ["fix", "repair", "install", "replace", "broken", "leaking", "estimate", "quote", "how much", "available", "emergency", "not working", "cleaning", "painting", "build"],
    "seasonal_notes": "HVAC peaks in summer and winter. Landscaping peaks spring through fall. Weather delays common.",
    "automation_hints": {
      "high_confidence_signals": ["emergency", "not working", "broken", "flooding", "specific job type + address"],
      "always_review": ["large project over $5000", "permit required", "structural work"],
      "quick_reply_triggers": ["emergency", "urgent", "as soon as possible", "tonight"]
    },
    "tone_defaults": {
      "style": "direct, reliable, local",
      "avoid": ["overpromising timelines", "vague estimates", "corporate speak"],
      "sample_phrase": "We will get that taken care of for you"
    }
  },
  "salon_wellness": {
    "key": "salon_wellness",
    "name": "Salon & Wellness",
    "description": "Hair salons, spas, massage, yoga studios, personal trainers",
    "vocabulary": {
      "job": "appointment",
      "jobs": "appointments",
      "invoice": "receipt",
      "customer": "client",
      "customers": "clients",
      "appointment": "appointment",
      "lead": "new client inquiry",
      "proposal": "service menu",
      "service_area": "location",
      "transaction": "visit"
    },
    "services_template": [
      {"name": "Consultation", "type_key": "consultation", "price_unit": "flat", "base_price": 0, "duration_minutes": 30, "color": "#E91E63"},
      {"name": "Standard Service", "type_key": "service", "price_unit": "flat", "base_price": 75, "duration_minutes": 60, "color": "#9C27B0"},
      {"name": "Premium Service", "type_key": "premium", "price_unit": "flat", "base_price": 150, "duration_minutes": 90, "color": "#3F51B5"},
      {"name": "Package Session", "type_key": "package", "price_unit": "flat", "base_price": 200, "duration_minutes": 120, "color": "#2196F3"}
    ],
    "pricing_model": "flat_rate",
    "follow_up_cadence": {
      "initial_response": "1hr",
      "booking_reminder": "24hr",
      "post_service": "48hr",
      "rebooking_prompt": "30day"
    },
    "channel_priority": ["instagram", "text", "email"],
    "lead_signals": ["appointment", "available", "book", "schedule", "haircut", "massage", "facial", "nails", "class", "session", "consultation"],
    "seasonal_notes": "Holidays are peak booking periods. Summer weddings drive demand. New Year resolutions spike January.",
    "automation_hints": {
      "high_confidence_signals": ["specific service mentioned", "date/time preference", "returning client"],
      "always_review": ["complaint", "allergy concern", "medical condition mentioned"],
      "quick_reply_triggers": ["available this week", "can I book", "do you have openings"]
    },
    "tone_defaults": {
      "style": "warm, personal, caring",
      "avoid": ["clinical language", "rushed responses"],
      "sample_phrase": "We would love to take care of you"
    }
  }
}"""

with open(os.path.join(BASE, "js", "vertical-presets.json"), 'w', encoding='utf-8') as f:
    f.write(PRESETS)
print("OK: js/vertical-presets.json created")


# -----------------------------------------------------------------------------
# PART 3: New worker additions
# - loadBusinessProfile() - reads from D1, never hardcoded
# - loadVerticalPreset() - reads preset for the business's vertical
# - buildAgentContext() - assembles system prompt dynamically
# - Updated agent handlers that use buildAgentContext
# - New API endpoints: /api/profile, /api/preset, /api/onboarding
# - Automation level enforcement
# -----------------------------------------------------------------------------

WORKER_ADDITIONS = r"""
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
"""

# Read current worker
with open(os.path.join(BASE, "_worker.js"), 'r', encoding='utf-8') as f:
    worker = f.read()

# Insert platform layer before the MULTI-AGENT SYSTEM section
INSERT_BEFORE = "// ── MULTI-AGENT SYSTEM"
if INSERT_BEFORE in worker:
    worker = worker.replace(INSERT_BEFORE, WORKER_ADDITIONS + "\n\n" + INSERT_BEFORE, 1)
    print("OK: Platform layer inserted into _worker.js")
else:
    # Append before the CRON section
    INSERT_BEFORE2 = "// ── CRON"
    worker = worker.replace(INSERT_BEFORE2, WORKER_ADDITIONS + "\n\n" + INSERT_BEFORE2, 1)
    print("OK: Platform layer appended to _worker.js")

# Add new API routes to the router
OLD_ROUTES = "      if(path==='/api/agent/route'&&method==='POST')return handleRoute(request,env);\n      if(path==='/api/agent/lead'&&method==='POST')return handleLeadParse(request,env);\n      if(path==='/api/agent/invoice'&&method==='POST')return handleInvoiceAgent(request,env);\n      if(path==='/api/agent/reply'&&method==='POST')return handleReplyWriter(request,env);\n      if(path==='/api/agent/social'&&method==='POST')return handleSocialAgent(request,env);"

NEW_ROUTES = """      // V2 agents - profile-aware, no hardcoding
      if(path==='/api/agent/route'&&method==='POST')return handleRouteV2(request,env);
      if(path==='/api/agent/lead'&&method==='POST')return handleLeadParseV2(request,env);
      if(path==='/api/agent/invoice'&&method==='POST')return handleInvoiceAgentV2(request,env);
      if(path==='/api/agent/reply'&&method==='POST')return handleReplyWriterV2(request,env);
      if(path==='/api/agent/social'&&method==='POST')return handleSocialAgent(request,env);
      // Profile & onboarding
      if(path==='/api/profile'&&method==='GET')return handleGetProfile(request,env);
      if(path==='/api/profile'&&method==='POST')return handleSaveProfile(request,env);
      if(path==='/api/presets'&&method==='GET')return handleGetPresets(request,env);
      if(path==='/api/onboarding/chat'&&method==='POST')return handleOnboardingChat(request,env);
      // Lead inbox
      if(path==='/api/leads/inbox'&&method==='GET')return handleGetLeadInbox(request,env);
      if(path==='/api/leads/confirm'&&method==='POST')return handleConfirmLead(request,env);
      // Automation
      if(path==='/api/automation/log'&&method==='GET')return handleGetAutomationLog(request,env);"""

if OLD_ROUTES in worker:
    worker = worker.replace(OLD_ROUTES, NEW_ROUTES)
    print("OK: New API routes added to router")
else:
    print("WARN: Could not find old routes - adding new routes before ASSETS fallback")
    worker = worker.replace(
        "      return env.ASSETS.fetch(request);",
        NEW_ROUTES + "\n      return env.ASSETS.fetch(request);"
    )

# Remove duplicate email routes if present
if worker.count("if(path==='/api/email/confirmation'") > 1:
    # Keep only first occurrence
    idx = worker.find("if(path==='/api/email/confirmation'")
    second = worker.find("if(path==='/api/email/confirmation'", idx + 10)
    if second > 0:
        end_line = worker.find("\n", second) + 1
        end_line2 = worker.find("\n", end_line) + 1
        worker = worker[:second] + worker[end_line2:]
        print("OK: Removed duplicate email routes")

with open(os.path.join(BASE, "_worker.js"), 'w', encoding='utf-8') as f:
    f.write(worker)
print("OK: _worker.js updated with full platform layer")

# -----------------------------------------------------------------------------
# PART 4: onboarding.html - the AI-powered onboarding interview
# -----------------------------------------------------------------------------

ONBOARDING_HTML = r"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Stoke — Set up your account</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=DM+Serif+Display:ital@0;1&family=DM+Sans:wght@300;400;500;600&display=swap" rel="stylesheet">
<link rel="stylesheet" href="css/stoke.css">
<style>
.onboarding-wrap { max-width: 680px; margin: 0 auto; }
.ob-step { display: none; }
.ob-step.active { display: block; }

/* Vertical picker */
.vertical-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin: 24px 0; }
@media(max-width:500px){ .vertical-grid { grid-template-columns: 1fr; } }
.vertical-card {
  border: 1.5px solid var(--border);
  border-radius: var(--radius-lg);
  padding: 20px;
  cursor: pointer;
  transition: all .15s;
  background: var(--bg);
}
.vertical-card:hover { border-color: var(--green); background: var(--green-light); }
.vertical-card.selected { border-color: var(--green); background: var(--green-light); }
.vertical-card.selected .vc-icon { background: var(--green); }
.vc-icon { width: 40px; height: 40px; border-radius: 10px; background: var(--bg-2); display: flex; align-items: center; justify-content: center; font-size: 20px; margin-bottom: 10px; transition: background .15s; }
.vc-name { font-size: 14px; font-weight: 600; color: var(--text); margin-bottom: 3px; }
.vc-desc { font-size: 11px; color: var(--text-3); line-height: 1.4; }

/* Chat interface */
.chat-wrap { background: var(--bg-2); border-radius: var(--radius-lg); border: 0.5px solid var(--border); overflow: hidden; margin: 20px 0; }
.chat-messages { padding: 20px; min-height: 300px; max-height: 450px; overflow-y: auto; display: flex; flex-direction: column; gap: 12px; }
.chat-msg { max-width: 85%; }
.chat-msg.stoke { align-self: flex-start; }
.chat-msg.user { align-self: flex-end; }
.chat-bubble {
  padding: 12px 16px;
  border-radius: 14px;
  font-size: 14px;
  line-height: 1.55;
}
.stoke .chat-bubble { background: white; border: 0.5px solid var(--border); color: var(--text); border-radius: 14px 14px 14px 4px; }
.user .chat-bubble { background: var(--green); color: white; border-radius: 14px 14px 4px 14px; }
.chat-sender { font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: .06em; color: var(--text-3); margin-bottom: 4px; padding: 0 4px; }
.chat-input-row { display: flex; gap: 8px; padding: 12px; border-top: 0.5px solid var(--border); background: white; }
.chat-input {
  flex: 1; padding: 10px 14px; font-size: 14px; font-family: var(--font-body);
  border: 0.5px solid var(--border-2); border-radius: var(--radius);
  background: var(--bg); color: var(--text); outline: none; resize: none;
  min-height: 44px; max-height: 120px;
}
.chat-input:focus { border-color: var(--green); }
.chat-send-btn {
  width: 44px; height: 44px; border: none; border-radius: var(--radius);
  background: var(--green); color: white; cursor: pointer; font-size: 18px;
  display: flex; align-items: center; justify-content: center; flex-shrink: 0;
  transition: background .15s;
}
.chat-send-btn:hover { background: var(--green-mid); }
.chat-send-btn:disabled { opacity: .5; cursor: default; }

/* Typing indicator */
.typing-dots { display: flex; gap: 4px; align-items: center; padding: 4px 0; }
.typing-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--text-3); animation: dot-bounce .8s ease-in-out infinite; }
.typing-dot:nth-child(2) { animation-delay: .15s; }
.typing-dot:nth-child(3) { animation-delay: .3s; }
@keyframes dot-bounce { 0%,60%,100%{transform:translateY(0)} 30%{transform:translateY(-6px)} }

/* Profile review */
.profile-review { background: var(--bg-2); border-radius: var(--radius-lg); padding: 20px; margin: 16px 0; border: 0.5px solid var(--border); }
.pr-row { display: flex; align-items: flex-start; gap: 10px; padding: 8px 0; border-bottom: 0.5px solid var(--border); }
.pr-row:last-child { border-bottom: none; }
.pr-label { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: .06em; color: var(--text-3); min-width: 100px; padding-top: 2px; }
.pr-value { font-size: 13px; color: var(--text); flex: 1; line-height: 1.5; }
.pr-edit { font-size: 11px; color: var(--green); cursor: pointer; text-decoration: underline; }

/* Automation toggle */
.automation-cards { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin: 16px 0; }
@media(max-width:500px){ .automation-cards { grid-template-columns: 1fr; } }
.auto-card {
  border: 1.5px solid var(--border); border-radius: var(--radius); padding: 16px 14px;
  cursor: pointer; transition: all .15s; background: var(--bg);
}
.auto-card:hover { border-color: var(--green); }
.auto-card.selected { border-color: var(--green); background: var(--green-light); }
.auto-icon { font-size: 22px; margin-bottom: 8px; }
.auto-name { font-size: 13px; font-weight: 600; color: var(--text); margin-bottom: 4px; }
.auto-desc { font-size: 11px; color: var(--text-3); line-height: 1.4; }

/* Progress bar */
.ob-progress { display: flex; gap: 6px; margin-bottom: 28px; }
.ob-progress-step { flex: 1; height: 3px; border-radius: 2px; background: var(--border-2); transition: background .3s; }
.ob-progress-step.done { background: var(--green); }
.ob-progress-step.active { background: var(--green); opacity: .5; }

.ob-title { font-family: var(--font-serif); font-size: 26px; color: var(--text); margin-bottom: 6px; }
.ob-sub { font-size: 14px; color: var(--text-3); margin-bottom: 24px; line-height: 1.6; }

.ob-btn {
  padding: 13px 24px; background: var(--green); color: white; border: none;
  border-radius: var(--radius); font-family: var(--font-body); font-size: 14px;
  font-weight: 600; cursor: pointer; transition: background .15s;
}
.ob-btn:hover { background: var(--green-mid); }
.ob-btn:disabled { opacity: .5; cursor: default; }
.ob-btn-ghost { background: transparent; border: 0.5px solid var(--border); color: var(--text-2); margin-right: 8px; }
.ob-btn-ghost:hover { border-color: var(--green); color: var(--green); background: var(--green-light); }

.success-icon { width: 64px; height: 64px; background: var(--green); border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 28px; margin: 0 auto 20px; }
</style>
</head>
<body>
<div class="app app-narrow">
  <!-- Header -->
  <div class="header">
    <a href="index.html" class="header-home">
      <div class="logo"><svg viewBox="0 0 20 20" fill="none" width="20" height="20"><path d="M10 2C10 2 4 8 4 12a6 6 0 0012 0c0-4-6-10-6-10z" fill="white" opacity=".95"/><path d="M10 8c0 0-2 3-2 5a2 2 0 004 0c0-2-2-5-2-5z" fill="white" opacity=".45"/></svg></div>
      <span class="wordmark">Stoke</span>
    </a>
  </div>

  <div class="onboarding-wrap">

    <!-- Progress -->
    <div class="ob-progress">
      <div class="ob-progress-step done" id="prog-1"></div>
      <div class="ob-progress-step active" id="prog-2"></div>
      <div class="ob-progress-step" id="prog-3"></div>
      <div class="ob-progress-step" id="prog-4"></div>
    </div>

    <!-- Step 1: Choose vertical -->
    <div class="ob-step active" id="step-1">
      <div class="ob-title">What kind of business do you run?</div>
      <div class="ob-sub">Stoke will configure itself for your industry — the right language, workflows, and defaults for how your business actually operates.</div>

      <div class="vertical-grid" id="vertical-grid">
        <div class="vertical-card" data-vertical="outdoor_service" onclick="selectVertical(this)">
          <div class="vc-icon">&#x1F6F6;</div>
          <div class="vc-name">Outdoor & Water Sports</div>
          <div class="vc-desc">Kayak shops, sailing schools, tour operators, outfitters</div>
        </div>
        <div class="vertical-card" data-vertical="real_estate" onclick="selectVertical(this)">
          <div class="vc-icon">&#x1F3E1;</div>
          <div class="vc-name">Real Estate</div>
          <div class="vc-desc">Buyer/seller agents, property managers, brokers</div>
        </div>
        <div class="vertical-card" data-vertical="contractor" onclick="selectVertical(this)">
          <div class="vc-icon">&#x1F6E0;</div>
          <div class="vc-name">Contractor & Trades</div>
          <div class="vc-desc">General contractors, plumbers, electricians, landscaping</div>
        </div>
        <div class="vertical-card" data-vertical="salon_wellness" onclick="selectVertical(this)">
          <div class="vc-icon">&#x2728;</div>
          <div class="vc-name">Salon & Wellness</div>
          <div class="vc-desc">Hair salons, spas, massage, yoga studios</div>
        </div>
        <div class="vertical-card" data-vertical="other" onclick="selectVertical(this)">
          <div class="vc-icon">&#x1F4BC;</div>
          <div class="vc-name">Other Service Business</div>
          <div class="vc-desc">Any other local service business</div>
        </div>
      </div>

      <button class="ob-btn" id="btn-step1" onclick="goToStep(2)" disabled>Continue &rarr;</button>
    </div>

    <!-- Step 2: AI Interview -->
    <div class="ob-step" id="step-2">
      <div class="ob-title">Tell me about your business</div>
      <div class="ob-sub">I'll ask you a few questions to set everything up. You can type or use your voice.</div>

      <div class="chat-wrap">
        <div class="chat-messages" id="chat-messages"></div>
        <div class="chat-input-row">
          <textarea class="chat-input" id="chat-input" placeholder="Type your answer here..." rows="1"
            onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();sendChat()}"
            oninput="this.style.height='auto';this.style.height=this.scrollHeight+'px'"></textarea>
          <button class="chat-send-btn" id="chat-send" onclick="sendChat()">&#x2191;</button>
        </div>
      </div>

      <div id="profile-complete-section" style="display:none">
        <button class="ob-btn" onclick="goToStep(3)">Review your profile &rarr;</button>
      </div>
    </div>

    <!-- Step 3: Review profile -->
    <div class="ob-step" id="step-3">
      <div class="ob-title">Here's what Stoke learned</div>
      <div class="ob-sub">Review your business profile. Everything is editable.</div>

      <div class="profile-review" id="profile-review-content">
        <!-- Populated by JS -->
      </div>

      <div style="margin-top: 20px">
        <div class="ob-title" style="font-size:18px;margin-bottom:8px">How hands-on do you want to be?</div>
        <div style="font-size:13px;color:var(--text-3);margin-bottom:14px">You can change this anytime in Settings.</div>
        <div class="automation-cards">
          <div class="auto-card selected" data-level="review_all" onclick="selectAutomation(this)">
            <div class="auto-icon">&#x1F440;</div>
            <div class="auto-name">Review Everything</div>
            <div class="auto-desc">Stoke suggests. You approve every action. Best when starting out.</div>
          </div>
          <div class="auto-card" data-level="smart_confirm" onclick="selectAutomation(this)">
            <div class="auto-icon">&#x26A1;</div>
            <div class="auto-name">Smart Confirm</div>
            <div class="auto-desc">Stoke handles routine tasks automatically. Flags anything unusual.</div>
          </div>
          <div class="auto-card" data-level="autopilot" onclick="selectAutomation(this)">
            <div class="auto-icon">&#x1F680;</div>
            <div class="auto-name">Autopilot</div>
            <div class="auto-desc">Stoke runs your front office. You review a daily digest.</div>
          </div>
        </div>
      </div>

      <div style="margin-top:24px">
        <button class="ob-btn ob-btn-ghost" onclick="goToStep(2)">&#x2190; Back</button>
        <button class="ob-btn" onclick="saveAndFinish()">Launch Stoke &rarr;</button>
      </div>
    </div>

    <!-- Step 4: Done -->
    <div class="ob-step" id="step-4">
      <div style="text-align:center;padding:40px 0">
        <div class="success-icon">&#x2713;</div>
        <div class="ob-title">You're all set!</div>
        <div class="ob-sub" style="max-width:400px;margin:0 auto 32px">Stoke is configured for your business. Your agents know your services, your pricing, and your voice.</div>
        <a href="dashboard.html" class="ob-btn" style="text-decoration:none;display:inline-block">Go to your dashboard &rarr;</a>
      </div>
    </div>

  </div><!-- /onboarding-wrap -->
</div><!-- /app -->

<script>
let selectedVertical = '';
let selectedAutomation = 'review_all';
let chatMessages = [];
let extractedProfile = null;

// ── STEP 1: Vertical selection ────────────────────────────────────────────
function selectVertical(card) {
  document.querySelectorAll('.vertical-card').forEach(c => c.classList.remove('selected'));
  card.classList.add('selected');
  selectedVertical = card.dataset.vertical;
  document.getElementById('btn-step1').disabled = false;
}

// ── STEP NAVIGATION ───────────────────────────────────────────────────────
function goToStep(n) {
  document.querySelectorAll('.ob-step').forEach(s => s.classList.remove('active'));
  document.getElementById('step-' + n).classList.add('active');

  // Update progress
  for(let i = 1; i <= 4; i++){
    const el = document.getElementById('prog-' + i);
    el.className = 'ob-progress-step' + (i < n ? ' done' : i === n ? ' active' : '');
  }

  if(n === 2 && chatMessages.length === 0) startInterview();
  if(n === 3) renderProfileReview();
  window.scrollTo(0, 0);
}

// ── STEP 2: AI Interview ──────────────────────────────────────────────────
function addMessage(role, text) {
  const container = document.getElementById('chat-messages');

  // Remove typing indicator if present
  const typing = document.getElementById('typing-indicator');
  if(typing) typing.remove();

  const div = document.createElement('div');
  div.className = 'chat-msg ' + (role === 'assistant' ? 'stoke' : 'user');
  div.innerHTML = `
    <div class="chat-sender">${role === 'assistant' ? '✦ Stoke' : 'You'}</div>
    <div class="chat-bubble">${text.replace(/\n/g, '<br>')}</div>
  `;
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
  chatMessages.push({role, content: text});
}

function showTyping() {
  const container = document.getElementById('chat-messages');
  const div = document.createElement('div');
  div.id = 'typing-indicator';
  div.className = 'chat-msg stoke';
  div.innerHTML = '<div class="chat-sender">✦ Stoke</div><div class="chat-bubble"><div class="typing-dots"><div class="typing-dot"></div><div class="typing-dot"></div><div class="typing-dot"></div></div></div>';
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
}

async function startInterview() {
  showTyping();
  const verticalNames = {
    outdoor_service: 'outdoor/water sports business',
    real_estate: 'real estate business',
    contractor: 'contracting/trades business',
    salon_wellness: 'salon or wellness business',
    other: 'service business'
  };

  chatMessages = [{
    role: 'user',
    content: `I run a ${verticalNames[selectedVertical] || 'service business'}. Help me set up my Stoke account.`
  }];

  await fetchChat();
}

async function sendChat() {
  const input = document.getElementById('chat-input');
  const text = input.value.trim();
  if(!text) return;

  input.value = '';
  input.style.height = 'auto';
  addMessage('user', text);
  chatMessages.push({role:'user', content: text});

  // Remove the message we just added to avoid double-adding in fetchChat
  chatMessages.pop();
  chatMessages.push({role:'user', content: text});

  document.getElementById('chat-send').disabled = true;
  showTyping();
  await fetchChat();
  document.getElementById('chat-send').disabled = false;
}

async function fetchChat() {
  try {
    const resp = await fetch('/api/onboarding/chat', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      credentials: 'include',
      body: JSON.stringify({messages: chatMessages, vertical: selectedVertical})
    });
    const data = await resp.json();

    if(data.ok) {
      addMessage('assistant', data.message || 'Tell me more about your business.');

      if(data.profile_complete && data.extracted_profile) {
        extractedProfile = data.extracted_profile;
        document.getElementById('profile-complete-section').style.display = 'block';
        // Auto-advance after a short delay
        setTimeout(() => goToStep(3), 1500);
      }
    }
  } catch(e) {
    addMessage('assistant', 'Something went wrong. Please try again.');
  }
}

// ── STEP 3: Profile review ────────────────────────────────────────────────
function renderProfileReview() {
  const p = extractedProfile || {};
  const container = document.getElementById('profile-review-content');

  const rows = [
    ['Business Name', p.name || '—'],
    ['Location', [p.city, p.area].filter(Boolean).join(', ') || '—'],
    ['Phone', p.phone || '—'],
    ['Website', p.website || '—'],
    ['Industry', p.vertical ? p.vertical.replace(/_/g,' ') : selectedVertical.replace(/_/g,' ')],
    ['Services', p.services ? p.services.map(s => `${s.name} ($${s.base_price}/${s.price_unit})`).join(', ') : '—'],
    ['Communication style', p.voice?.style || '—'],
  ];

  container.innerHTML = rows.map(([label, value]) => `
    <div class="pr-row">
      <div class="pr-label">${label}</div>
      <div class="pr-value">${value}</div>
    </div>
  `).join('');
}

function selectAutomation(card) {
  document.querySelectorAll('.auto-card').forEach(c => c.classList.remove('selected'));
  card.classList.add('selected');
  selectedAutomation = card.dataset.level;
}

// ── SAVE AND FINISH ───────────────────────────────────────────────────────
async function saveAndFinish() {
  const btn = event.target;
  btn.disabled = true;
  btn.textContent = 'Saving...';

  const p = extractedProfile || {};

  try {
    await fetch('/api/profile', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      credentials: 'include',
      body: JSON.stringify({
        name: p.name,
        city: p.city,
        area: p.area,
        phone: p.phone,
        website: p.website,
        vertical: p.vertical || selectedVertical,
        automation_level: selectedAutomation,
        onboarding_complete: 1,
        settings: {
          business: {
            name: p.name,
            city: p.city,
            area: p.area,
            phone: p.phone,
            website: p.website,
          },
          voice: p.voice || null,
          vertical: p.vertical || selectedVertical
        },
        preset_data: p
      })
    });

    // Save services if we got them
    if(p.services && p.services.length > 0){
      for(const svc of p.services){
        await fetch('/api/services', {
          method: 'POST',
          headers: {'Content-Type':'application/json'},
          credentials: 'include',
          body: JSON.stringify(svc)
        }).catch(()=>{});
      }
    }

    localStorage.setItem('stoke_onboarding_complete', '1');
    goToStep(4);
  } catch(e) {
    btn.disabled = false;
    btn.textContent = 'Launch Stoke →';
    alert('Could not save profile. Please try again.');
  }
}
</script>
</body>
</html>"""

with open(os.path.join(BASE, "onboarding.html"), 'w', encoding='utf-8') as f:
    f.write(ONBOARDING_HTML)
print("OK: onboarding.html created")


# -----------------------------------------------------------------------------
# PART 5: Update dashboard to show onboarding prompt for new users
#         and wire the lead inbox
# -----------------------------------------------------------------------------

dashboard_path = os.path.join(BASE, "dashboard.html")
with open(dashboard_path, 'r', encoding='utf-8') as f:
    dash = f.read()

ONBOARDING_BANNER = """
<div id="onboarding-banner" style="display:none;background:var(--green);color:white;border-radius:var(--radius-lg);padding:20px 24px;margin-bottom:1.5rem;display:flex;align-items:center;justify-content:space-between;gap:16px">
  <div>
    <div style="font-family:var(--font-serif);font-size:18px;margin-bottom:4px">Welcome to Stoke!</div>
    <div style="font-size:13px;opacity:.8">Set up your business profile so Stoke can work for you.</div>
  </div>
  <a href="onboarding.html" style="padding:10px 20px;background:white;color:var(--green);border-radius:var(--radius);font-size:13px;font-weight:600;text-decoration:none;white-space:nowrap;flex-shrink:0">Set up now &rarr;</a>
</div>
<script>
// Show onboarding banner if not complete
(async function(){
  try {
    const resp = await fetch('/api/profile', {credentials:'include'});
    const data = await resp.json();
    if(data.profile && !data.profile.onboarding_complete){
      document.getElementById('onboarding-banner').style.display = 'flex';
    }
  } catch(e) {}
})();
</script>
"""

# Add banner after the header
if 'onboarding-banner' not in dash:
    dash = dash.replace(
        '</div>\n\n  <div style="display:flex;align-items:center;justify-content:space-between',
        '</div>\n\n' + ONBOARDING_BANNER + '\n  <div style="display:flex;align-items:center;justify-content:space-between',
        1
    )

with open(dashboard_path, 'w', encoding='utf-8') as f:
    f.write(dash)
print("OK: dashboard.html updated with onboarding banner")


# -----------------------------------------------------------------------------
# PART 6: Add onboarding link to nav in update-headers.py for future runs
# -----------------------------------------------------------------------------

print("\n" + "="*60)
print("PLATFORM BUILD COMPLETE")
print("="*60)
print("\nFiles created/modified:")
print("  NEW: migrate-v3.sql")
print("  NEW: js/vertical-presets.json")
print("  NEW: onboarding.html")
print("  MOD: _worker.js (platform layer + agent v2)")
print("  MOD: dashboard.html (onboarding banner)")
print("\nNext: Run migrate-v3.sql in Cloudflare D1 console")
print("Then deploy:")
print("  git add -A")
print('  git commit -m "Platform architecture - vertical presets, dynamic agents, onboarding"')
print("  git push origin main")
print("  npx wrangler@3.99.0 pages deploy . --project-name=stoke --commit-dirty=true")
print("\nThe 4 SQL statements to run in D1 console:")
print("  1. ALTER TABLE businesses ADD COLUMN vertical TEXT DEFAULT 'outdoor_service'")
print("  2. ALTER TABLE businesses ADD COLUMN onboarding_complete INTEGER DEFAULT 0")
print("  3. ALTER TABLE businesses ADD COLUMN automation_level TEXT DEFAULT 'review_all'")
print("  4. (paste full migrate-v3.sql for remaining tables)")
