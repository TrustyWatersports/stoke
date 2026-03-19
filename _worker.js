/**
 * _worker.js — Cloudflare Pages Worker v8.2
 * Adds streaming support for progressive post rendering.
 *
 * Routes:
 *   POST /functions/generate         — full response (fallback)
 *   POST /functions/generate/stream  — streaming SSE response
 *   OPTIONS *                        — CORS preflight
 *   *                                — static assets
 */

const MAX_BODY_BYTES = 8 * 1024 * 1024;
const MODEL     = 'claude-sonnet-4-20250514';
const MAX_TOKENS = 6000;

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, x-session-id',
};

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status, headers: { 'Content-Type': 'application/json', ...CORS },
  });

const err = (code, message, status = 400) =>
  json({ error: { code, message } }, status);

function validateRequest(request, env) {
  if (!env.ANTHROPIC_API_KEY) return err('MISSING_API_KEY', 'Server not configured', 500);
  const cl = parseInt(request.headers.get('content-length') || '0');
  if (cl > MAX_BODY_BYTES) return err('PAYLOAD_TOO_LARGE', 'Request too large — use fewer or smaller photos');
  return null;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // CORS preflight
    if (request.method === 'OPTIONS')
      return new Response(null, { status: 204, headers: CORS });

    // ── STREAMING endpoint ──────────────────────────────────
    if (url.pathname === '/functions/generate/stream' && request.method === 'POST') {
      const validationErr = validateRequest(request, env);
      if (validationErr) return validationErr;

      let body;
      try { body = await request.json(); }
      catch (e) { return err('INVALID_REQUEST_BODY', 'Could not parse request: ' + e.message); }
      if (!Array.isArray(body?.messages))
        return err('INVALID_REQUEST_BODY', 'messages array required');

      // Call Anthropic with stream=true
      let upstream;
      try {
        upstream = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': env.ANTHROPIC_API_KEY,
            'anthropic-version': '2023-06-01',
            'anthropic-beta': 'messages-2023-12-15',
          },
          body: JSON.stringify({
            model: MODEL,
            max_tokens: MAX_TOKENS,
            stream: true,
            messages: body.messages,
          }),
        });
      } catch (e) {
        return err('ANTHROPIC_API_ERROR', 'Could not reach Anthropic: ' + e.message, 502);
      }

      if (!upstream.ok) {
        const errText = await upstream.text();
        return err('ANTHROPIC_API_ERROR', errText, upstream.status);
      }

      // Proxy the SSE stream straight through to the browser
      return new Response(upstream.body, {
        status: 200,
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Transfer-Encoding': 'chunked',
          ...CORS,
        },
      });
    }

    // ── NON-STREAMING endpoint (fallback) ───────────────────
    if (url.pathname === '/functions/generate' && request.method === 'POST') {
      const validationErr = validateRequest(request, env);
      if (validationErr) return validationErr;

      let body;
      try { body = await request.json(); }
      catch (e) { return err('INVALID_REQUEST_BODY', 'Could not parse request: ' + e.message); }
      if (!Array.isArray(body?.messages))
        return err('INVALID_REQUEST_BODY', 'messages array required');

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
      } catch (e) {
        return err('ANTHROPIC_API_ERROR', 'Could not reach Anthropic: ' + e.message, 502);
      }

      let data;
      try { data = await upstream.json(); }
      catch (e) { return err('UPSTREAM_PARSE_FAILURE', 'Upstream response invalid', 502); }
      return json(data, upstream.status);
    }

    // ── Static assets ────────────────────────────────────────
    return env.ASSETS.fetch(request);
  },
};
