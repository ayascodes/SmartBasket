/**
 * SmartBasket Admin — React Frontend v4
 * - Proper SVG icons (pencil, eye, trash, etc.)
 * - Fully responsive (mobile-first)
 * - Cropped images only in edit/view
 * - Working batch delete
 * - Clean design matching screenshots
 */
import { useState, useEffect, useRef, useCallback } from "react";
import logo from "./assets/logowithouttext.png";

const API_BASE = "https://prominent-purebred-hatchback.ngrok-free.dev";
const H      = { "ngrok-skip-browser-warning": "true", "Content-Type": "application/json" };
const H_FORM = { "ngrok-skip-browser-warning": "true" };

// ── API ───────────────────────────────────────────────────────────────────────
const api = {
  getStats:        () => fetch(`${API_BASE}/api/gallery/stats`, { headers: H }).then(r => r.json()),
  getKaggleStatus: () => fetch(`${API_BASE}/api/kaggle/status`, { headers: H }).then(r => r.json()),
  pullFromKaggle:  (force=false) => fetch(`${API_BASE}/api/kaggle/pull`, { method:"POST", headers:H, body:JSON.stringify({force}) }).then(r=>r.json()),
  listProducts:    (q="") => fetch(`${API_BASE}/api/products${q?`?q=${encodeURIComponent(q)}`:""}`, { headers:H }).then(r=>r.json()),
  getProduct:      (f) => fetch(`${API_BASE}/api/products/${f}`, { headers:H }).then(r=>r.json()),
  deleteProduct:   async (f) => { const r = await fetch(`${API_BASE}/api/products/${f}`, { method:"DELETE", headers:H }); if(!r.ok){const e=await r.json();throw new Error(e.error||"Failed");} return r.json(); },
  deleteImage:     (f,s,n) => fetch(`${API_BASE}/api/products/${f}/image/${s}/${n}`, { method:"DELETE", headers:H }).then(r=>r.json()),
  fetchImageB64:   async (f,s,n) => { try { const r=await fetch(`${API_BASE}/api/products/${f}/image/${s}/${n}`,{headers:H}); const d=await r.json(); return d.data||null; } catch { return null; } },
  fetchThumb:      async (f) => { try { const r=await fetch(`${API_BASE}/api/products/${f}/thumbnail`,{headers:H}); const d=await r.json(); return d.thumbnail?`data:image/jpeg;base64,${d.thumbnail}`:null; } catch { return null; } },
  addProduct:      async (label, files) => { const fd=new FormData(); fd.append("label",label); files.forEach(f=>fd.append("images",f)); const r=await fetch(`${API_BASE}/api/products`,{method:"POST",headers:H_FORM,body:fd}); if(!r.ok){const e=await r.json();throw new Error(e.error||"Failed");} return r.json(); },
  updateProduct:   async (folder, label, files) => { const fd=new FormData(); if(label)fd.append("label",label); files.forEach(f=>fd.append("images",f)); const r=await fetch(`${API_BASE}/api/products/${folder}`,{method:"PUT",headers:H_FORM,body:fd}); if(!r.ok){const e=await r.json();throw new Error(e.error||"Failed");} return r.json(); },
};

// ── SVG Icons ─────────────────────────────────────────────────────────────────
const Icon = ({ name, size = 16, color = "currentColor" }) => {
  const icons = {
    eye:      <><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></>,
    pencil:   <><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></>,
    trash:    <><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></>,
    plus:     <><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></>,
    search:   <><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></>,
    refresh:  <><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></>,
    arrowL:   <><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></>,
    chLeft:   <polyline points="15 18 9 12 15 6"/>,
    chRight:  <polyline points="9 18 15 12 9 6"/>,
    warn:     <><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></>,
    check:    <polyline points="20 6 9 17 4 12"/>,
    x:        <><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></>,
    info:     <><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></>,
    folder:   <><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></>,
    upload:   <><polyline points="16 16 12 12 8 16"/><line x1="12" y1="12" x2="12" y2="21"/><path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3"/></>,
    settings: <><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></>,
    logout:   <><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></>,
    package:  <><line x1="16.5" y1="9.4" x2="7.5" y2="4.21"/><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></>,
  };
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      {icons[name]}
    </svg>
  );
};

// ── CSS ───────────────────────────────────────────────────────────────────────
const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
:root {
  --blue:#2563eb; --blue-h:#1d4ed8; --blue-bg:#eff6ff; --blue-bd:#bfdbfe;
  --text:#111827; --t2:#6b7280; --t3:#9ca3af;
  --border:#e5e7eb; --bg:#f3f4f6; --white:#fff;
  --red:#ef4444; --red-bg:#fee2e2; --red-bd:#fca5a5;
  --green:#16a34a; --green-bg:#dcfce7;
  --shadow:0 1px 3px rgba(0,0,0,.1),0 1px 2px rgba(0,0,0,.06);
  --shadow-md:0 4px 6px -1px rgba(0,0,0,.1),0 2px 4px -1px rgba(0,0,0,.06);
  --r:12px;
}
html { font-size: 16px; }
body { font-family:'Inter',sans-serif; background:var(--bg); color:var(--text); line-height:1.5; min-height:100vh; }

/* ═══ LAYOUT ═══ */
.app { display:flex; min-height:100vh; width:100%; }

/* ═══ SIDEBAR ═══ */
.sidebar {
  width:240px; flex-shrink:0; background:var(--white); border-right:1px solid var(--border);
  display:flex; flex-direction:column; position:fixed; top:0; left:0; height:100vh; z-index:200;
  transition:width .2s;
}
.sb-logo { display:flex; align-items:center; gap:10px; padding:20px 20px 18px; border-bottom:1px solid var(--border); }
.sb-logo-icon { width:38px; height:38px; background:var(--blue); border-radius:10px; display:flex; align-items:center; justify-content:center; flex-shrink:0; }
.sb-logo-text { font-size:15px; font-weight:700; color:var(--text); white-space:nowrap; }
.sb-nav { flex:1; padding:12px 12px; display:flex; flex-direction:column; gap:2px; overflow-y:auto; }
.sb-item { display:flex; align-items:center; gap:10px; padding:10px 12px; border-radius:8px; cursor:pointer; font-size:13px; font-weight:500; color:var(--t2); transition:all .15s; white-space:nowrap; }
.sb-item:hover { background:var(--bg); color:var(--text); }
.sb-item.active { background:var(--blue-bg); color:var(--blue); }
.sb-item-icon { flex-shrink:0; }
.sb-footer { padding:14px 16px; border-top:1px solid var(--border); display:flex; align-items:center; gap:10px; }
.sb-avatar { width:34px; height:34px; border-radius:50%; background:linear-gradient(135deg,#f59e0b,#ef4444); display:flex; align-items:center; justify-content:center; color:#fff; font-size:13px; font-weight:700; flex-shrink:0; }
.sb-uname { font-size:12px; font-weight:600; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.sb-urole { font-size:11px; color:var(--t3); }

/* ═══ MAIN ═══ */
.main { margin-left:240px; flex:1; min-width:0; transition:margin .2s; display:flex; flex-direction:column; }
.content { padding:32px 36px; flex:1; width:100%; min-width:0; }

/* ═══ TOPBAR (mobile) ═══ */
.topbar { display:none; align-items:center; gap:12px; padding:12px 16px; background:var(--white); border-bottom:1px solid var(--border); position:sticky; top:0; z-index:100; }
.topbar-menu { background:none; border:none; cursor:pointer; padding:4px; display:flex; align-items:center; }
.topbar-title { font-size:15px; font-weight:700; }

/* ═══ BUTTONS ═══ */
.btn { display:inline-flex; align-items:center; gap:6px; padding:9px 16px; border-radius:8px; font-size:13px; font-weight:600; cursor:pointer; border:none; font-family:inherit; transition:all .15s; white-space:nowrap; text-decoration:none; }
.btn:disabled { opacity:.5; cursor:not-allowed; }
.btn-primary   { background:var(--blue); color:#fff; }
.btn-primary:hover:not(:disabled) { background:var(--blue-h); }
.btn-outline   { background:var(--white); color:var(--blue); border:1.5px solid var(--blue); }
.btn-outline:hover:not(:disabled) { background:var(--blue-bg); }
.btn-ghost     { background:var(--white); color:var(--t2); border:1px solid var(--border); }
.btn-ghost:hover:not(:disabled) { background:var(--bg); color:var(--text); }
.btn-danger    { background:var(--red-bg); color:var(--red); border:1px solid var(--red-bd); }
.btn-danger:hover:not(:disabled) { background:#fecaca; }
.btn-sm        { padding:6px 12px; font-size:12px; }
.btn-xs        { padding:5px 10px; font-size:11px; }
.btn-icon      { padding:0; width:34px; height:34px; border-radius:8px; justify-content:center; }

/* ═══ PAGE HEADER ═══ */
.page-hdr { display:flex; align-items:flex-start; justify-content:space-between; margin-bottom:24px; gap:12px; flex-wrap:wrap; width:100%; }
.page-title { font-size:22px; font-weight:700; color:var(--text); }
.page-sub { font-size:13px; color:var(--t3); margin-top:2px; }

/* ═══ STATS ═══ */
.stats-grid { display:grid; grid-template-columns:repeat(2,1fr); gap:16px; margin-bottom:24px; width:100%; }
.stat-card { background:var(--white); border:1px solid var(--border); border-radius:var(--r); padding:20px 22px; box-shadow:var(--shadow); }
.stat-lbl { font-size:11px; text-transform:uppercase; letter-spacing:.06em; color:var(--t3); font-weight:600; margin-bottom:8px; }
.stat-val { font-size:30px; font-weight:700; line-height:1; }
.stat-badge { display:inline-flex; align-items:center; gap:4px; font-size:11px; font-weight:600; color:var(--green); background:var(--green-bg); padding:2px 8px; border-radius:20px; margin-top:8px; }
.stat-note { font-size:12px; color:var(--t3); margin-top:6px; }

/* ═══ KAGGLE BAR ═══ */
.kbar { display:flex; align-items:center; gap:10px; background:var(--white); border:1px solid var(--border); border-radius:10px; padding:10px 14px; margin-bottom:20px; box-shadow:var(--shadow); flex-wrap:wrap; width:100%; }
.kdot { width:8px; height:8px; border-radius:50%; flex-shrink:0; }
.kdot-ok { background:#22c55e; } .kdot-warn { background:#f59e0b; }
.kdot-err { background:var(--red); } .kdot-sync { background:var(--blue); animation:pulse 1s infinite; }
@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.4} }
.kinfo { flex:1; font-size:12px; color:var(--t2); min-width:120px; }
.kinfo b { color:var(--text); }
.kds { font-family:monospace; font-size:10px; color:var(--t3); margin-top:1px; }

/* ═══ TABLE CARD ═══ */
.tcard { background:var(--white); border:1px solid var(--border); border-radius:var(--r); overflow:hidden; box-shadow:var(--shadow); width:100%; }
.ttoolbar { display:flex; align-items:center; justify-content:space-between; padding:12px 16px; border-bottom:1px solid var(--border); gap:10px; flex-wrap:wrap; }
.ttoolbar-left { display:flex; align-items:center; gap:8px; flex:1; min-width:0; }
.ttoolbar-right { display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
.search-box { display:flex; align-items:center; gap:8px; background:var(--bg); border:1px solid var(--border); border-radius:8px; padding:8px 12px; flex:1; max-width:280px; min-width:140px; }
.search-box input { background:none; border:none; outline:none; font-size:13px; font-family:inherit; color:var(--text); width:100%; }
.search-box input::placeholder { color:var(--t3); }

/* ── Table ── */
.tbl-wrap { overflow-x:auto; }
table { width:100%; border-collapse:collapse; min-width:520px; }
thead th { padding:10px 14px; text-align:left; font-size:11px; text-transform:uppercase; letter-spacing:.05em; color:var(--t3); font-weight:600; border-bottom:1px solid var(--border); background:#fafafa; white-space:nowrap; }
tbody tr { border-bottom:1px solid #f3f4f6; transition:background .1s; }
tbody tr:last-child { border-bottom:none; }
tbody tr:hover { background:#fafbff; }
td { padding:11px 14px; font-size:13px; vertical-align:middle; }
.td-ck { width:44px; } .td-id { width:60px; }
input[type=checkbox] { width:15px; height:15px; accent-color:var(--blue); cursor:pointer; }
.prod-cell { display:flex; align-items:center; gap:10px; }
.thumb { width:38px; height:38px; border-radius:8px; overflow:hidden; background:var(--blue-bg); border:1px solid var(--border); display:flex; align-items:center; justify-content:center; flex-shrink:0; }
.thumb img { width:100%; height:100%; object-fit:cover; }
.prod-name { font-weight:500; }
.tid { font-size:12px; color:var(--t3); font-weight:500; }
.txt-muted { color:var(--t2); }
.txt-sm { font-size:12px; }

/* ── Action buttons ── */
.act-row { display:flex; align-items:center; gap:3px; }
.act-btn {
  width:30px; height:30px; border-radius:7px; border:none; background:transparent;
  cursor:pointer; display:flex; align-items:center; justify-content:center;
  color:var(--t3); transition:all .13s;
}
.act-btn:hover { transform:scale(1.05); }
.act-btn.view:hover  { background:var(--blue-bg); color:var(--blue); }
.act-btn.edit:hover  { background:#fef9c3; color:#854d0e; }
.act-btn.del:hover   { background:var(--red-bg); color:var(--red); }

/* ── Pagination ── */
.pag { display:flex; align-items:center; justify-content:space-between; padding:12px 16px; border-top:1px solid var(--border); flex-wrap:wrap; gap:8px; }
.pag-info { font-size:12px; color:var(--t3); }
.pag-btns { display:flex; align-items:center; gap:4px; }
.pbtn { min-width:32px; height:32px; border-radius:7px; border:1px solid var(--border); background:var(--white); cursor:pointer; display:flex; align-items:center; justify-content:center; font-size:13px; font-weight:500; color:var(--t2); transition:all .12s; font-family:inherit; padding:0 6px; gap:4px; }
.pbtn:hover:not(:disabled) { background:var(--blue-bg); color:var(--blue); border-color:var(--blue-bd); }
.pbtn.on { background:var(--blue); color:#fff; border-color:var(--blue); }
.pbtn:disabled { opacity:.4; cursor:not-allowed; }
.pdots { color:var(--t3); font-size:13px; padding:0 2px; }

/* ═══ FORM ═══ */
.back-btn { display:inline-flex; align-items:center; gap:6px; font-size:13px; color:var(--t2); cursor:pointer; margin-bottom:18px; background:none; border:none; font-family:inherit; transition:color .15s; padding:0; }
.back-btn:hover { color:var(--blue); }
.form-card { background:var(--white); border:1px solid var(--border); border-radius:var(--r); padding:28px; box-shadow:var(--shadow); }
.form-sec { font-size:14px; font-weight:600; margin-bottom:20px; padding-bottom:14px; border-bottom:1px solid var(--border); display:flex; align-items:center; gap:8px; color:var(--text); }
.fgroup { margin-bottom:18px; }
.flabel { display:block; font-size:12px; font-weight:600; color:#374151; margin-bottom:6px; }
.finput { width:100%; padding:10px 14px; border:1.5px solid var(--border); border-radius:8px; font-size:14px; font-family:inherit; color:var(--text); outline:none; transition:border .15s; background:var(--white); }
.finput:focus { border-color:var(--blue); box-shadow:0 0 0 3px var(--blue-bg); }
.frow { display:flex; align-items:center; justify-content:space-between; margin-bottom:6px; }
.fcount { font-size:12px; color:var(--t3); }

.dropzone { border:2px dashed var(--blue-bd); border-radius:10px; padding:28px 20px; text-align:center; cursor:pointer; transition:all .15s; background:#fafcff; position:relative; }
.dropzone:hover,.dropzone.drag { border-color:var(--blue); background:var(--blue-bg); }
.dropzone input { position:absolute; inset:0; opacity:0; cursor:pointer; width:100%; height:100%; }
.dz-icon { margin-bottom:8px; color:var(--blue); }
.dz-label { font-size:13px; font-weight:600; color:var(--blue); margin-bottom:4px; }
.dz-hint { font-size:11px; color:var(--t3); margin-bottom:12px; }
.dz-browse { background:none; border:1.5px solid var(--blue); color:var(--blue); padding:6px 14px; border-radius:7px; font-size:12px; font-weight:600; cursor:pointer; font-family:inherit; }
.dz-browse:hover { background:var(--blue); color:#fff; }

.tip { background:var(--blue-bg); border:1px solid var(--blue-bd); border-radius:8px; padding:12px 14px; margin:14px 0; display:flex; gap:10px; }
.tip-ttl { font-size:12px; font-weight:700; color:#1d4ed8; margin-bottom:2px; }
.tip-txt { font-size:12px; color:#3b82f6; line-height:1.5; }

.img-section-label { font-size:12px; font-weight:600; color:#374151; margin:14px 0 8px; }
.img-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(88px,1fr)); gap:8px; }
.img-item { position:relative; border-radius:10px; overflow:hidden; border:1.5px solid var(--border); aspect-ratio:1; background:var(--bg); display:flex; align-items:center; justify-content:center; }
.img-item img { width:100%; height:100%; object-fit:cover; }
.img-rm { position:absolute; top:4px; right:4px; width:20px; height:20px; background:rgba(0,0,0,.6); border-radius:50%; border:none; cursor:pointer; display:flex; align-items:center; justify-content:center; color:#fff; opacity:0; transition:opacity .15s; }
.img-item:hover .img-rm { opacity:1; }

.form-actions { display:flex; gap:10px; margin-top:24px; }
.form-actions .btn { flex:1; justify-content:center; padding:10px; }
.form-actions .btn-primary { flex:2; }

/* ═══ VIEW PAGE ═══ */
.view-hero { border-radius:var(--r); overflow:hidden; background:var(--blue-bg); height:300px; display:flex; align-items:center; justify-content:center; margin-bottom:16px; }
.view-hero img { width:100%; height:100%; object-fit:cover; }
.view-hero-ph { font-size:64px; }
.view-crops { display:grid; grid-template-columns:repeat(auto-fill,minmax(110px,1fr)); gap:10px; margin-bottom:24px; }
.view-crop-item { border-radius:10px; overflow:hidden; aspect-ratio:1; background:var(--bg); border:1px solid var(--border); display:flex; align-items:center; justify-content:center; }
.view-crop-item img { width:100%; height:100%; object-fit:cover; }
.meta-grid { display:grid; grid-template-columns:repeat(3,1fr); gap:10px; }
.meta-card { background:var(--white); border:1px solid var(--border); border-radius:10px; padding:14px 16px; }
.meta-lbl { font-size:10px; text-transform:uppercase; letter-spacing:.06em; color:var(--t3); font-weight:600; margin-bottom:4px; }
.meta-val { font-size:13px; font-weight:600; word-break:break-all; }

/* ═══ OVERLAY / DIALOG ═══ */
.overlay { position:fixed; inset:0; background:rgba(0,0,0,.45); z-index:400; display:flex; align-items:center; justify-content:center; padding:16px; }
.dialog { background:var(--white); border-radius:16px; padding:28px; max-width:400px; width:100%; box-shadow:0 20px 60px rgba(0,0,0,.18); }
.dialog-title { font-size:17px; font-weight:700; margin-bottom:8px; }
.dialog-body { font-size:13px; color:var(--t2); line-height:1.6; margin-bottom:22px; }
.dialog-actions { display:flex; gap:10px; justify-content:flex-end; }

/* ═══ TOAST ═══ */
.toast { position:fixed; bottom:24px; left:50%; transform:translateX(-50%); padding:11px 20px; border-radius:10px; font-size:13px; font-weight:500; z-index:999; display:flex; align-items:center; gap:8px; box-shadow:var(--shadow-md); animation:fadeUp .25s ease; white-space:nowrap; }
.toast-ok  { background:#111827; color:#fff; }
.toast-err { background:var(--red-bg); color:var(--red); border:1px solid var(--red-bd); }
@keyframes fadeUp { from{opacity:0;transform:translateX(-50%) translateY(8px)} to{opacity:1;transform:translateX(-50%) translateY(0)} }

/* ═══ MISC ═══ */
.loading { display:flex; align-items:center; justify-content:center; gap:12px; padding:60px 20px; color:var(--t3); font-size:14px; }
.spinner { width:18px; height:18px; border:2px solid var(--blue-bd); border-top-color:var(--blue); border-radius:50%; animation:spin .7s linear infinite; flex-shrink:0; }
@keyframes spin { to{transform:rotate(360deg)} }
.empty { text-align:center; padding:56px 20px; }
.empty-icon { font-size:40px; margin-bottom:12px; }
.empty-title { font-size:14px; font-weight:600; color:var(--t2); }
.empty-sub { font-size:12px; color:var(--t3); margin-top:4px; }
.err-banner { background:#fff0f0; border:1px solid var(--red-bd); border-radius:10px; padding:12px 16px; display:flex; align-items:center; gap:10px; margin-bottom:20px; font-size:13px; color:var(--red); }

/* ═══ RESPONSIVE ═══ */
@media (max-width:900px) {
  .sidebar { width:60px; }
  .sb-logo-text, .sb-item span:last-child, .sb-uname, .sb-urole { display:none; }
  .sb-logo { padding:16px 11px 16px; justify-content:center; }
  .sb-item { justify-content:center; padding:10px; }
  .sb-footer { justify-content:center; padding:12px; }
  .main { margin-left:60px; width:calc(100% - 60px); }
  .content { padding:20px 20px; width:100%; }
}
@media (max-width:640px) {
  .sidebar { display:none; }
  .sidebar.open { display:flex; box-shadow:var(--shadow-md); }
  .topbar { display:flex; }
  .main { margin-left:0; width:100%; }
  .content { padding:16px; width:100%; }
  .stats-grid { grid-template-columns:1fr 1fr; gap:10px; }
  .meta-grid { grid-template-columns:1fr 1fr; }
  .page-hdr { flex-direction:column; align-items:stretch; }
  .page-hdr .btn { align-self:flex-start; }
  .ttoolbar { flex-direction:column; align-items:stretch; }
  .ttoolbar-left, .ttoolbar-right { width:100%; }
  .search-box { max-width:none; }
  .form-card { padding:18px; }
  .form-actions { flex-direction:column; }
  .form-actions .btn-primary { flex:1; }
  .view-hero { height:200px; }
  .view-crops { grid-template-columns:repeat(auto-fill,minmax(80px,1fr)); }
  thead th:nth-child(5), td:nth-child(5) { display:none; }
}
@media (max-width:400px) {
  .stats-grid { grid-template-columns:1fr; }
  .meta-grid { grid-template-columns:1fr; }
}
  .sb-logo-icon { 
  width:45px; 
  height:45px; 
  background: #ffffff; 
  display:flex; 
  align-items:center; 
  justify-content:center; 
  flex-shrink:0;
}
`;

// ── Mini helpers ──────────────────────────────────────────────────────────────
const PAGE_SIZE = 5;

function Toast({ msg, type = "ok" }) {
  if (!msg) return null;
  return (
    <div className={`toast toast-${type}`}>
      <Icon name={type === "ok" ? "check" : "warn"} size={15} />
      {msg}
    </div>
  );
}

function Confirm({ title, body, onOk, onCancel, loading }) {
  return (
    <div className="overlay" onClick={onCancel}>
      <div className="dialog" onClick={e => e.stopPropagation()}>
        <div className="dialog-title">{title}</div>
        <div className="dialog-body">{body}</div>
        <div className="dialog-actions">
          <button className="btn btn-ghost btn-sm" onClick={onCancel} disabled={loading}>Cancel</button>
          <button className="btn btn-danger btn-sm" onClick={onOk} disabled={loading}>
            {loading ? <span className="spinner" style={{width:14,height:14}} /> : <><Icon name="trash" size={14} /> Delete</>}
          </button>
        </div>
      </div>
    </div>
  );
}

function Thumb({ folder, size = 38 }) {
  const [src, setSrc] = useState(null);
  useEffect(() => {
    let live = true;
    api.fetchThumb(folder).then(s => { if (live) setSrc(s); }).catch(() => {});
    return () => { live = false; };
  }, [folder]);
  return (
    <div className="thumb" style={{ width: size, height: size }}>
      {src
        ? <img src={src} alt="" />
        : <Icon name="package" size={18} color="var(--blue)" />}
    </div>
  );
}

function CropImg({ folder, filename }) {
  const [src, setSrc] = useState(null);
  useEffect(() => {
    let live = true;
    api.fetchImageB64(folder, "croppedimages", filename)
      .then(s => { if (live) setSrc(s); }).catch(() => {});
    return () => { live = false; };
  }, [folder, filename]);
  return src
    ? <img src={src} alt={filename} style={{width:"100%",height:"100%",objectFit:"cover"}} />
    : <span style={{fontSize:20}}>⏳</span>;
}

// ── Sidebar ───────────────────────────────────────────────────────────────────
function Sidebar({ open }) {
  return (
    <div className={`sidebar${open ? " open" : ""}`}>
      <div className="sb-logo">
        <div className="sb-logo-icon">
          <img
            src={logo}
            alt="SmartBasket Logo"
            style={{
              width: "34px",
              height: "34px",
              objectFit: "contain"
            }}
          />
        </div>
        <span className="sb-logo-text">SmartBasket</span>
      </div>
      <nav className="sb-nav">
        <div className="sb-item active">
          <span className="sb-item-icon"><Icon name="package" size={18} /></span>
          <span>Products</span>
        </div>
        <div className="sb-item">
          <span className="sb-item-icon"><Icon name="settings" size={18} /></span>
          <span>Settings</span>
        </div>
        <div className="sb-item">
          <span className="sb-item-icon"><Icon name="logout" size={18} /></span>
          <span>Logout</span>
        </div>
      </nav>
      <div className="sb-footer">
        <div className="sb-avatar">A</div>
        <div style={{overflow:"hidden"}}>
          <div className="sb-uname">Bounoua Chahinez</div>
          <div className="sb-urole">Catalog admin</div>
        </div>
      </div>
    </div>
  );
}

// ── Kaggle Badge ──────────────────────────────────────────────────────────────
function KaggleBadge({ onPull }) {
  const [status, setStatus] = useState(null);
  const [pulling, setPulling] = useState(false);
  const load = useCallback(async () => {
    try { setStatus(await api.getKaggleStatus()); } catch {}
  }, []);
  useEffect(() => { load(); const t = setInterval(load, 15000); return () => clearInterval(t); }, [load]);
  if (!status) return null;
  const sync = status.sync || {};
  const syncing = sync.state === "pulling" || sync.state === "pushing";
  const dot = !status.authenticated ? "kdot kdot-warn"
    : syncing ? "kdot kdot-sync"
    : sync.state === "error" ? "kdot kdot-err" : "kdot kdot-ok";
  const handlePull = async () => {
    setPulling(true);
    try { await api.pullFromKaggle(false); onPull?.(); } finally { setPulling(false); load(); }
  };
  return (
    <div className="kbar">
      <div className={dot} />
      <div className="kinfo">
        {status.authenticated
          ? <><b>Kaggle</b> connected as <b>{status.username}</b>
              {syncing && <span style={{color:"#3b82f6"}}> — {sync.message}</span>}
              {sync.state==="error" && <span style={{color:"var(--red)"}}> — {sync.message}</span>}
              <div className="kds">📁 {status.images_dataset}</div>
            </>
          : <><b>Kaggle not connected</b> — add <code>~/.kaggle/kaggle.json</code></>}
      </div>
      {status.authenticated && (
        <button className="btn btn-outline btn-sm" onClick={handlePull} disabled={pulling||syncing}>
          <Icon name="refresh" size={13} />
          {pulling||syncing ? "Syncing…" : "Sync"}
        </button>
      )}
    </div>
  );
}

// ── Products List ─────────────────────────────────────────────────────────────
function ProductsList({ onAdd, onEdit, onView }) {
  const [products, setProducts]     = useState([]);
  const [stats, setStats]           = useState({ total_products:0, total_images:0 });
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState("");
  const [search, setSearch]         = useState("");
  const [checked, setChecked]       = useState([]);
  const [page, setPage]             = useState(1);
  const [delTarget, setDelTarget]   = useState(null);
  const [delLoading, setDelLoading] = useState(false);
  const [toast, setToast]           = useState({ msg:"", type:"ok" });
  const stRef = useRef();

  const showToast = (msg, type="ok") => {
    setToast({ msg, type });
    setTimeout(() => setToast({ msg:"", type:"ok" }), 3500);
  };

  const loadAll = useCallback(async (q="") => {
    setLoading(true); setError("");
    try {
      const [p, s] = await Promise.all([api.listProducts(q), api.getStats()]);
      setProducts(p.products || []);
      setStats(s);
      setChecked([]);
    } catch {
      setError("Cannot reach backend. Check Flask is running on " + API_BASE);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  const handleSearch = v => {
    setSearch(v);
    clearTimeout(stRef.current);
    stRef.current = setTimeout(() => { setPage(1); loadAll(v); }, 350);
  };

  const totalPages = Math.ceil(products.length / PAGE_SIZE);
  const pageData   = products.slice((page-1)*PAGE_SIZE, page*PAGE_SIZE);
  const allChk     = pageData.length > 0 && pageData.every(p => checked.includes(p.folder));

  const toggle    = f => setChecked(c => c.includes(f) ? c.filter(x=>x!==f) : [...c, f]);
  const toggleAll = () => setChecked(allChk ? [] : pageData.map(p => p.folder));

  // Batch delete
  const doBatch = async () => {
    setDelLoading(true);
    let ok=0, fail=0;
    for (const f of [...checked]) {
      try { await api.deleteProduct(f); ok++; } catch { fail++; }
    }
    setDelTarget(null);
    showToast(fail===0 ? `${ok} product(s) deleted` : `${ok} deleted, ${fail} failed`, fail?"err":"ok");
    loadAll(search);
    setDelLoading(false);
  };

  // Single delete
  const doSingle = async () => {
    setDelLoading(true);
    try {
      await api.deleteProduct(delTarget.folder);
      showToast(`"${delTarget.label}" deleted`);
      setDelTarget(null);
      loadAll(search);
    } catch(e) { showToast(e.message,"err"); }
    finally { setDelLoading(false); }
  };

  const confirmFn = delTarget?.folder === "__batch__" ? doBatch : doSingle;

  // Pagination
  const pages = () => {
    if (totalPages <= 7) return Array.from({length:totalPages},(_,i)=>i+1);
    if (page <= 4) return [1,2,3,4,5,"…",totalPages];
    if (page >= totalPages-3) return [1,"…",totalPages-4,totalPages-3,totalPages-2,totalPages-1,totalPages];
    return [1,"…",page-1,page,page+1,"…",totalPages];
  };

  return (
    <div className="content">
      {error && <div className="err-banner"><Icon name="warn" size={16}/>{error}</div>}
      <KaggleBadge onPull={() => loadAll(search)} />

      <div className="page-hdr">
        <div>
          <div className="page-title">Products</div>
          <div className="page-sub">Add & manage your products.</div>
        </div>
        <button className="btn btn-primary" onClick={onAdd}>
          <Icon name="plus" size={15} /> Add new product
        </button>
      </div>

      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-lbl">Total Products</div>
          <div className="stat-val">{stats.total_products}</div>
          <div className="stat-badge"><Icon name="check" size={11}/> Active gallery</div>
        </div>
        <div className="stat-card">
          <div className="stat-lbl">Total Images</div>
          <div className="stat-val">{stats.total_images}</div>
          <div className="stat-note">across all products</div>
        </div>
      </div>

      <div className="tcard">
        <div className="ttoolbar">
          <div className="ttoolbar-left">
            <div className="search-box">
              <Icon name="search" size={15} color="var(--t3)" />
              <input placeholder="Search by name or brand…" value={search} onChange={e=>handleSearch(e.target.value)} />
            </div>
          </div>
          <div className="ttoolbar-right">
            <button className="btn btn-ghost btn-sm" onClick={() => loadAll(search)}>
              <Icon name="refresh" size={14}/> Refresh
            </button>
            <button
              className="btn btn-danger btn-sm"
              disabled={!checked.length}
              onClick={() => checked.length && setDelTarget({folder:"__batch__",label:`${checked.length} product(s)`})}
            >
              <Icon name="trash" size={14}/>
              Delete Selected{checked.length > 0 && ` (${checked.length})`}
            </button>
          </div>
        </div>

        <div className="tbl-wrap">
          {loading ? (
            <div className="loading"><span className="spinner"/> Loading gallery…</div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th className="td-ck"><input type="checkbox" checked={allChk} onChange={toggleAll}/></th>
                  <th className="td-id">#IDs</th>
                  <th>Product Label</th>
                  <th>Images</th>
                  <th>Date added</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {pageData.length === 0 && (
                  <tr><td colSpan={6}>
                    <div className="empty">
                      <div className="empty-icon">📦</div>
                      <div className="empty-title">No products found</div>
                      <div className="empty-sub">Try a different search or add a new product</div>
                    </div>
                  </td></tr>
                )}
                {pageData.map(p => (
                  <tr key={p.folder}>
                    <td className="td-ck">
                      <input type="checkbox" checked={checked.includes(p.folder)} onChange={() => toggle(p.folder)}/>
                    </td>
                    <td className="td-id tid">#{p.id}</td>
                    <td>
                      <div className="prod-cell">
                        <Thumb folder={p.folder}/>
                        <span className="prod-name">{p.label}</span>
                      </div>
                    </td>
                    <td className="txt-muted txt-sm">{p.images}</td>
                    <td className="txt-muted txt-sm" style={{whiteSpace:"nowrap"}}>{p.date}</td>
                    <td>
                      <div className="act-row">
                        <button className="act-btn view" title="View" onClick={() => onView(p)}>
                          <Icon name="eye" size={16}/>
                        </button>
                        <button className="act-btn edit" title="Edit" onClick={() => onEdit(p)}>
                          <Icon name="pencil" size={16}/>
                        </button>
                        <button className="act-btn del" title="Delete" onClick={() => setDelTarget(p)}>
                          <Icon name="trash" size={16}/>
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {!loading && totalPages > 1 && (
          <div className="pag">
            <span className="pag-info">
              Showing {(page-1)*PAGE_SIZE+1}–{Math.min(page*PAGE_SIZE, products.length)} of {products.length}
            </span>
            <div className="pag-btns">
              <button className="pbtn" disabled={page===1} onClick={() => setPage(p=>p-1)}>
                <Icon name="chLeft" size={14}/> Prev
              </button>
              {pages().map((pg,i) =>
                pg==="…" ? <span key={`d${i}`} className="pdots">…</span>
                : <button key={pg} className={`pbtn${page===pg?" on":""}`} onClick={() => setPage(pg)}>{pg}</button>
              )}
              <button className="pbtn" disabled={page===totalPages} onClick={() => setPage(p=>p+1)}>
                Next <Icon name="chRight" size={14}/>
              </button>
            </div>
          </div>
        )}
      </div>

      {delTarget && (
        <Confirm
          title={delTarget.folder==="__batch__" ? `Delete ${checked.length} product(s)?` : "Delete product?"}
          body={`"${delTarget.label}" will be permanently removed from the gallery. This action cannot be undone.`}
          onOk={confirmFn}
          onCancel={() => setDelTarget(null)}
          loading={delLoading}
        />
      )}
      <Toast msg={toast.msg} type={toast.type}/>
    </div>
  );
}

// ── Add / Edit Form ───────────────────────────────────────────────────────────
function ProductForm({ mode, product, onBack, onSaved }) {
  const isEdit = mode === "edit";
  const [label, setLabel]       = useState(product?.label || "");
  const [files, setFiles]       = useState([]);
  const [previews, setPreviews] = useState([]);
  const [crops, setCrops]       = useState([]);
  const [dragging, setDragging] = useState(false);
  const [saving, setSaving]     = useState(false);
  const [error, setError]       = useState("");
  const inputRef = useRef();

  useEffect(() => {
    if (isEdit && product?.folder) {
      api.getProduct(product.folder).then(d => {
        setCrops((d.image_list||[]).filter(img => img.dir === "croppedimages"));
      }).catch(() => {});
    }
  }, [isEdit, product]);

  const addFiles = useCallback(list => {
    const nf = Array.from(list).filter(f => f.type.startsWith("image/"));
    setFiles(p => [...p, ...nf]);
    setPreviews(p => [...p, ...nf.map(f => ({ url: URL.createObjectURL(f), name: f.name }))]);
  }, []);

  const removeNew = i => { setFiles(f=>f.filter((_,j)=>j!==i)); setPreviews(p=>p.filter((_,j)=>j!==i)); };

  const removeCrop = async img => {
    await api.deleteImage(product.folder, img.dir, img.name);
    setCrops(p => p.filter(x => x.name !== img.name));
  };

  const save = async () => {
    if (!label.trim()) { setError("Product label is required."); return; }
    if (!isEdit && files.length===0) { setError("Please upload at least one image."); return; }
    setError(""); setSaving(true);
    try {
      const r = isEdit ? await api.updateProduct(product.folder, label, files) : await api.addProduct(label, files);
      onSaved(r, isEdit ? "updated" : "added");
    } catch(e) { setError(e.message); }
    finally { setSaving(false); }
  };

  return (
    <div className="content">
      <button className="back-btn" onClick={onBack}>
        <Icon name="arrowL" size={15}/> Back to products
      </button>
      <div className="page-hdr">
        <div>
          <div className="page-title">{isEdit ? "Edit Product" : "Add Product"}</div>
          <div className="page-sub">Define a product so the in-store cameras can recognize it.</div>
        </div>
      </div>
      {error && <div className="err-banner"><Icon name="warn" size={16}/> {error}</div>}

      <div className="form-card">
        <div className="form-sec">
          <Icon name="pencil" size={17} color="var(--t2)"/> Basic informations
        </div>

        <div className="fgroup">
          <label className="flabel">Product Label</label>
          <input className="finput" value={label} onChange={e=>setLabel(e.target.value)} placeholder="e.g. Venus Shampoo 2en1"/>
        </div>

        <div className="fgroup">
          <div className="frow">
            <label className="flabel" style={{margin:0}}>Product images</label>
            <span className="fcount">{previews.length + crops.length} uploaded</span>
          </div>
          <div className={`dropzone${dragging?" drag":""}`}
            onDragOver={e=>{e.preventDefault();setDragging(true)}}
            onDragLeave={()=>setDragging(false)}
            onDrop={e=>{e.preventDefault();setDragging(false);addFiles(e.dataTransfer.files)}}
            onClick={()=>inputRef.current?.click()}>
            <input ref={inputRef} type="file" multiple accept="image/*"
              onChange={e=>{addFiles(e.target.files);e.target.value="";}}/>
            <div className="dz-icon"><Icon name="upload" size={28} color="var(--blue)"/></div>
            <div className="dz-label">Drag & drop images here</div>
            <div className="dz-hint">PNG, JPG or WebP up to 10MB. Minimum 1 image required.</div>
            <button className="dz-browse" onClick={e=>{e.stopPropagation();inputRef.current?.click()}}>
              or click to browse
            </button>
          </div>
        </div>

        <div className="tip">
          <Icon name="info" size={16} color="var(--blue)"/>
          <div>
            <div className="tip-ttl">Recognition tip:</div>
            <div className="tip-txt">Upload images from different angles and lighting conditions (top, front, side, packaging back) for higher recognition accuracy. 4–8 images per variant is ideal.</div>
          </div>
        </div>

        {crops.length > 0 && (
          <>
            <div className="img-section-label">Existing cropped images</div>
            <div className="img-grid">
              {crops.map((img,i) => (
                <div className="img-item" key={i}>
                  <CropImg folder={product.folder} filename={img.name}/>
                  <button className="img-rm" onClick={()=>removeCrop(img)}>
                    <Icon name="x" size={10}/>
                  </button>
                </div>
              ))}
            </div>
          </>
        )}

        {previews.length > 0 && (
          <>
            <div className="img-section-label">New images to upload</div>
            <div className="img-grid">
              {previews.map((img,i) => (
                <div className="img-item" key={i}>
                  <img src={img.url} alt={img.name} style={{width:"100%",height:"100%",objectFit:"cover"}}/>
                  <button className="img-rm" onClick={()=>removeNew(i)}>
                    <Icon name="x" size={10}/>
                  </button>
                </div>
              ))}
            </div>
          </>
        )}

        <div className="form-actions">
          <button className="btn btn-outline" onClick={onBack}>Cancel</button>
          <button className="btn btn-primary" onClick={save} disabled={saving}>
            {saving
              ? <><span className="spinner" style={{width:15,height:15,borderTopColor:"#fff",borderColor:"rgba(255,255,255,.3)"}}/> Saving…</>
              : <><Icon name="plus" size={15}/> Save</>}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── View Product ──────────────────────────────────────────────────────────────
function ProductView({ product, onBack, onEdit }) {
  const [detail, setDetail]   = useState(null);
  const [loading, setLoading] = useState(true);
  const [srcs, setSrcs]       = useState({});

  useEffect(() => {
    api.getProduct(product.folder).then(d => {
      setDetail(d); setLoading(false);
      const crops = (d.image_list||[]).filter(img=>img.dir==="croppedimages");
      crops.forEach(img => {
        api.fetchImageB64(product.folder,"croppedimages",img.name)
          .then(s => { if(s) setSrcs(p=>({...p,[img.name]:s})); });
      });
    }).catch(()=>setLoading(false));
  }, [product.folder]);

  const crops = (detail?.image_list||[]).filter(img=>img.dir==="croppedimages");

  return (
    <div className="content">
      <button className="back-btn" onClick={onBack}>
        <Icon name="arrowL" size={15}/> Back to products
      </button>
      <div className="page-hdr">
        <div>
          <div className="page-title">{product.label}</div>
          <div className="page-sub">Product detail and cropped images.</div>
        </div>
        <button className="btn btn-primary" onClick={onEdit}>
          <Icon name="pencil" size={15}/> Edit
        </button>
      </div>

      {loading ? <div className="loading"><span className="spinner"/> Loading…</div> : (
        <>
          <div className="view-hero">
            {crops.length > 0
              ? (srcs[crops[0].name]
                  ? <img src={srcs[crops[0].name]} alt=""/>
                  : <span style={{fontSize:40}}>⏳</span>)
              : <span className="view-hero-ph">📦</span>}
          </div>

          {crops.length > 1 && (
            <>
              <div className="img-section-label">All cropped images ({crops.length})</div>
              <div className="view-crops">
                {crops.map((img,i) => (
                  <div className="view-crop-item" key={i}>
                    {srcs[img.name]
                      ? <img src={srcs[img.name]} alt={img.name}/>
                      : <span style={{fontSize:20}}>⏳</span>}
                  </div>
                ))}
              </div>
            </>
          )}

          <div className="meta-grid">
            {[
              { l:"Product ID",     v:`#${product.id}` },
              { l:"Cropped images", v:`${crops.length}` },
              { l:"Status",         v:detail?.status||"draft" },
              { l:"Date added",     v:product.date },
              { l:"Folder",         v:product.folder },
              { l:"Label files",    v:`${detail?.label_files||0}` },
            ].map(({l,v}) => (
              <div key={l} className="meta-card">
                <div className="meta-lbl">{l}</div>
                <div className="meta-val">{v}</div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ── App ───────────────────────────────────────────────────────────────────────
export default function App() {
  const [page, setPage]     = useState("list");
  const [sel, setSel]       = useState(null);
  const [toast, setToast]   = useState({ msg:"", type:"ok" });
  const [menuOpen, setMenu] = useState(false);

  const showToast = (msg, type="ok") => {
    setToast({msg,type});
    setTimeout(()=>setToast({msg:"",type:"ok"}), 3500);
  };

  const saved = (r, action) => {
    const k = r.kaggle_push==="queued" ? " — Kaggle sync in progress…"
            : r.kaggle_push==="local_only" ? " (local only)" : "";
    showToast(`"${r.label}" ${action} ✓ (${r.images} image${r.images!==1?"s":""})${k}`);
    setPage("list");
  };

  return (
    <>
      <style dangerouslySetInnerHTML={{__html: CSS}}/>
      <div className="app" onClick={()=>menuOpen&&setMenu(false)}>
        <Sidebar open={menuOpen}/>
        <div className="main">
          {/* mobile topbar */}
          <div className="topbar">
            <button className="topbar-menu" onClick={e=>{e.stopPropagation();setMenu(o=>!o)}}>
              <Icon name="package" size={22}/>
            </button>
            <span className="topbar-title">SmartBasket</span>
          </div>

          {page==="list" && (
            <ProductsList
              onAdd={()=>setPage("add")}
              onEdit={p=>{setSel(p);setPage("edit")}}
              onView={p=>{setSel(p);setPage("view")}}
            />
          )}
          {page==="add" && (
            <ProductForm mode="add" product={null}
              onBack={()=>setPage("list")} onSaved={saved}/>
          )}
          {page==="edit" && sel && (
            <ProductForm mode="edit" product={sel}
              onBack={()=>setPage("list")} onSaved={saved}/>
          )}
          {page==="view" && sel && (
            <ProductView product={sel}
              onBack={()=>setPage("list")} onEdit={()=>setPage("edit")}/>
          )}
        </div>
        <Toast msg={toast.msg} type={toast.type}/>
      </div>
    </>
  );
}