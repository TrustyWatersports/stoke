import os, re

BASE = r"C:\Users\andre\stoke"

with open(os.path.join(BASE, "_worker.js"), 'r', encoding='utf-8') as f:
    worker = f.read()

# Fix 1: handleGmailSync - return immediately, process in background
OLD_SYNC = """// Manual sync + cron fallback - polls for unread messages
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
}"""

NEW_SYNC = """// Manual sync + cron fallback - polls for unread messages
// Returns immediately with job ID, processes in background via ctx.waitUntil
async function handleGmailSync(request, env, businessId, ctx){
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

  // Fetch message list quickly
  const msgs = await fetchUnreadMessages(accessToken).catch(() => ({ messages: [] }));
  if(!msgs.messages?.length) return json({ ok: true, processed: 0, skipped: 0, total: 0, message: 'No new messages' });

  const total = msgs.messages.length;
  const jobId = 'sync_' + token(8);

  // Process in background so we don't hit Worker CPU timeout
  const processAsync = async () => {
    let processed = 0, skipped = 0;
    for(const m of msgs.messages.slice(0, 20)){
      try {
        const full   = await fetchGmailMessage(m.id, accessToken);
        const parsed = parseGmailMessage(full);
        const result = await processEmailThroughPipeline(parsed, targetBusinessId, conn, env);
        if(result.skipped) skipped++;
        else if(result.ok) processed++;
      } catch(e) {
        console.error('[Gmail Sync] Error on', m.id, e.message);
      }
    }
    // Log completion
    await logAutomation(env, targetBusinessId, 'gmail_sync_complete',
      'Sync complete: ' + processed + ' leads, ' + skipped + ' skipped',
      { job_id: jobId, processed, skipped, total },
      'gmail_sync', 1, 'completed'
    ).catch(() => {});
    console.log('[Gmail Sync] Done:', processed, 'processed,', skipped, 'skipped');
  };

  // Use ctx.waitUntil if available (keeps Worker alive after response)
  if(ctx?.waitUntil){
    ctx.waitUntil(processAsync());
  } else {
    // For cron - just await directly
    await processAsync();
  }

  return json({
    ok: true,
    job_id: jobId,
    total,
    message: 'Processing ' + total + ' email' + (total !== 1 ? 's' : '') + ' in background. Check lead inbox in a moment.',
    status: 'processing'
  });
}"""

if OLD_SYNC in worker:
    worker = worker.replace(OLD_SYNC, NEW_SYNC)
    print("OK: handleGmailSync fixed to use ctx.waitUntil")
else:
    print("WARN: Could not find handleGmailSync - searching for partial match")
    idx = worker.find("async function handleGmailSync")
    if idx >= 0:
        print("Found at char", idx, "- manual fix needed")
        print(worker[idx:idx+100])

# Fix 2: Pass ctx to handleGmailSync in the router
OLD_ROUTE = "if(path==='/api/gmail/sync'&&method==='POST')return handleGmailSync(request,env,null);"
NEW_ROUTE = "if(path==='/api/gmail/sync'&&method==='POST')return handleGmailSync(request,env,null,ctx);"

if OLD_ROUTE in worker:
    worker = worker.replace(OLD_ROUTE, NEW_ROUTE)
    print("OK: ctx passed to handleGmailSync in router")
else:
    print("WARN: gmail/sync route not found")

# Fix 3: Also pass ctx in the cron handler
OLD_CRON_SYNC = "await handleGmailSync(null, env, conn.business_id);"
NEW_CRON_SYNC = "await handleGmailSync(null, env, conn.business_id, null);"

if OLD_CRON_SYNC in worker:
    worker = worker.replace(OLD_CRON_SYNC, NEW_CRON_SYNC)
    print("OK: cron call updated")

# Fix 4: Use simpler/faster pipeline for email processing to avoid timeouts
# Replace processEmailThroughPipeline to use fast model only (skip extended thinking)
# Extended thinking is for interactive use, not background email processing
OLD_INTAKE_CALL = """  // Tool use extraction
  let intake;
  try {
    intake = await callClaudeTool(
      env, FAST_MODEL_V4,
      systemPrompt,
      'Extract intake from this email inquiry:\\n\\n' + parsedEmail.fullText,
      INTAKE_TOOL, 1000
    );
  } catch(e) {
    // Fallback to basic extraction"""

NEW_INTAKE_CALL = """  // Tool use extraction - use FAST model only for email pipeline
  // Extended thinking is reserved for interactive/manual use, not background processing
  let intake;
  try {
    intake = await callClaudeTool(
      env, FAST_MODEL_V4,  // Always fast model in background pipeline
      systemPrompt,
      'Extract intake from this email inquiry:\\n\\n' + parsedEmail.fullText,
      INTAKE_TOOL, 800
    );
  } catch(e) {
    // Fallback to basic extraction"""

if OLD_INTAKE_CALL in worker:
    worker = worker.replace(OLD_INTAKE_CALL, NEW_INTAKE_CALL)
    print("OK: Email pipeline uses fast model only")

# Fix 5: Skip the validation pass in email pipeline (save ~500ms per email)
OLD_VALIDATE = """  // Validation pass
  try {
    const validation = await validateIntake(env, profile, parsedEmail.fullText, intake);
    if(!validation.is_valid) intake = applyCorrections(intake, validation);
  } catch(e) { /* non-critical */ }

  // Draft reply"""

NEW_VALIDATE = """  // Skip validation pass in background email pipeline - saves time
  // Validation runs in interactive mode (handleMasterPipeline) but not here

  // Draft reply"""

if OLD_VALIDATE in worker:
    worker = worker.replace(OLD_VALIDATE, NEW_VALIDATE)
    print("OK: Validation pass skipped in email pipeline")

with open(os.path.join(BASE, "_worker.js"), 'w', encoding='utf-8') as f:
    f.write(worker)

print("\nAll fixes applied. Deploy:")
print("  npx wrangler@3.99.0 pages deploy . --project-name=stoke --commit-dirty=true")
