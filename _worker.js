/**
 * _worker.js — Cloudflare Pages Worker
 * Routes /functions/generate POST requests to Anthropic API
 * All other requests serve static assets normally.
 */

const MAX_BODY_BYTES = 8 * 1024 * 1024;
const MODEL = 'claude-sonnet-4-20250514';
const MAX_TOKENS = 6000;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, x-session-id',
};

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  });

const err = (code, message, status = 400) =>
  json({ error: { code, message } }, status);

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // Route: OPTIONS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS });
    }

    // Route: POST /functions/generate
    if (url.pathname === '/functions/generate' && request.method === 'POST') {

      if (!env.ANTHROPIC_API_KEY)
        return err('MISSING_API_KEY', 'Server not configured', 500);

      const cl = parseInt(request.headers.get('content-length') || '0');
      if (cl > MAX_BODY_BYTES)
        return err('PAYLOAD_TOO_LARGE', 'Request too large — use fewer or smaller photos');

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

    // All other requests — serve static assets
    return env.ASSETS.fetch(request);
  },
};
