/**
 * SmartBasket Admin — React Frontend v7
 * Fixes vs v6:
 *  1. Login persisted in localStorage (survives refresh)
 *  2. Thumbnail / cropped-image blobs cached in module-level Maps
 *     → no more icon flicker while images load
 */
import { useState, useEffect, useRef, useCallback } from "react";
import logoWithoutText from './assets/logowithouttext.png';

const API_BASE = "https://prominent-purebred-hatchback.ngrok-free.dev";
const H      = { "ngrok-skip-browser-warning": "true", "Content-Type": "application/json" };
const H_FORM = { "ngrok-skip-browser-warning": "true" };

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

// ── Image caches (module-level → survive re-renders) ──────────────────────────
const thumbCache = new Map();  // folder  → data-url
const cropCache  = new Map();  // folder/filename → data-url

// ── SVG Icons ─────────────────────────────────────────────────────────────────
const Icon = ({ name, size = 16, color = "currentColor", strokeWidth = 1.5 }) => {
  const icons = {
    eye:      <><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></>,
    pencil:   <><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></>,
    trash:    <><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></>,
    plus:     <><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></>,
    search:   <><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></>,
    refresh:  <><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></>,
    arrowL:   <><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></>,
    arrowR:   <><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></>,
    warn:     <><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></>,
    check:    <polyline points="20 6 9 17 4 12"/>,
    x:        <><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></>,
    info:     <><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></>,
    upload:   <><polyline points="16 16 12 12 8 16"/><line x1="12" y1="12" x2="12" y2="21"/><path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3"/></>,
    settings: <><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></>,
    logout:   <><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></>,
    package:  <><line x1="16.5" y1="9.4" x2="7.5" y2="4.21"/><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></>,
    user:     <><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></>,
    bell:     <><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></>,
    shield:   <><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></>,
    database: <><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/></>,
    grid:     <><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></>,
    star:     <><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></>,
    save:     <><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></>,
    link:     <><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></>,
    mail:     <><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></>,
    key:      <><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/></>,
    moon:     <><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></>,
    globe:    <><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></>,
    robot:    <><rect x="4" y="10" width="16" height="10" rx="2" ry="2"/><path d="M12 10V6"/><circle cx="12" cy="5" r="1.5"/><circle cx="9" cy="15" r="1" fill="currentColor" stroke="none"/><circle cx="15" cy="15" r="1" fill="currentColor" stroke="none"/></>,
    lock:     <><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></>,
    eye_off:  <><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></>,
  };
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      {icons[name]}
    </svg>
  );
};

// ── CSS ───────────────────────────────────────────────────────────────────────
const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700&display=swap');
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
:root {
  --blue: #5BB8F5;
  --blue-dark: #4AA8E8;
  --blue-light: #EBF6FE;
  --blue-border: #C5E4FA;
  --orange: #F4874B;
  --dark: #1A2332;
  --dark2: #2D3E52;
  --text: #1A2332;
  --t2: #6B7A8D;
  --t3: #A0AEBA;
  --border: #E8EDF2;
  --bg: #F5F7FA;
  --white: #FFFFFF;
  --green: #22C55E;
  --green-bg: #DCFCE7;
  --red: #EF4444;
  --red-bg: #FEE2E2;
  --red-border: #FCA5A5;
  --shadow-sm: 0 1px 3px rgba(26,35,50,0.08), 0 1px 2px rgba(26,35,50,0.04);
  --shadow: 0 2px 8px rgba(26,35,50,0.08), 0 1px 3px rgba(26,35,50,0.05);
  --r: 12px;
  --sidebar: 200px;
}
html { font-size: 16px; }

body { font-family: 'Poppins', sans-serif; background: var(--bg); color: var(--text); line-height: 1.5; min-height: 100vh; overflow-x: hidden;}
/* ═══ LAYOUT ═══ */
.app { display: flex; min-height: 100vh;width: 100%;  }
/* ═══ SIDEBAR ═══ */
.sidebar {
  width: var(--sidebar);
  flex-shrink: 0;
  background: var(--white);
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  position: fixed;
  top: 0; left: 0;
  height: 100vh;
  z-index: 200;
}
.sb-logo { display: flex; align-items: center; gap: 10px; padding: 22px 20px 18px; border-bottom: 1px solid var(--border); }
.sb-logo-img { height: 38px; width: auto; display: block; }
.sb-logo-text { font-size: 14px; font-weight: 600; color: var(--text); white-space: nowrap; }
.sb-nav { flex: 1; padding: 20px 12px; display: flex; flex-direction: column; gap: 4px; }
.sb-item {
  display: flex; align-items: center; gap: 10px; padding: 10px 12px;
  border-radius: 8px; cursor: pointer; font-size: 13px; font-weight: 500;
  color: var(--t2); transition: all .15s; white-space: nowrap;
  border: none; background: none; font-family: inherit; width: 100%; text-align: left;
}
.sb-item:hover { background: var(--bg); color: var(--text); }
.sb-item.active { background: var(--blue); color: var(--white); border-radius: 8px; }
.sb-item.active svg { stroke: var(--white); }
.sb-footer { padding: 16px; border-top: 1px solid var(--border); display: flex; align-items: center; gap: 10px; }
.sb-avatar-dyn {
  width: 34px; height: 34px; border-radius: 50%;
  background: var(--orange);
  display: flex; align-items: center; justify-content: center;
  color: #fff; font-size: 13px; font-weight: 700; flex-shrink: 0;
}
.sb-uname { font-size: 12px; font-weight: 600; line-height: 1.3; }
.sb-urole { font-size: 11px; color: var(--t3); }
/* ═══ MAIN ═══ */
.main { margin-left: var(--sidebar); flex: 1 1 auto; min-width: 0; width: calc(100% - var(--sidebar));  max-width: calc(100% - var(--sidebar));  }
.content { padding: 40px 48px; text-align: left; width: 100%; max-width: 100%; box-sizing: border-box; }
/* ═══ TOPBAR ═══ */
.topbar { display: none; align-items: center; gap: 12px; padding: 12px 16px; background: var(--white); border-bottom: 1px solid var(--border); position: sticky; top: 0; z-index: 100; }
.topbar-logo-img { height: 28px; width: auto; display: block; }
.topbar-menu { background: none; border: none; cursor: pointer; padding: 4px; display: flex; align-items: center; }
/* ═══ PAGE HEADER ═══ */
.page-hdr { display: flex; align-items: flex-start; justify-content: space-between; margin-bottom: 32px; gap: 12px; flex-wrap: wrap; }
.page-title { font-size: 28px; font-weight: 625; color: var(--text); letter-spacing: -0.3px; text-align: left; }
.page-sub { font-size: 13px; color: var(--t3); margin-top: 4px; font-weight: 400; text-align: left; }
/* ═══ BUTTONS ═══ */
.btn { display: inline-flex; align-items: center; gap: 6px; padding: 10px 20px; border-radius: 8px; font-size: 13px; font-weight: 600; cursor: pointer; border: none; font-family: inherit; transition: all .15s; white-space: nowrap; }
.btn:disabled { opacity: .5; cursor: not-allowed; }
.btn-primary { background: var(--blue); color: var(--white); }
.btn-primary:hover:not(:disabled) { background: var(--blue-dark); }
.btn-outline { background: var(--white); color: var(--blue); border: 1.5px solid var(--blue); }
.btn-outline:hover:not(:disabled) { background: var(--blue-light); }
.btn-ghost { background: var(--white); color: var(--t2); border: 1px solid var(--border); }
.btn-ghost:hover:not(:disabled) { background: var(--bg); color: var(--text); }
.btn-danger { background: var(--white); color: var(--red); border: 1px solid var(--red-border); }
.btn-danger:hover:not(:disabled) { background: var(--red-bg); }
.btn-sm { padding: 7px 14px; font-size: 12px; }
.btn-xs { padding: 5px 10px; font-size: 11px; }
/* ═══ STATS ═══ */
.stats-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 32px; }
.stat-card { background: var(--white); border: 1px solid var(--border); border-radius: var(--r); padding: 24px 28px; box-shadow: var(--shadow-sm); text-align: left; }
.stat-lbl { font-size: 11px; text-transform: uppercase; letter-spacing: .07em; color: var(--t3); font-weight: 600; margin-bottom: 10px; }
.stat-val { font-size: 36px; font-weight: 700; line-height: 1; color: var(--text); }
.stat-badge { display: inline-flex; align-items: center; gap: 4px; font-size: 12px; font-weight: 500; color: var(--green); margin-top: 10px; }
.stat-note { font-size: 12px; color: var(--t3); margin-top: 8px; font-weight: 400; }
/* ═══ KAGGLE BAR ═══ */
.kbar { display: flex; align-items: center; gap: 10px; background: var(--white); border: 1px solid var(--border); border-radius: 10px; padding: 10px 16px; margin-bottom: 28px; box-shadow: var(--shadow-sm); flex-wrap: wrap; }
.kdot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
.kdot-ok { background: #22c55e; } .kdot-warn { background: #f59e0b; }
.kdot-err { background: var(--red); } .kdot-sync { background: var(--blue); animation: pulse 1s infinite; }
@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.4} }
.kinfo { flex: 1; font-size: 12px; color: var(--t2); min-width: 120px; }
.kinfo b { color: var(--text); }
/* ═══ TABLE CARD ═══ */
.tcard { background: var(--white); border: 1px solid var(--border); border-radius: var(--r); overflow: hidden; box-shadow: var(--shadow-sm); }
.ttoolbar { display: flex; align-items: center; justify-content: space-between; padding: 14px 20px; gap: 10px; flex-wrap: wrap; }
.search-wrap { display: flex; align-items: center; gap: 8px; border: 1px solid var(--border); border-radius: 8px; padding: 9px 14px; min-width: 260px; background: var(--white); }
.search-wrap input { background: none; border: none; outline: none; font-size: 13px; font-family: inherit; color: var(--text); width: 100%; }
.search-wrap input::placeholder { color: var(--t3); }
.del-sel-btn { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 500; color: var(--t2); background: var(--white); border: 1px solid var(--border); border-radius: 7px; padding: 8px 14px; cursor: pointer; font-family: inherit; transition: all .15s; }
.del-sel-btn:hover:not(:disabled) { color: var(--red); border-color: var(--red-border); background: var(--red-bg); }
.del-sel-btn:disabled { opacity: .4; cursor: not-allowed; }
/* ── Table ── */
.tbl-wrap { overflow-x: auto;width: 100%;  }
table { width: 100%; border-collapse: collapse;  }
thead tr { border-bottom: 1px solid var(--border); }
thead th { padding: 12px 20px; text-align: left; font-size: 12px; color: var(--t3); font-weight: 500; white-space: nowrap; }
tbody tr { border-bottom: 1px solid #F3F5F8; transition: background .1s; }
tbody tr:last-child { border-bottom: none; }
tbody tr:hover { background: #FAFBFD; }
td { padding: 14px 20px; font-size: 13px; vertical-align: middle; text-align: left; }
.td-ck { width: 52px; } .td-id { width: 80px; }
input[type=checkbox] {
  width: 18px; 
  height: 18px; 
  accent-color: var(--blue); 
  cursor: pointer; 
  border-radius: 4px;
  background-color: #ffffff !important;
  border: 2px solid var(--border) !important;
  appearance: none;
  position: relative;
}

input[type=checkbox]:checked {
  background-color: #ffffff !important;
  border-color: var(--blue) !important;
}

/* Petite coche personnalisée */
input[type=checkbox]:checked::after {
  content: '';
  position: absolute;
  top: 2px;
  left: 5px;
  width: 5px;
  height: 9px;
  border: solid var(--blue);
  border-width: 0 2px 2px 0;
  transform: rotate(45deg);
}
.prod-cell { display: flex; align-items: center; gap: 12px; }
.thumb { width: 36px; height: 36px; border-radius: 8px; overflow: hidden; background: var(--blue-light); border: 1px solid var(--blue-border); display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
.thumb img { width: 100%; height: 100%; object-fit: cover; }
.prod-name { font-weight: 500; font-size: 13px; }
.tid { font-size: 13px; color: var(--t2); font-weight: 400; }
.txt-muted { color: var(--t2); font-size: 13px; font-weight: 400; }
.act-row { display: flex; align-items: center; gap: 10px; }
.act-icon-btn { background: none; border: none; cursor: pointer; padding: 2px; display: flex; align-items: center; transition: opacity .13s; color: var(--t3); }
.act-icon-btn.view:hover { color: var(--blue); }
.act-icon-btn.edit:hover { color: var(--orange); }
.act-icon-btn.del:hover { color: var(--red); }
/* ── Pagination ── */
.pag { display: flex; align-items: center; justify-content: flex-end; padding: 14px 20px; gap: 4px; }
.pbtn { min-width: 32px; height: 32px; border-radius: 6px; border: 1px solid var(--border); background: var(--white); cursor: pointer; display: flex; align-items: center; justify-content: center; font-size: 13px; font-weight: 500; color: var(--t2); transition: all .12s; font-family: inherit; padding: 0 8px; gap: 6px; white-space: nowrap; }
.pbtn:hover:not(:disabled) { border-color: var(--blue); color: var(--blue); }
.pbtn.on { background: var(--blue); color: var(--white); border-color: var(--blue); }
.pbtn:disabled { opacity: .4; cursor: not-allowed; }
.pdots { color: var(--t3); font-size: 13px; padding: 0 4px; display: flex; align-items: center; height: 32px; }
/* ═══ FORM ═══ */
.back-link { display: inline-flex; align-items: center; gap: 6px; font-size: 13px; color: var(--t2); cursor: pointer; margin-bottom: 20px; background: none; border: none; font-family: inherit; transition: color .15s; padding: 0; font-weight: 400; }
.back-link:hover { color: var(--blue); }
.form-card { background: var(--white); border: 1px solid var(--border); border-radius: var(--r); padding: 32px; box-shadow: var(--shadow-sm); text-align: left; }
.form-sec { font-size: 19px; font-weight: 500; margin-bottom: 24px; display: flex; align-items: center; gap: 8px; color: var(--text); }
.fgroup { margin-bottom: 20px; }
.flabel { display: block; font-size: 13px; font-weight: 500; color: var(--text); margin-bottom: 8px; text-align: left; }
.finput { width: 100%; padding: 10px 14px; border: 1.5px solid var(--border); border-radius: 8px; font-size: 13px; font-family: inherit; color: var(--text); outline: none; transition: border .15s; background: var(--white); font-weight: 400; }
.finput:focus { border-color: var(--blue); box-shadow: 0 0 0 3px var(--blue-light); }
.frow { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
.fcount { font-size: 12px; color: var(--t3); }
/* ═══ DROPZONE — CENTERED ═══ */
.dropzone {
  border: 2px dashed var(--blue-border);
  border-radius: 10px;
  padding: 36px 24px;
  cursor: pointer;
  transition: all .15s;
  background: #FAFCFF;
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
}
.dropzone:hover, .dropzone.drag { border-color: var(--blue); background: var(--blue-light); }
.dropzone input { position: absolute; inset: 0; opacity: 0; cursor: pointer; width: 100%; height: 100%; }
.dz-icon { margin-bottom: 12px; color: var(--blue); display: flex; justify-content: center; }
.dz-label { font-size: 13px; font-weight: 600; color: var(--blue); margin-bottom: 6px; text-align: center; }
.dz-hint { font-size: 11px; color: var(--t3); margin-bottom: 18px; font-weight: 400; text-align: center; }
.dz-browse { background: none; border: 1.5px solid var(--blue); color: var(--blue); padding: 7px 22px; border-radius: 6px; font-size: 12px; font-weight: 500; cursor: pointer; font-family: inherit; transition: all .15s; }
.dz-browse:hover { background: var(--blue-light); }
.tip-box { background: var(--blue-light); border: 1px solid var(--blue-border); border-radius: 8px; padding: 12px 16px; margin: 16px 0; display: flex; gap: 10px; align-items: flex-start; }
.tip-txt { font-size: 12px; color: #3B82F6; line-height: 1.6; font-weight: 400; }
.tip-txt b { font-weight: 600; }
.img-section-label { font-size: 12px; font-weight: 600; color: var(--t2); margin: 16px 0 8px; text-align: left; }
.img-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(90px, 1fr)); gap: 8px; }
.img-item { position: relative; border-radius: 10px; overflow: hidden; border: 1.5px solid var(--border); aspect-ratio: 1; background: var(--bg); display: flex; align-items: center; justify-content: center; }
.img-item img { width: 100%; height: 100%; object-fit: cover; }
.img-rm { position: absolute; top: 5px; right: 5px; width: 20px; height: 20px; background: rgba(0,0,0,.55); border-radius: 50%; border: none; cursor: pointer; display: flex; align-items: center; justify-content: center; color: #fff; opacity: 0; transition: opacity .15s; }
.img-item:hover .img-rm { opacity: 1; }
.form-actions { display: flex; gap: 12px; margin-top: 28px; }
.form-actions .btn { flex: 1; justify-content: center; padding: 11px 20px; font-size: 14px; }
.btn-draft { background: var(--white); color: var(--blue); border: 1.5px solid var(--blue); border-radius: 8px; font-family: inherit; font-size: 14px; font-weight: 600; padding: 11px 20px; cursor: pointer; flex: 1; transition: all .15s; text-align: center; }
.btn-draft:hover { background: var(--blue-light); }
/* ═══ VIEW PAGE ═══ */
.view-hero { border-radius: var(--r); overflow: hidden; background: var(--blue-light); display: grid; grid-template-columns: 1fr 1fr 1fr 1fr; grid-template-rows: 1fr 1fr 1fr; gap: 8px; padding: 16px; min-height: 340px; }
.view-hero-main { grid-column: 1; grid-row: 1 / 4; border-radius: 10px; overflow: hidden; background: #E8EFF5; display: flex; align-items: center; justify-content: center; }
.view-hero-main img { width: 100%; height: 100%; object-fit: cover; }
.view-hero-thumb { border-radius: 8px; overflow: hidden; background: #E8EFF5; display: flex; align-items: center; justify-content: center; }
.view-hero-thumb img { width: 100%; height: 100%; object-fit: cover; }
.view-empty { grid-column: 1 / -1; grid-row: 1 / 4; display: flex; flex-direction: column; align-items: flex-start; justify-content: center; padding: 24px; color: var(--t3); font-size: 13px; }
.meta-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-top: 24px; }
.meta-card { background: var(--white); border: 1px solid var(--border); border-radius: 10px; padding: 16px 18px; text-align: left; }
.meta-lbl { font-size: 10px; text-transform: uppercase; letter-spacing: .07em; color: var(--t3); font-weight: 600; margin-bottom: 6px; }
.meta-val { font-size: 13px; font-weight: 600; word-break: break-all; }
/* ═══ SETTINGS ═══ */
.settings-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
.settings-card { background: var(--white); border: 1px solid var(--border); border-radius: var(--r); padding: 28px; box-shadow: var(--shadow-sm); text-align: left; }
.settings-card.full-width { grid-column: 1 / -1; }
.settings-sec { display: flex; align-items: center; gap: 10px; margin-bottom: 20px; padding-bottom: 14px; border-bottom: 1px solid var(--border); }
.settings-sec-title { font-size: 15px; font-weight: 600; color: var(--text); }
.settings-sec-icon { width: 34px; height: 34px; border-radius: 8px; background: var(--blue-light); display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
.toggle-row { display: flex; align-items: center; justify-content: space-between; padding: 14px 0; border-bottom: 1px solid #F3F5F8; }
.toggle-row:last-child { border-bottom: none; padding-bottom: 0; }
.toggle-label { font-size: 13px; font-weight: 500; color: var(--text); }
.toggle-desc { font-size: 11px; color: var(--t3); margin-top: 3px; font-weight: 400; line-height: 1.4; }
.toggle { position: relative; width: 42px; height: 24px; flex-shrink: 0; }
.toggle input { opacity: 0; width: 0; height: 0; }
.toggle-slider { position: absolute; inset: 0; background: var(--border); border-radius: 24px; cursor: pointer; transition: .3s; }
.toggle-slider:before { content: ""; position: absolute; height: 18px; width: 18px; left: 3px; bottom: 3px; background: var(--white); border-radius: 50%; transition: .3s; box-shadow: 0 1px 3px rgba(0,0,0,.15); }
.toggle input:checked + .toggle-slider { background: var(--blue); }
.toggle input:checked + .toggle-slider:before { transform: translateX(18px); }
.profile-avatar { width: 72px; height: 72px; border-radius: 50%; background: linear-gradient(135deg, var(--orange), #E8731A); display: flex; align-items: center; justify-content: center; color: var(--white); font-size: 24px; font-weight: 700; }
.danger-item { display: flex; align-items: center; justify-content: space-between; padding: 14px 0; border-bottom: 1px solid #F3F5F8; }
.danger-item:last-child { border-bottom: none; }
.danger-lbl { font-size: 13px; font-weight: 500; color: var(--text); }
.danger-desc { font-size: 11px; color: var(--t3); margin-top: 3px; line-height: 1.4; }
.danger-zone { border: 1px solid var(--red-border); background: #FFFBFB; border-radius: 10px; padding: 20px; margin-top: 8px; }
.danger-zone-title { font-size: 12px; font-weight: 600; color: var(--red); margin-bottom: 12px; display: flex; align-items: center; gap: 6px; }
.storage-bar { height: 6px; background: var(--border); border-radius: 3px; margin-top: 8px; overflow: hidden; }
.storage-fill { height: 100%; background: var(--blue); border-radius: 3px; transition: width .3s; }
.select-wrap { width: 100%; padding: 10px 14px; border: 1.5px solid var(--border); border-radius: 8px; font-size: 13px; font-family: inherit; color: var(--text); outline: none; background: var(--white); appearance: none; background-image: url("data:image/svg+xml,%3Csvg width='10' height='6' viewBox='0 0 10 6' fill='none' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M1 1L5 5L9 1' stroke='%236B7A8D' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E"); background-repeat: no-repeat; background-position: right 14px center; padding-right: 36px; }
/* ═══ LOGIN PAGE ═══ */
.login-wrap { min-height: 100vh; background: var(--bg); display: flex; align-items: center; justify-content: center; padding: 16px; }
.login-box { width: 100%; max-width: 400px; }
.login-header { text-align: center; margin-bottom: 32px; }
.login-logo { height: 52px; width: auto; margin-bottom: 14px; display: block; margin-left: auto; margin-right: auto; }
.login-title { font-size: 22px; font-weight: 700; color: var(--text); }
.login-sub { font-size: 13px; color: var(--t3); margin-top: 5px; font-weight: 400; }
.login-card { background: var(--white); border: 1px solid var(--border); border-radius: var(--r); padding: 32px; box-shadow: var(--shadow); }
.input-icon-wrap { position: relative; }
.input-icon-wrap .finput { padding-left: 40px; }
.input-icon-left { position: absolute; left: 13px; top: 50%; transform: translateY(-50%); color: var(--t3); pointer-events: none; display: flex; align-items: center; }
.pwd-wrap { position: relative; }
.pwd-wrap .finput { padding-left: 40px; padding-right: 42px; }
.pwd-toggle { position: absolute; right: 12px; top: 50%; transform: translateY(-50%); background: none; border: none; cursor: pointer; color: var(--t3); display: flex; align-items: center; padding: 2px; transition: color .15s; }
.pwd-toggle:hover { color: var(--blue); }
/* ═══ OVERLAY / DIALOG ═══ */
.overlay { position: fixed; inset: 0; background: rgba(0,0,0,.4); z-index: 400; display: flex; align-items: center; justify-content: center; padding: 16px; }
.dialog { background: var(--white); border-radius: 16px; padding: 28px; max-width: 400px; width: 100%; box-shadow: 0 20px 60px rgba(0,0,0,.15); text-align: left; }
.dialog-title { font-size: 16px; font-weight: 700; margin-bottom: 8px; }
.dialog-body { font-size: 13px; color: var(--t2); line-height: 1.6; margin-bottom: 24px; font-weight: 400; }
.dialog-actions { display: flex; gap: 10px; justify-content: flex-end; }
/* ═══ TOAST ═══ */
.toast { position: fixed; bottom: 28px; left: 50%; transform: translateX(-50%); padding: 12px 22px; border-radius: 10px; font-size: 13px; font-weight: 500; z-index: 999; display: flex; align-items: center; gap: 8px; box-shadow: var(--shadow); animation: fadeUp .25s ease; white-space: nowrap; }
.toast-ok  { background: #111827; color: #fff; }
.toast-err { background: var(--red-bg); color: var(--red); border: 1px solid var(--red-border); }
@keyframes fadeUp { from{opacity:0;transform:translateX(-50%) translateY(8px)} to{opacity:1;transform:translateX(-50%) translateY(0)} }
/* ═══ MISC ═══ */
.loading { display: flex; align-items: center; justify-content: center; gap: 12px; padding: 60px 20px; color: var(--t3); font-size: 13px; }
.spinner { width: 18px; height: 18px; border: 2px solid var(--blue-border); border-top-color: var(--blue); border-radius: 50%; animation: spin .7s linear infinite; flex-shrink: 0; }
@keyframes spin { to{transform:rotate(360deg)} }
.empty { text-align: left; padding: 56px 20px; }
.empty-icon { font-size: 36px; margin-bottom: 12px; }
.empty-title { font-size: 14px; font-weight: 600; color: var(--t2); }
.empty-sub { font-size: 12px; color: var(--t3); margin-top: 4px; }
.err-banner { background: #FFF0F0; border: 1px solid var(--red-border); border-radius: 10px; padding: 12px 16px; display: flex; align-items: center; gap: 10px; margin-bottom: 20px; font-size: 13px; color: var(--red); }
.badge-green { display: inline-flex; align-items: center; gap: 4px; background: var(--green-bg); color: var(--green); font-size: 11px; font-weight: 600; padding: 3px 10px; border-radius: 20px; }
/* Force reflow on resize */
html, body, #root { 
  width: 100%; 
  overflow-x: hidden; 
}
/* ═══ RESPONSIVE ═══ */
@media (max-width: 900px) {
  :root { --sidebar: 56px; }
  .sb-logo-text, .sb-item span, .sb-uname, .sb-urole { display: none; }
  .sb-logo { justify-content: center; padding: 16px 10px; }
  .sb-item { justify-content: center; padding: 10px; }
  .sb-footer { justify-content: center; padding: 12px 8px; }
  .content { padding: 24px 24px; }
}
@media (max-width: 640px) {
  .sidebar { display: none; }
  .sidebar.open { display: flex; box-shadow: var(--shadow); }
  .topbar { display: flex; }
  .main { margin-left: 0; }
  .content { padding: 16px; }
  .stats-grid { grid-template-columns: 1fr 1fr; gap: 12px; }
  .meta-grid { grid-template-columns: 1fr 1fr; }
  .page-hdr { flex-direction: column; align-items: flex-start; }
  .settings-grid { grid-template-columns: 1fr; }
  .settings-card.full-width { grid-column: 1; }
  .form-card { padding: 20px; }
  thead th:nth-child(5), td:nth-child(5) { display: none; }
}
@media (max-width: 420px) {
  .stats-grid { grid-template-columns: 1fr; }
  .meta-grid { grid-template-columns: 1fr; }
}
`;

// ── Helpers ───────────────────────────────────────────────────────────────────
const PAGE_SIZE = 4;

function Toast({ msg, type = "ok" }) {
  if (!msg) return null;
  return (
    <div className={`toast toast-${type}`}>
      <Icon name={type === "ok" ? "check" : "warn"} size={14} />
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
            {loading ? <span className="spinner" style={{width:13,height:13}} /> : <><Icon name="trash" size={13}/> Delete</>}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Thumb — cached, no flicker ─────────────────────────────────────────────────
function Thumb({ folder, size = 36 }) {
  const [src, setSrc] = useState(() => thumbCache.get(folder) || null);

  useEffect(() => {
    if (thumbCache.has(folder)) return;   // already fetched
    let live = true;
    api.fetchThumb(folder).then(s => {
      if (!live) return;
      if (s) thumbCache.set(folder, s);
      setSrc(s);
    }).catch(() => {});
    return () => { live = false; };
  }, [folder]);

  return (
    <div className="thumb" style={{ width: size, height: size }}>
      {src
        ? <img src={src} alt="" />
        : <Icon name="package" size={16} color="var(--blue)" />}
    </div>
  );
}

// ── CropImg — cached, no flicker ───────────────────────────────────────────────
function CropImg({ folder, filename }) {
  const key = `${folder}/${filename}`;
  const [src, setSrc] = useState(() => cropCache.get(key) || null);

  useEffect(() => {
    if (cropCache.has(key)) return;
    let live = true;
    api.fetchImageB64(folder, "croppedimages", filename).then(s => {
      if (!live) return;
      if (s) cropCache.set(key, s);
      setSrc(s);
    }).catch(() => {});
    return () => { live = false; };
  }, [key, folder, filename]);

  return src
    ? <img src={src} alt={filename} style={{width:"100%",height:"100%",objectFit:"cover"}} />
    : <div className="spinner" style={{width:16,height:16,margin:"auto"}} />;
}

// ── Login Page ────────────────────────────────────────────────────────────────
function LoginPage({ onLogin }) {
  const [email, setEmail]     = useState("");
  const [pwd, setPwd]         = useState("");
  const [showPwd, setShowPwd] = useState(false);
  const [error, setError]     = useState("");
  const [loading, setLoading] = useState(false);

  const handleLogin = () => {
    setError("");
    if (!email.trim() || !pwd.trim()) { setError("Please enter your email and password."); return; }
    const match = email.match(/^([^@]+)@/);
    if (!match) { setError("Invalid email format. Example: admin@gmail.com"); return; }
    setLoading(true);
    setTimeout(() => {
      if (match[1] === pwd) {
        onLogin(email);
      } else {
        setError("Incorrect password. The password is the part of your email before @");
        setLoading(false);
      }
    }, 700);
  };

  const onKey = e => { if (e.key === "Enter") handleLogin(); };

  return (
    <div className="login-wrap">
      <div className="login-box">
        <div className="login-header">
          <img src={logoWithoutText} alt="Smart Basket" className="login-logo" />
          <div className="login-title">Smart Basket</div>
          <div className="login-sub">Sign in to your admin account</div>
        </div>
        <div className="login-card">
          {error && (
            <div className="err-banner">
              <Icon name="warn" size={15}/> {error}
            </div>
          )}
          <div className="fgroup">
            <label className="flabel">Email address</label>
            <div className="input-icon-wrap">
              <span className="input-icon-left"><Icon name="mail" size={16}/></span>
              <input className="finput" type="email" placeholder="admin@gmail.com"
                value={email} onChange={e => setEmail(e.target.value)} onKeyDown={onKey}/>
            </div>
          </div>
          <div className="fgroup" style={{marginBottom:24}}>
            <label className="flabel">Password</label>
            <div className="pwd-wrap input-icon-wrap">
              <span className="input-icon-left"><Icon name="lock" size={16}/></span>
              <input className="finput" type={showPwd ? "text" : "password"} placeholder="Enter your password"
                value={pwd} onChange={e => setPwd(e.target.value)} onKeyDown={onKey}/>
              <button className="pwd-toggle" onClick={() => setShowPwd(s => !s)} type="button" tabIndex={-1}>
                <Icon name={showPwd ? "eye_off" : "eye"} size={16}/>
              </button>
            </div>
          </div>
          <button
            className="btn btn-primary"
            style={{width:"100%",justifyContent:"center",padding:"12px 20px",fontSize:14,borderRadius:10}}
            onClick={handleLogin}
            disabled={loading}
          >
            {loading
              ? <><span className="spinner" style={{width:14,height:14,borderTopColor:"#fff",borderColor:"rgba(255,255,255,.3)"}}/> Signing in…</>
              : <><Icon name="arrowR" size={15}/> Sign in</>}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Sidebar ───────────────────────────────────────────────────────────────────
function Sidebar({ open, activePage, onNav, userName, userInitial }) {
  return (
    <div className={`sidebar${open ? " open" : ""}`}>
      <div className="sb-logo">
        <img src={logoWithoutText} alt="Smart Basket" className="sb-logo-img" />
        <span className="sb-logo-text">Smart Basket</span>
      </div>
      <nav className="sb-nav">
        <button className={`sb-item${activePage === "products" ? " active" : ""}`} onClick={() => onNav("products")}>
          <Icon name="grid" size={17} /><span>Products</span>
        </button>
        <button className={`sb-item${activePage === "settings" ? " active" : ""}`} onClick={() => onNav("settings")}>
          <Icon name="settings" size={17} /><span>Settings</span>
        </button>
        <button className="sb-item" onClick={() => onNav("logout")}>
          <Icon name="logout" size={17} /><span>Logout</span>
        </button>
      </nav>
      <div className="sb-footer">
        <div className="sb-avatar-dyn">{userInitial}</div>
        <div style={{overflow:"hidden"}}>
          <div className="sb-uname">{userName}</div>
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
              {syncing && <span style={{color:"var(--blue)"}}> — {sync.message}</span>}
              {sync.state==="error" && <span style={{color:"var(--red)"}}> — {sync.message}</span>}
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
  const [products, setProducts] = useState([]);
  const [stats, setStats]       = useState({ total_products: 0, total_images: 0 });
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState("");
  const [search, setSearch]     = useState("");
  const [checked, setChecked]   = useState([]);
  const [page, setPage]         = useState(1);
  const [delTarget, setDelTarget] = useState(null);
  const [delLoading, setDelLoading] = useState(false);
  const [toast, setToast]       = useState({ msg:"", type:"ok" });
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
          <div className="page-sub">Add &amp; manage your products.</div>
        </div>
        <button className="btn btn-primary" onClick={onAdd}>
          <Icon name="plus" size={15} /> Add new product
        </button>
      </div>
      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-lbl">Total Products</div>
          <div className="stat-val">{stats.total_products}</div>
          <div className="stat-badge"><span style={{color:"var(--green)"}}>+3 this week</span></div>
        </div>
        <div className="stat-card">
          <div className="stat-lbl">Total Images</div>
          <div className="stat-val">{stats.total_images}</div>
          <div className="stat-note">across all products</div>
        </div>
      </div>
      <div className="tcard">
        <div className="ttoolbar">
          <div className="search-wrap">
            <Icon name="search" size={15} color="var(--t3)" />
            <input placeholder="Search by name or brand…" value={search} onChange={e => handleSearch(e.target.value)}/>
          </div>
          <button
            className="del-sel-btn"
            disabled={!checked.length}
            onClick={() => checked.length && setDelTarget({folder:"__batch__",label:`${checked.length} product(s)`})}
          >
            <Icon name="trash" size={14} /> Delete Selected
          </button>
        </div>
        <div className="tbl-wrap">
          {loading ? (
            <div className="loading"><span className="spinner"/> Loading gallery…</div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th className="td-ck"><input type="checkbox" checked={allChk} onChange={toggleAll}/></th>
                  <th className="td-id">#Ids</th>
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
                    <td className="td-ck"><input type="checkbox" checked={checked.includes(p.folder)} onChange={() => toggle(p.folder)}/></td>
                    <td className="td-id tid">#{p.id}</td>
                    <td>
                      <div className="prod-cell">
                        <Thumb folder={p.folder}/>
                        <span className="prod-name">{p.label}</span>
                      </div>
                    </td>
                    <td className="txt-muted">{p.images}</td>
                    <td className="txt-muted" style={{whiteSpace:"nowrap"}}>{p.date}</td>
                    <td>
                      <div className="act-row">
                        <button className="act-icon-btn view" title="View" onClick={() => onView(p)}>
                          <Icon name="eye" size={18} color="var(--t3)" />
                        </button>
                        <button className="act-icon-btn edit" title="Edit" onClick={() => onEdit(p)}>
                          <Icon name="pencil" size={18} color="var(--t3)" />
                        </button>
                        <button className="act-icon-btn del" title="Delete" onClick={() => setDelTarget(p)}>
                          <Icon name="trash" size={18} color="var(--t3)" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        {!loading && totalPages > 0 && (
          <div className="pag">
            <button className="pbtn" disabled={page===1} onClick={() => setPage(p=>p-1)}>
              <Icon name="arrowL" size={14}/> Previous
            </button>
            {pages().map((pg,i) =>
              pg==="…" ? <span key={`d${i}`} className="pdots">…</span>
              : <button key={pg} className={`pbtn${page===pg?" on":""}`} onClick={() => setPage(pg)}>{pg}</button>
            )}
            <button className="pbtn" disabled={page===totalPages} onClick={() => setPage(p=>p+1)}>
              Next <Icon name="arrowR" size={14}/>
            </button>
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

  const removeNew  = i => { setFiles(f=>f.filter((_,j)=>j!==i)); setPreviews(p=>p.filter((_,j)=>j!==i)); };
  const removeCrop = async img => {
    await api.deleteImage(product.folder, img.dir, img.name);
    cropCache.delete(`${product.folder}/${img.name}`);
    setCrops(p => p.filter(x => x.name !== img.name));
  };

  const save = async () => {
    if (!label.trim()) { setError("Product label is required."); return; }
    if (!isEdit && files.length===0) { setError("Please upload at least one image."); return; }
    setError(""); setSaving(true);
    try {
      const r = isEdit ? await api.updateProduct(product.folder, label, files) : await api.addProduct(label, files);
      // Invalidate thumb cache for this product so it refetches
      thumbCache.delete(product?.folder || r.folder);
      onSaved(r, isEdit ? "updated" : "added");
    } catch(e) { setError(e.message); }
    finally { setSaving(false); }
  };

  const totalUploaded = previews.length + crops.length;

  return (
    <div className="content">
      <button className="back-link" onClick={onBack}>
        <Icon name="arrowL" size={14}/> Back to products
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
          <Icon name="pencil" size={18} color="var(--t2)"/> Basic information
        </div>
        <div className="fgroup">
          <label className="flabel">Product Label</label>
          <input className="finput" value={label} onChange={e=>setLabel(e.target.value)} placeholder="e.g. Venus Shampoo 2en1"/>
        </div>
        <div className="fgroup">
          <div className="frow">
            <label className="flabel" style={{margin:0}}>Product images</label>
            <span className="fcount">{totalUploaded} uploaded</span>
          </div>
          <div
            className={`dropzone${dragging?" drag":""}`}
            onDragOver={e=>{e.preventDefault();setDragging(true)}}
            onDragLeave={()=>setDragging(false)}
            onDrop={e=>{e.preventDefault();setDragging(false);addFiles(e.dataTransfer.files)}}
            onClick={()=>inputRef.current?.click()}
          >
            <input ref={inputRef} type="file" multiple accept="image/*"
              onChange={e=>{addFiles(e.target.files);e.target.value="";}}/>
            <div className="dz-icon"><Icon name="upload" size={34} color="var(--blue)"/></div>
            <div className="dz-label">Drag &amp; drop images here</div>
            <div className="dz-hint">PNG, JPG, or WebP up to 10MB. Minimum 1 image required.</div>
            <button className="dz-browse" onClick={e=>{e.stopPropagation();inputRef.current?.click()}}>
              or click to browse
            </button>
          </div>
        </div>
        <div className="tip-box">
          <Icon name="info" size={20} color="var(--blue)" strokeWidth={4} />
          <div className="tip-txt">
            <b>Recognition tip:</b> Upload images from different angles and lighting conditions (top, front, side, packaging back) for higher recognition accuracy. 4–8 images per variant is ideal.
          </div>
        </div>
        {crops.length > 0 && (
          <>
            <div className="img-section-label">Existing cropped images</div>
            <div className="img-grid">
              {crops.map((img,i) => (
                <div className="img-item" key={i}>
                  <CropImg folder={product.folder} filename={img.name}/>
                  <button className="img-rm" onClick={()=>removeCrop(img)}><Icon name="x" size={10}/></button>
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
                  <button className="img-rm" onClick={()=>removeNew(i)}><Icon name="x" size={10}/></button>
                </div>
              ))}
            </div>
          </>
        )}
        <div className="form-actions">
          <button className="btn-draft" onClick={onBack}>Draft</button>
          <button className="btn btn-primary" onClick={save} disabled={saving}>
            {saving
              ? <><span className="spinner" style={{width:14,height:14,borderTopColor:"#fff",borderColor:"rgba(255,255,255,.3)"}}/> Saving…</>
              : <> Save</>}
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
        const key = `${product.folder}/${img.name}`;
        if (cropCache.has(key)) {
          setSrcs(p => ({...p, [img.name]: cropCache.get(key)}));
        } else {
          api.fetchImageB64(product.folder,"croppedimages",img.name).then(s => {
            if (s) {
              cropCache.set(key, s);
              setSrcs(p => ({...p, [img.name]: s}));
            }
          });
        }
      });
    }).catch(()=>setLoading(false));
  }, [product.folder]);

  const crops = (detail?.image_list||[]).filter(img=>img.dir==="croppedimages");

  return (
    <div className="content">
      <button className="back-link" onClick={onBack}>
        <Icon name="arrowL" size={14}/> Back to products
      </button>
      <div className="page-hdr">
        <div>
          <div className="page-title">{product.label}</div>
          <div className="page-sub">Define a product so the in-store cameras can recognize it.</div>
        </div>
        <button className="btn btn-primary" onClick={onEdit}>
          <Icon name="pencil" size={14}/> Edit
        </button>
      </div>
      {loading ? <div className="loading"><span className="spinner"/> Loading…</div> : (
        <>
          <div className="view-hero">
            {crops.length === 0 ? (
              <div className="view-empty">
                <Icon name="robot" size={48} color="var(--t3)" />
                <span style={{marginTop:12, fontWeight:500}}>No product images available</span>
              </div>
            ) : (
              <>
                <div className="view-hero-main">
                  {srcs[crops[0].name]
                    ? <img src={srcs[crops[0].name]} alt="main" style={{width:"100%",height:"100%",objectFit:"cover"}}/>
                    : <div className="spinner" style={{margin:"auto"}}/>}
                </div>
                {crops.slice(1, 10).map((img, i) => (
                  <div className="view-hero-thumb" key={i}>
                    {srcs[img.name]
                      ? <img src={srcs[img.name]} alt={img.name} style={{width:"100%",height:"100%",objectFit:"cover"}}/>
                      : <div className="spinner" style={{margin:"auto"}}/>}
                  </div>
                ))}
              </>
            )}
          </div>
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

// ── Settings Page ─────────────────────────────────────────────────────────────
function SettingsPage({ userEmail, userName }) {
  const [notifications, setNotifications] = useState({ sync: true, errors: true, weekly: false, updates: true });
  const [saved, setSaved]     = useState(false);
  const [name, setName]       = useState(userName || "Admin");
  const [email, setEmail]     = useState(userEmail || "");
  const [apiUrl, setApiUrl]   = useState(API_BASE);
  const [language, setLanguage] = useState("English");
  const [compactMode, setCompactMode] = useState(false);
  const [autoSave, setAutoSave] = useState(true);
  const initial = name ? name[0].toUpperCase() : "A";
  const handleSave = () => { setSaved(true); setTimeout(() => setSaved(false), 2500); };
  const Toggle = ({ checked, onChange }) => (
    <label className="toggle">
      <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} />
      <span className="toggle-slider" />
    </label>
  );
  return (
    <div className="content">
      <div className="page-hdr">
        <div>
          <div className="page-title">Settings</div>
          <div className="page-sub">Manage your account and application preferences.</div>
        </div>
        <button className="btn btn-primary" onClick={handleSave}>
          <Icon name="save" size={14}/> {saved ? "Saved ✓" : "Save changes"}
        </button>
      </div>
      <div className="settings-grid">
        <div className="settings-card">
          <div className="settings-sec">
            <div className="settings-sec-icon"><Icon name="user" size={17} color="var(--blue)" /></div>
            <span className="settings-sec-title">Profile</span>
          </div>
          <div style={{display:"flex",alignItems:"center",gap:16,marginBottom:20}}>
            <div className="profile-avatar">{initial}</div>
            <div>
              <div style={{fontSize:14,fontWeight:600}}>{name}</div>
              <div style={{fontSize:12,color:"var(--t3)",marginTop:2}}>Catalog Admin</div>
              <button className="btn btn-outline btn-xs" style={{marginTop:8,fontSize:11}}>Change photo</button>
            </div>
          </div>
          <div className="fgroup">
            <label className="flabel">Full name</label>
            <input className="finput" value={name} onChange={e=>setName(e.target.value)} />
          </div>
          <div className="fgroup" style={{marginBottom:0}}>
            <label className="flabel">Email address</label>
            <input className="finput" value={email} onChange={e=>setEmail(e.target.value)} type="email" />
          </div>
        </div>
        <div className="settings-card">
          <div className="settings-sec">
            <div className="settings-sec-icon"><Icon name="link" size={17} color="var(--blue)" /></div>
            <span className="settings-sec-title">API Connection</span>
          </div>
          <div className="fgroup">
            <label className="flabel">Backend URL</label>
            <input className="finput" value={apiUrl} onChange={e=>setApiUrl(e.target.value)} placeholder="https://..." />
          </div>
          <div className="fgroup">
            <label className="flabel">Kaggle Dataset</label>
            <input className="finput" defaultValue="smartbasket/product-images" placeholder="user/dataset-name" />
          </div>
          <div className="fgroup" style={{marginBottom:0}}>
            <label className="flabel">API Key</label>
            <input className="finput" type="password" defaultValue="••••••••••••••••" />
          </div>
        </div>
        <div className="settings-card">
          <div className="settings-sec">
            <div className="settings-sec-icon"><Icon name="moon" size={17} color="var(--blue)" /></div>
            <span className="settings-sec-title">Preferences</span>
          </div>
          <div className="fgroup">
            <label className="flabel">Language</label>
            <select className="select-wrap" value={language} onChange={e=>setLanguage(e.target.value)}>
              <option>English</option><option>French</option><option>Arabic</option>
            </select>
          </div>
          <div className="toggle-row" style={{paddingTop:4}}>
            <div><div className="toggle-label">Compact mode</div><div className="toggle-desc">Reduce padding and font sizes for dense view</div></div>
            <Toggle checked={compactMode} onChange={setCompactMode} />
          </div>
          <div className="toggle-row" style={{borderBottom:"none"}}>
            <div><div className="toggle-label">Auto-save drafts</div><div className="toggle-desc">Automatically save product forms while editing</div></div>
            <Toggle checked={autoSave} onChange={setAutoSave} />
          </div>
        </div>
        <div className="settings-card">
          <div className="settings-sec">
            <div className="settings-sec-icon"><Icon name="bell" size={17} color="var(--blue)" /></div>
            <span className="settings-sec-title">Notifications</span>
          </div>
          {[
            { key:"sync",    label:"Sync completed",  desc:"Notify when Kaggle sync finishes" },
            { key:"errors",  label:"Sync errors",     desc:"Alert on sync failures or API errors" },
            { key:"weekly",  label:"Weekly digest",   desc:"Summary of weekly catalog activity" },
            { key:"updates", label:"App updates",     desc:"Notify about new features and updates" },
          ].map(({key,label,desc}) => (
            <div className="toggle-row" key={key}>
              <div><div className="toggle-label">{label}</div><div className="toggle-desc">{desc}</div></div>
              <Toggle checked={notifications[key]} onChange={v => setNotifications(n => ({...n,[key]:v}))} />
            </div>
          ))}
        </div>
        <div className="settings-card">
          <div className="settings-sec">
            <div className="settings-sec-icon"><Icon name="shield" size={17} color="var(--blue)" /></div>
            <span className="settings-sec-title">Security</span>
          </div>
          <div className="fgroup">
            <label className="flabel">Current password</label>
            <input className="finput" type="password" placeholder="Enter current password" />
          </div>
          <div className="fgroup">
            <label className="flabel">New password</label>
            <input className="finput" type="password" placeholder="Enter new password" />
          </div>
          <div className="fgroup" style={{marginBottom:20}}>
            <label className="flabel">Confirm new password</label>
            <input className="finput" type="password" placeholder="Confirm new password" />
          </div>
          <button className="btn btn-outline btn-sm" style={{width:"100%",justifyContent:"center"}}>
            <Icon name="key" size={13}/> Update password
          </button>
        </div>
        <div className="settings-card full-width">
          <div className="settings-sec">
            <div className="settings-sec-icon"><Icon name="database" size={17} color="var(--blue)" /></div>
            <span className="settings-sec-title">Storage &amp; Data</span>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:12,marginBottom:20}}>
            {[
              { label:"Images stored",  value:"1.4 GB", sub:"of 10 GB limit",     pct:14 },
              { label:"Products count", value:"12",     sub:"active products",     pct:0 },
              { label:"Last backup",    value:"Today",  sub:"auto-backup enabled", pct:0 },
            ].map(({label,value,sub,pct}) => (
              <div key={label} className="meta-card">
                <div className="meta-lbl">{label}</div>
                <div className="meta-val">{value}</div>
                <div style={{fontSize:11,color:"var(--t3)",marginTop:4}}>{sub}</div>
                {pct > 0 && <div className="storage-bar"><div className="storage-fill" style={{width:`${pct}%`}}/></div>}
              </div>
            ))}
          </div>
          <div className="danger-zone">
            <div className="danger-zone-title">
              <Icon name="warn" size={14} color="var(--red)" /> Danger Zone
            </div>
            {[
              { label:"Clear image cache", desc:"Remove all cached thumbnails (they will regenerate)", action:"Clear cache", danger:false },
              { label:"Export catalog",    desc:"Download all product data as JSON",                  action:"Export",      danger:false },
            ].map(({label,desc,action,danger}) => (
              <div className="danger-item" key={label}>
                <div><div className="danger-lbl">{label}</div><div className="danger-desc">{desc}</div></div>
                <button className={`btn btn-sm ${danger ? "btn-danger" : "btn-ghost"}`}>{action}</button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── App ───────────────────────────────────────────────────────────────────────
export default function App() {
  // ── FIX 1: Initialise from localStorage so login survives refresh ──
  const [loggedIn, setLoggedIn]   = useState(() => !!localStorage.getItem("sb_user"));
  const [userEmail, setUserEmail] = useState(() => localStorage.getItem("sb_user") || "");

  const [page, setPage]     = useState("list");
  const [activeSb, setActiveSb] = useState("products");
  const [sel, setSel]       = useState(null);
  const [toast, setToast]   = useState({ msg:"", type:"ok" });
  const [menuOpen, setMenu] = useState(false);

  const userNameRaw = userEmail ? userEmail.split("@")[0] : "Admin";
  const userName    = userNameRaw.charAt(0).toUpperCase() + userNameRaw.slice(1);
  const userInitial = userName[0].toUpperCase();

  if (!loggedIn) {
    return (
      <>
        <style dangerouslySetInnerHTML={{__html: CSS}}/>
        <LoginPage onLogin={email => {
          localStorage.setItem("sb_user", email);   // persist
          setUserEmail(email);
          setLoggedIn(true);
        }} />
      </>
    );
  }

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

  const handleNav = section => {
    if (section === "logout") {
      localStorage.removeItem("sb_user");   // clear persisted session
      setLoggedIn(false);
      setUserEmail("");
      setPage("list");
      setActiveSb("products");
      setMenu(false);
      return;
    }
    setActiveSb(section);
    setPage(section === "settings" ? "settings" : "list");
    setMenu(false);
  };

  return (
    <>
      <style dangerouslySetInnerHTML={{__html: CSS}}/>
      <div className="app" onClick={()=>menuOpen&&setMenu(false)}>
        <Sidebar
          open={menuOpen}
          activePage={activeSb}
          onNav={handleNav}
          userName={userName}
          userInitial={userInitial}
        />
        <div className="main">
          <div className="topbar">
            <button className="topbar-menu" onClick={e=>{e.stopPropagation();setMenu(o=>!o)}}>
              <Icon name="grid" size={22}/>
            </button>
            <img src={logoWithoutText} alt="Smart Basket" className="topbar-logo-img" />
            <span style={{fontSize:14,fontWeight:600}}>Smart Basket</span>
          </div>
          {page === "list" && (
            <ProductsList
              onAdd={()=>setPage("add")}
              onEdit={p=>{setSel(p);setPage("edit")}}
              onView={p=>{setSel(p);setPage("view")}}
            />
          )}
          {page === "add" && (
            <ProductForm mode="add" product={null} onBack={()=>setPage("list")} onSaved={saved}/>
          )}
          {page === "edit" && sel && (
            <ProductForm mode="edit" product={sel} onBack={()=>setPage("list")} onSaved={saved}/>
          )}
          {page === "view" && sel && (
            <ProductView product={sel} onBack={()=>setPage("list")} onEdit={()=>setPage("edit")}/>
          )}
          {page === "settings" && (
            <SettingsPage userEmail={userEmail} userName={userName} />
          )}
        </div>
        <Toast msg={toast.msg} type={toast.type}/>
      </div>
    </>
  );
}