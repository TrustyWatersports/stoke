/**
 * Stoke v8 — Cloudflare Pages Function
 * Secure proxy to Anthropic API
 *
 * Error codes:
 *   MISSING_API_KEY       — ANTHROPIC_API_KEY env var not set
 *   PAYLOAD_TOO_LARGE     — request body > 8MB
 *   RATE_LIMIT_EXCEEDED   — >10 requests/hour from this session
 *   INVALID_REQUEST_BODY  — JSON parse failure
 *   ANTHROPIC_API_ERROR   — upstream API failed
 *   UPSTREAM_PARSE_FAILURE — upstream response not valid JSON
 */
const MAX_BODY_BYTES = 8 * 1024 * 1024;
const RATE_LIMIT = 10;
const RATE_WINDOW = 3600;
const MODEL = 'claude-sonnet-4-20250514';
const MAX_TOKENS = 6000;
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, x-session-id',
};
const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...CORS } });
const err = (code, message, status = 400) => json({ error: { code, message } }, status);
async function rateCheck(env, sessionId) {
  if (!env.STOKE_KV) return true;
  const key = `rl:${sessionId}`;
  const count = parseInt((await env.STOKE_KV.get(key)) || '0');
  if (count >= RATE_LIMIT) return false;
  await env.STOKE_KV.put(key, String(count + 1), { expirationTtl: RATE_WINDOW });
  return true;
}
export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}
export async function onRequestPost(context) {
  const { request, env } = context;
  if (!env.ANTHROPIC_API_KEY) return err('MISSING_API_KEY', 'Server not configured', 500);
  const cl = parseInt(request.headers.get('content-length') || '0');
  if (cl > MAX_BODY_BYTES) return err('PAYLOAD_TOO_LARGE', 'Request too large — use fewer or smaller photos');
  const sessionId = request.headers.get('x-session-id') || 'anon';
  if (!(await rateCheck(env, sessionId))) return err('RATE_LIMIT_EXCEEDED', 'Too many requests — please wait', 429);
  let body;
  try { body = await request.json(); }
  catch (e) { return err('INVALID_REQUEST_BODY', 'Could not parse request: ' + e.message); }
  if (!Array.isArray(body?.messages)) return err('INVALID_REQUEST_BODY', 'messages array required');
  let upstream;
  try {
    upstream = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({ model: MODEL, max_tokens: MAX_TOKENS, messages: body.messages }),
    });
  } catch (e) { return err('ANTHROPIC_API_ERROR', 'Could not reach Anthropic: ' + e.message, 502); }
  let data;
  try { data = await upstream.json(); }
  catch (e) { return err('UPSTREAM_PARSE_FAILURE', 'Upstream response invalid', 502); }
  return json(data, upstream.status);
}
