#!/usr/bin/env python3
# fix-mobile.py — appends comprehensive mobile CSS to stoke.css

path = r"C:\Users\andre\stoke\css\stoke.css"

with open(path, 'r', encoding='utf-8') as f:
    content = f.read()

# Remove old responsive block and replace with new comprehensive one
OLD = """/* ── RESPONSIVE ─────────────────────────────────────────────────── */
@media (max-width: 560px) {
  .app { padding: 1.25rem; }
  .toggle-grid-4 { grid-template-columns: repeat(2, 1fr); }
  .toggle-grid-3 { grid-template-columns: repeat(2, 1fr); }
  .results-title { font-size: 17px; }
  .cal-cell { min-height: 52px; }
  .cal-dot  { width: 6px; height: 6px; }
}"""

NEW = """/* ── RESPONSIVE ─────────────────────────────────────────────────── */

/* ── TABLET (max 860px) ─────────────────────────────────────────── */
@media (max-width: 860px) {
  body { padding: 1rem 0.5rem; }
  .app, .app.app-wide { padding: 1.25rem; }
  .header { margin-bottom: 1.25rem; padding-bottom: 1rem; }
  .wordmark { font-size: 18px; }
  .nav-pill { font-size: 10px; padding: 4px 8px; }
}

/* ── MOBILE (max 640px) ─────────────────────────────────────────── */
@media (max-width: 640px) {

  /* Base layout */
  body { padding: 0; background: var(--bg); }
  .app, .app.app-wide, .app.app-narrow {
    padding: 1rem;
    border-radius: 0;
    border: none;
    box-shadow: none;
    min-height: 100vh;
  }

  /* Header — sticky, compact */
  .header {
    position: sticky;
    top: 0;
    background: var(--bg);
    z-index: 50;
    margin: -1rem -1rem 1rem;
    padding: 10px 1rem;
    border-bottom: 0.5px solid var(--border);
    border-radius: 0;
    gap: 6px;
  }
  .header-home .wordmark { display: none; }
  .version-badge { display: none; }
  .header-divider { display: none; }
  .header-nav { gap: 4px; overflow-x: auto; -webkit-overflow-scrolling: touch; padding-bottom: 2px; }
  .nav-pill { font-size: 11px; padding: 5px 10px; white-space: nowrap; flex-shrink: 0; }
  .nav-pill-icon { width: 28px; height: 28px; }
  .auth-badge { display: none; }

  /* Dashboard */
  .greeting-bar { flex-direction: column; align-items: flex-start; gap: 4px; margin-bottom: 1rem; padding-bottom: 1rem; }
  .greeting-date { text-align: left; display: flex; gap: 12px; }
  .greeting-name { font-size: 22px; }
  .greeting-sub { font-size: 12px; }
  .stat-row { grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 1rem; }
  .stat-value { font-size: 22px; }
  .stat-card { padding: 0.75rem; }
  .dash-grid { grid-template-columns: 1fr !important; gap: 10px; }
  .dash-card.span-2, .dash-card.span-3 { grid-column: span 1; }
  .tools-grid { grid-template-columns: 1fr 1fr; gap: 6px; }
  .tool-btn { padding: 10px 8px; }
  .tool-icon { width: 30px; height: 30px; font-size: 15px; }
  .quick-action-btn { padding: 10px 12px; font-size: 12px; }

  /* Calendar */
  .cal-shell { flex-direction: column; height: auto; }
  .cal-sidebar {
    width: 100%;
    border-right: none;
    border-bottom: 0.5px solid var(--border);
    padding: 0.75rem;
    flex-direction: row;
    flex-wrap: wrap;
    gap: 0.75rem;
  }
  .mini-cal { display: none; }
  #type-filters { display: flex; gap: 6px; overflow-x: auto; -webkit-overflow-scrolling: touch; padding-bottom: 4px; width: 100%; }
  .filter-item { flex-shrink: 0; }
  #upcoming-list { display: none; }
  .cal-toolbar { flex-wrap: wrap; gap: 6px; padding: 10px; }
  .cal-title { font-size: 14px; min-width: unset; width: 100%; order: -1; }
  .view-btn { font-size: 10px; padding: 5px 8px; }
  .new-event-btn { margin-left: auto; font-size: 11px; padding: 6px 10px; }
  .cal-body { min-height: 400px; overflow-x: auto; }
  .week-grid { min-width: 500px; }

  /* AI lead parser */
  #lead-input { font-size: 13px; rows: 2; }

  /* Event modal */
  .event-modal { width: calc(100vw - 16px); max-height: 90vh; }
  .modal-row { grid-template-columns: 1fr; }

  /* Invoices */
  .invoice-layout { grid-template-columns: 1fr !important; }
  .invoice-parties { grid-template-columns: 1fr !important; }
  .invoice-paper-header { padding: 1rem; flex-direction: column; gap: 8px; }
  .invoice-biz-name { font-size: 18px; }
  .invoice-meta { text-align: left; }
  .line-items-header { grid-template-columns: 1fr 40px 60px 60px 26px; font-size: 9px; padding: 4px 6px; }
  .line-item-row { grid-template-columns: 1fr 40px 60px 60px 26px; padding: 4px 6px; }
  .send-btn { font-size: 13px; padding: 11px; }

  /* Reel Maker */
  .reel-layout { grid-template-columns: 1fr !important; }
  .reel-preview-wrap { position: static !important; order: -1; align-items: center; }
  .reel-canvas-frame { width: 150px; height: 267px; }
  .mode-toggle { margin-bottom: 1rem; }
  .music-grid { grid-template-columns: 1fr; }
  .vibe-grid { grid-template-columns: repeat(3, 1fr); }
  .caption-source { flex-wrap: wrap; }

  /* Voice */
  #stoke-voice-btn {
    bottom: max(20px, env(safe-area-inset-bottom, 20px));
    right: 16px;
    width: 50px;
    height: 50px;
    font-size: 20px;
    display: flex !important;
  }
  #stoke-voice-header-btn { display: none !important; }
  #stoke-voice-overlay, #stoke-command-card {
    left: 8px;
    right: 8px;
    width: calc(100vw - 16px);
    bottom: calc(max(20px, env(safe-area-inset-bottom, 20px)) + 66px);
    transform: none;
  }

  /* iOS form zoom prevention */
  input, select, textarea { font-size: 16px !important; }

  /* Legacy */
  .toggle-grid-4 { grid-template-columns: repeat(2, 1fr); }
  .toggle-grid-3 { grid-template-columns: repeat(2, 1fr); }
  .results-title { font-size: 17px; }
  .cal-cell { min-height: 52px; }
  .cal-dot { width: 6px; height: 6px; }
}

/* ── iPhone notch / Dynamic Island safe areas ────────────────────── */
@supports (padding: max(0px)) {
  .header {
    padding-left: max(1rem, env(safe-area-inset-left));
    padding-right: max(1rem, env(safe-area-inset-right));
  }
  .app {
    padding-left: max(1rem, env(safe-area-inset-left));
    padding-right: max(1rem, env(safe-area-inset-right));
  }
}"""

# Find old block
idx = content.find('/* \u2500\u2500 RESPONSIVE')
if idx == -1:
    # Just append
    content = content + '\n\n' + NEW
    print("Appended (old block not found)")
else:
    content = content[:idx] + NEW
    print("Replaced old responsive block")

with open(path, 'w', encoding='utf-8') as f:
    f.write(content)

print("Done.")
