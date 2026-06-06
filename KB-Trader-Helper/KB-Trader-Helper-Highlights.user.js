// ==UserScript==
// @name         KB's Trader Helper Highlights
// @namespace    https://greasyfork.org/scripts/kb-torn-under-sell-value
// @version      8.2.1
// @description  Highlights bazaar/market/shop items for trading profit. NPC shops buy/sell analysis, per-item rules, draggable HUD.
// @author       torn-local
// @match        https://www.torn.com/*
// @grant        GM_xmlhttpRequest
// @grant        GM_registerMenuCommand
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
// @connect      api.torn.com
// @run-at       document-idle
// @noframes
// @license      MIT
// @downloadURL https://update.greasyfork.org/scripts/568701/KB%27s%20Trader%20Helper%20Highlights.user.js
// @updateURL https://update.greasyfork.org/scripts/568701/KB%27s%20Trader%20Helper%20Highlights.meta.js
// ==/UserScript==

(function () {
  'use strict';

  // ═══════════════════════════════════════════════════════════════════════════
  //  CONSTANTS & CONFIG
  // ═══════════════════════════════════════════════════════════════════════════

  // PDA replaces the literal token in source before execution.
  // The comparison MUST use the literal string inline — not via an intermediate
  // variable — otherwise the variable just holds the unreplaced token and
  // isOnPDA is always false, causing getKey() to return '' on PDA.
  var pdaApiKey = '###PDA-APIKEY###';
  var isOnPDA   = (pdaApiKey !== '###PDA-APIKEY###');

  // Storage keys — unchanged from v6/v7 so existing installs keep data
  var CACHE_STORE    = 'torn_sv6_cache';
  var DESKKEY_STORE  = 'torn_sv6_key';
  var HUD_POS_STORE  = 'torn_sv6_hud_pos';
  var HUD_VIS_STORE  = 'torn_sv6_hud_vis';
  var SETTINGS_STORE = 'torn_sv6_settings';
  var RULES_STORE    = 'torn_sv6_rules';
  var CACHE_TTL      = 30 * 24 * 60 * 60 * 1000; // 30 days
  var SCAN_DELAY     = 400;

  var DEFAULT_SETTINGS = {
    hlSell:            true,   // global: highlight below NPC sell value
    hlMarket:          true,   // global: highlight below market value
    hlDeltaMarket:     false,  // global: highlight delta % below market
    deltaMarketThresh: 7,
    hlDeltaSell:       false,  // global: highlight delta % below NPC sell
    deltaSellThresh:   7,
    showBadges:        true,   // show badge pills on cards
    showDeltaMkt:      false,  // show $ delta vs market on badge
    showDeltaSell:     false,  // show $ delta vs NPC sell on badge
    showPctMkt:        false,  // show % vs market on badge
    showPctSell:       false,  // show % vs NPC sell on badge
    // Shop page settings
    shopBuyFlip:       true,   // buy section: market > NPC price (flip profit)
    shopBuyPct:        true,   // buy section: market > NPC price by X% (covers 5% tax)
    shopBuyPctThresh:  5,      // default 5% = item market listing tax
    shopSellWarn:      true,   // sell section: red warning if market > NPC buy value
    shopSellPct:       false,  // sell section: highlight within X% of market
    shopSellPctThresh: 10,
    showShopBadges:    true,   // show badges on shop page rows
    showShopGreen:     true,   // show green highlight when NPC >= market
    showShopHighlights: true    // master toggle: all shop page highlights
  };

  // Color definitions
  var COLORS = {
    green:  { bg: 'rgba(0,190,70,0.22)',   outline: 'rgba(0,190,70,0.9)',   badge: 'rgba(0,140,50,0.93)'   },
    yellow: { bg: 'rgba(230,190,0,0.18)',  outline: 'rgba(230,190,0,0.85)', badge: 'rgba(160,120,0,0.93)'  },
    blue:   { bg: 'rgba(30,130,255,0.2)',  outline: 'rgba(30,130,255,0.9)', badge: 'rgba(15,90,200,0.93)'  },
    orange: { bg: 'rgba(240,110,0,0.2)',   outline: 'rgba(240,110,0,0.9)',  badge: 'rgba(180,75,0,0.93)'   },
    purple: { bg: 'rgba(160,50,255,0.2)',  outline: 'rgba(160,50,255,0.9)', badge: 'rgba(110,25,200,0.93)' },
    red:    { bg: 'rgba(240,40,40,0.2)',   outline: 'rgba(240,40,40,0.9)',  badge: 'rgba(180,15,15,0.93)'  }
  };
  var COLOR_KEYS = ['green','blue','orange','purple','red','yellow'];

  // ═══════════════════════════════════════════════════════════════════════════
  //  STATE
  // ═══════════════════════════════════════════════════════════════════════════

  var itemData   = {};  // { "item name lower": { id, sell, market } }
  var itemById   = {};  // { "itemId": entry } — lookup by Torn item ID
  var ready      = false;
  var settings   = {};
  var itemRules  = {};  // { "itemId|name": [ {type,threshold,label,color}, ... ] }
  var hudVisible = true;
  var menuOpen   = false;
  var scanTimer  = null;
  var loading    = false; // prevents concurrent API calls

  // ═══════════════════════════════════════════════════════════════════════════
  //  STORAGE HELPERS
  // ═══════════════════════════════════════════════════════════════════════════

  function sGet(k) {
    try { var v = GM_getValue(k, null); if (v !== null) return v; } catch(e) {}
    try { return localStorage.getItem(k); } catch(e) {}
    return null;
  }
  function sSet(k, v) {
    try { GM_setValue(k, v); } catch(e) {}
    try { localStorage.setItem(k, v); } catch(e) {}
  }
  function sDel(k) {
    try { GM_deleteValue(k); } catch(e) {}
    try { localStorage.removeItem(k); } catch(e) {}
  }

  function loadSettings() {
    try {
      var saved = JSON.parse(sGet(SETTINGS_STORE) || 'null') || {};
      settings = {};
      for (var k in DEFAULT_SETTINGS) {
        settings[k] = (saved[k] !== undefined) ? saved[k] : DEFAULT_SETTINGS[k];
      }
    } catch(e) { settings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS)); }
  }
  function saveSettings() { sSet(SETTINGS_STORE, JSON.stringify(settings)); }

  function loadRules() {
    try { itemRules = JSON.parse(sGet(RULES_STORE) || '{}') || {}; }
    catch(e) { itemRules = {}; }
  }
  function saveRules() { sSet(RULES_STORE, JSON.stringify(itemRules)); }

  // ═══════════════════════════════════════════════════════════════════════════
  //  UTILITIES
  // ═══════════════════════════════════════════════════════════════════════════

  function parseMoney(t) {
    var n = parseInt((t || '').replace(/[^0-9]/g, ''), 10);
    return isNaN(n) ? NaN : n;
  }
  function fmt$(n) { return '$' + Math.round(Math.abs(n)).toLocaleString(); }
  function fmtDiff(listed, ref) {
    var parts = [];
    if (settings.showDelta) parts.push((listed < ref ? '-' : '+') + fmt$(ref - listed));
    if (settings.showPct && ref > 0) parts.push(Math.round(listed / ref * 100) + '%');
    return parts.length ? ' (' + parts.join(' ') + ')' : '';
  }

  function getKey() {
    if (isOnPDA) return pdaApiKey;
    return sGet(DESKKEY_STORE) || '';
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  STYLES
  // ═══════════════════════════════════════════════════════════════════════════

  function injectStyles() {
    if (document.getElementById('tsv6-style')) return;
    var target = document.head || document.documentElement;
    if (!target) return;
    var s = document.createElement('style');
    s.id = 'tsv6-style';

    var css = [];

    // Card highlight per color
    for (var c in COLORS) {
      css.push(
        '.tsv-hl-' + c + '{' +
        'background:' + COLORS[c].bg + ' !important;' +
        'outline:2px solid ' + COLORS[c].outline + ' !important;' +
        'border-radius:4px !important;' +
        '}'
      );
    }

    // Badge wrapper — positioned relative to card, stacks vertically
    css.push(
      '.tsv-badge-wrap{' +
      'position:absolute;bottom:2px;left:2px;' +
      'z-index:9000;pointer-events:none;' +
      'display:flex;flex-direction:column;gap:2px;' +
      'max-width:calc(100% - 4px);' +
      '}'
    );
    css.push(
      '.tsv-badge{' +
      'display:inline-block;padding:2px 5px;' +
      'border-radius:3px;font:bold 10px sans-serif;' +
      'color:#fff;white-space:nowrap;line-height:1.3;' +
      'overflow:hidden;text-overflow:ellipsis;' +
      '}'
    );
    for (var c2 in COLORS) {
      css.push('.tsv-badge-' + c2 + '{background:' + COLORS[c2].badge + ';}');
    }

    // Rule button — overlaid top-left of item image
    css.push(
      '.tsv-rule-btn{' +
      'position:absolute;top:2px;left:2px;z-index:9001;' +
      'width:20px;height:20px;border-radius:3px;' +
      'background:rgba(0,0,0,0.55);border:none;color:#ddd;' +
      'font:bold 12px sans-serif;cursor:pointer;' +
      'display:flex;align-items:center;justify-content:center;' +
      'opacity:0.45;transition:opacity 0.15s;padding:0;line-height:1;' +
      '}'
    );
    css.push('.tsv-rule-btn:hover,.tsv-rule-btn.tsv-has-rule{opacity:1;color:#fff;background:rgba(110,20,200,0.85);}');

    // Rule editor popup
    css.push(
      '#tsv-editor{' +
      'position:fixed;z-index:2147483646;' +
      'background:#18182c;color:#e0e0f0;' +
      'border:1px solid rgba(150,60,255,0.55);border-radius:9px;' +
      'padding:14px 14px 10px;width:270px;max-height:80vh;overflow-y:auto;' +
      'box-shadow:0 6px 24px rgba(0,0,0,0.8);font:13px sans-serif;' +
      '}'
    );
    css.push('#tsv-editor h3{margin:0 0 10px;font-size:12px;color:#aaa;font-weight:700;letter-spacing:0.5px;}');
    css.push('.tsv-rule-block{background:#22223a;border-radius:6px;padding:9px;margin-bottom:8px;position:relative;}');
    css.push('.tsv-rule-block-del{position:absolute;top:6px;right:6px;background:none;border:none;color:#f55;cursor:pointer;font-size:14px;line-height:1;padding:0;}');
    css.push('.tsv-lbl{display:block;margin:6px 0 2px;font-size:11px;color:#888;}');
    css.push(
      '#tsv-editor select,#tsv-editor input[type=number],#tsv-editor input[type=text]{' +
      'width:100%;box-sizing:border-box;background:#2a2a45;' +
      'border:1px solid #484870;color:#e0e0f0;' +
      'border-radius:4px;padding:4px 7px;font-size:12px;margin-bottom:2px;' +
      '}'
    );
    css.push('.tsv-swatch-row{display:flex;gap:5px;margin-top:4px;flex-wrap:wrap;}');
    css.push('.tsv-swatch{width:22px;height:22px;border-radius:4px;cursor:pointer;border:2px solid transparent;}');
    css.push('.tsv-swatch.sel{border-color:#fff;}');
    css.push('.tsv-ed-foot{display:flex;gap:6px;margin-top:10px;}');
    css.push('.tsv-ed-foot button{flex:1;padding:6px 4px;border-radius:5px;border:none;cursor:pointer;font:bold 11px sans-serif;}');
    css.push('.tsv-btn-add{background:#2a3a55;color:#8af;width:100%;margin-bottom:8px;padding:6px;border:none;border-radius:5px;cursor:pointer;font:bold 11px sans-serif;}');
    css.push('.tsv-btn-save{background:rgba(120,30,220,0.9);color:#fff;}');
    css.push('.tsv-btn-cancel{background:rgba(60,60,80,0.9);color:#ddd;}');

    // HUD
    css.push(
      '#tsv6-hud{' +
      'position:fixed;top:60px;right:12px;' +
      'background:rgba(0,0,0,0.82);color:#fff;' +
      'padding:8px 12px;border-radius:8px;' +
      'font:bold 12px sans-serif;z-index:2147483647;' +
      'cursor:grab;user-select:none;touch-action:none;' +
      'display:flex;align-items:center;gap:8px;' +
      'white-space:nowrap;box-shadow:0 2px 10px rgba(0,0,0,0.6);min-height:38px;' +
      '}'
    );
    css.push('#tsv6-hud.dragging{cursor:grabbing;opacity:0.85;}');
    css.push(
      '#tsv6-hud-btn{' +
      'background:rgba(255,255,255,0.15);border:none;color:#fff;' +
      'font:bold 11px sans-serif;border-radius:5px;' +
      'padding:4px 10px;cursor:pointer;line-height:1.5;' +
      'min-width:38px;min-height:30px;' +
      '}'
    );
    css.push('#tsv6-hud-btn:hover{background:rgba(255,255,255,0.28);}');
    css.push('#tsv6-hud-counts{font:bold 11px sans-serif;}');

    // HUD menu panel
    css.push(
      '#tsv-menu{' +
      'position:fixed;z-index:2147483646;' +
      'background:#18182c;color:#e0e0f0;' +
      'border:1px solid rgba(150,60,255,0.45);border-radius:9px;' +
      'padding:12px 14px;width:240px;max-height:80vh;overflow-y:auto;' +
      'box-shadow:0 6px 24px rgba(0,0,0,0.8);font:13px sans-serif;' +
      '}'
    );
    css.push('#tsv-menu h4{margin:8px 0 5px;font-size:11px;color:#888;font-weight:700;letter-spacing:0.5px;text-transform:uppercase;}');
    css.push('#tsv-menu h4:first-child{margin-top:0;}');
    css.push('.tsv-menu-row{display:flex;align-items:center;gap:8px;margin:5px 0;font-size:12px;}');
    css.push('.tsv-menu-row input[type=checkbox]{cursor:pointer;width:14px;height:14px;flex-shrink:0;}');
    css.push('.tsv-menu-row input[type=number]{width:55px;background:#2a2a45;border:1px solid #484870;color:#e0e0f0;border-radius:4px;padding:2px 5px;font-size:12px;}');
    css.push('.tsv-menu-row label{cursor:pointer;flex:1;}');
    css.push('.tsv-menu-sep{border:none;border-top:1px solid #333;margin:8px 0;}');
    css.push('.tsv-menu-rule-item{font-size:11px;padding:4px 0;display:flex;align-items:center;gap:5px;}');
    css.push('.tsv-menu-rule-item .tsv-rule-dot{width:8px;height:8px;border-radius:50%;flex-shrink:0;display:inline-block;}');
    css.push('.tsv-menu-rule-item .tsv-rule-info{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}');
    css.push('.tsv-menu-rule-del{background:none;border:none;color:#f55;cursor:pointer;font-size:13px;padding:0;line-height:1;flex-shrink:0;}');
    css.push('.tsv-menu-add-btn{width:100%;margin-top:6px;padding:5px;background:#2a3a55;border:none;color:#8af;border-radius:5px;cursor:pointer;font:bold 11px sans-serif;}');
    css.push('.tsv-page-items{max-height:130px;overflow-y:auto;margin-top:4px;}');
    css.push('.tsv-page-item-btn{display:block;width:100%;text-align:left;padding:4px 8px;margin:2px 0;background:#22223a;border:none;color:#cce;border-radius:4px;cursor:pointer;font-size:11px;}');
    css.push('.tsv-page-item-btn:hover{background:#2e2e4a;}');

    // Shop row highlights — applied to <tr> rows
    css.push('.tsv-shop-buy{background:rgba(0,190,70,0.15) !important;outline:2px solid rgba(0,190,70,0.7) !important;}');
    css.push('.tsv-shop-sell-warn{background:rgba(240,40,40,0.13) !important;outline:2px solid rgba(240,40,40,0.65) !important;}');
    css.push('.tsv-shop-sell-ok{background:rgba(0,190,70,0.13) !important;outline:2px solid rgba(0,190,70,0.6) !important;}');
    // Shop badge — inline next to item name
    css.push('.tsv-shop-badge{display:inline-block;margin-left:6px;padding:1px 6px;border-radius:3px;font:bold 10px sans-serif;color:#fff;vertical-align:middle;cursor:default;}');
    css.push('.tsv-shop-badge-green{background:rgba(0,140,50,0.9);}');
    css.push('.tsv-shop-badge-red{background:rgba(180,15,15,0.9);}');
    // Tooltip for truncated badges
    css.push('.tsv-badge[title]{pointer-events:auto;cursor:default;}');
    css.push('.tsv-badge:hover::after{content:attr(data-full);position:absolute;left:0;top:100%;margin-top:2px;background:#111;color:#eee;padding:3px 7px;border-radius:4px;font:11px sans-serif;white-space:pre-wrap;max-width:220px;z-index:99999;pointer-events:none;box-shadow:0 2px 8px rgba(0,0,0,0.7);}');
    css.push('.tsv-badge{position:relative;}');

    s.textContent = css.join('\n');
    target.appendChild(s);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  HUD
  // ═══════════════════════════════════════════════════════════════════════════

  function buildHud() {
    if (document.getElementById('tsv6-hud')) return;
    var body = document.body || document.documentElement;
    if (!body) return;

    var hud = document.createElement('div');
    hud.id = 'tsv6-hud';

    var btn = document.createElement('button');
    btn.id = 'tsv6-hud-btn';
    btn.textContent = 'TSV';
    btn.title = 'Open TSV settings';
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      toggleMenu();
    });

    var counts = document.createElement('span');
    counts.id = 'tsv6-hud-counts';

    hud.appendChild(btn);
    hud.appendChild(counts);
    body.appendChild(hud);

    // Restore saved position
    try {
      var pos = JSON.parse(sGet(HUD_POS_STORE) || 'null');
      if (pos && typeof pos.top === 'number' && typeof pos.left === 'number') {
        hud.style.top   = pos.top  + 'px';
        hud.style.left  = pos.left + 'px';
        hud.style.right = 'auto';
      }
    } catch(e) {}

    // Restore visibility preference
    if (sGet(HUD_VIS_STORE) === '0') hudVisible = false;

    makeDraggable(hud);
  }

  function updateHudCounts(counts) {
    var el = document.getElementById('tsv6-hud-counts');
    if (!el) return;

    if (!hudVisible) { el.textContent = ''; el.style.display = 'none'; return; }
    el.style.display = '';

    var total = 0;
    for (var c in counts) total += (counts[c] || 0);
    if (total === 0) { el.textContent = ''; return; }

    var parts = [];
    if (counts.green  > 0) parts.push('\u25CF' + counts.green);
    if (counts.yellow > 0) parts.push('\u25CB' + counts.yellow);
    if (counts.blue   > 0) parts.push('\u25CF' + counts.blue);
    if (counts.orange > 0) parts.push('\u25CF' + counts.orange);
    if (counts.purple > 0) parts.push('\u25CF' + counts.purple);
    if (counts.red    > 0) parts.push('\u25CF' + counts.red);
    el.textContent = parts.join(' ');
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  DRAGGABLE HUD (Pointer Events)
  // ═══════════════════════════════════════════════════════════════════════════

  function makeDraggable(el) {
    var sx, sy, sl, st, dragging = false;

    el.addEventListener('pointerdown', function (e) {
      if (e.target.id === 'tsv6-hud-btn') return;
      e.preventDefault();
      try { el.setPointerCapture(e.pointerId); } catch(ex) {}
      dragging = true;
      var r = el.getBoundingClientRect();
      sx = e.clientX; sy = e.clientY; sl = r.left; st = r.top;
      el.style.right  = 'auto';
      el.style.bottom = 'auto';
      el.style.top    = st + 'px';
      el.style.left   = sl + 'px';
      el.classList.add('dragging');
    });

    el.addEventListener('pointermove', function (e) {
      if (!dragging) return;
      e.preventDefault();
      var nl = Math.max(0, Math.min(window.innerWidth  - el.offsetWidth,  sl + e.clientX - sx));
      var nt = Math.max(0, Math.min(window.innerHeight - el.offsetHeight, st + e.clientY - sy));
      el.style.left = nl + 'px';
      el.style.top  = nt + 'px';
    });

    function stopDrag(e) {
      if (!dragging) return;
      dragging = false;
      el.classList.remove('dragging');
      try { el.releasePointerCapture(e.pointerId); } catch(ex) {}
      sSet(HUD_POS_STORE, JSON.stringify({
        left: parseInt(el.style.left, 10),
        top:  parseInt(el.style.top,  10)
      }));
    }
    el.addEventListener('pointerup',     stopDrag);
    el.addEventListener('pointercancel', stopDrag);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  HUD MENU PANEL
  // ═══════════════════════════════════════════════════════════════════════════


  // ═══════════════════════════════════════════════════════════════════════════
  //  SHOP PER-ITEM COLOR RULES
  // ═══════════════════════════════════════════════════════════════════════════

  var SHOP_COLORS = ['none', 'green', 'yellow', 'red'];
  var SHOP_COLOR_LABELS = { none: 'none', green: '✓ Green', yellow: '● Yellow', red: '⚠ Red' };
  var SHOP_COLOR_DOTS   = { green: 'rgba(0,190,70,0.9)', yellow: 'rgba(230,190,0,0.9)', red: 'rgba(240,40,40,0.9)', none: '#555' };

  function getShopItemColor(itemId) {
    var e = itemRules['shop_' + itemId];
    return (e && e.shopColor) ? e.shopColor : 'none';
  }

  function setShopItemColor(itemId, itemName, color) {
    if (color === 'none') {
      delete itemRules['shop_' + itemId];
    } else {
      itemRules['shop_' + itemId] = { shopColor: color, label: '', name: itemName };
    }
    saveRules();
    scanShop();
  }

  function renderShopItemRules(panel) {
    var existing = panel.querySelector('.tsv-shop-rules-list');
    if (existing) existing.remove();

    var list = document.createElement('div');
    list.className = 'tsv-shop-rules-list';

    // Collect items currently on page
    var rows = document.querySelectorAll('.sell-items-list > li[data-item]');
    if (!rows.length) {
      var msg = document.createElement('div');
      msg.style.cssText = 'font-size:11px;color:#555;padding:2px 0;';
      msg.textContent = 'No sell items found on page.';
      list.appendChild(msg);
      panel.appendChild(list);
      return;
    }

    for (var i = 0; i < rows.length; i++) {
      (function(row) {
        var itemId   = row.getAttribute('data-item') || '';
        var nameEl   = row.querySelector('span.name');
        var itemName = nameEl ? nameEl.textContent.trim() : itemId;
        var current  = getShopItemColor(itemId);

        var rrow = document.createElement('div');
        rrow.style.cssText = 'display:flex;align-items:center;gap:6px;padding:3px 0;font-size:11px;border-bottom:1px solid #222;';

        var nameLbl = document.createElement('span');
        nameLbl.textContent = itemName;
        nameLbl.style.cssText = 'flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#cce;';

        var cycleBtn = document.createElement('button');
        cycleBtn.style.cssText = 'padding:2px 8px;border-radius:4px;border:none;cursor:pointer;font:bold 10px sans-serif;color:#fff;min-width:60px;';
        cycleBtn._applyStyle = function(color) {
          cycleBtn.style.background = SHOP_COLOR_DOTS[color] || '#555';
          cycleBtn.textContent = SHOP_COLOR_LABELS[color] || color;
        };
        cycleBtn._applyStyle(current);

        cycleBtn.addEventListener('click', function(e) {
          e.stopPropagation();
          var cur = getShopItemColor(itemId);
          var idx = SHOP_COLORS.indexOf(cur);
          var next = SHOP_COLORS[(idx + 1) % SHOP_COLORS.length];
          setShopItemColor(itemId, itemName, next);
          cycleBtn._applyStyle(next);
        });

        rrow.appendChild(nameLbl);
        rrow.appendChild(cycleBtn);
        list.appendChild(rrow);
      })(rows[i]);
    }

    panel.appendChild(list);
  }

  function toggleMenu() {
    if (menuOpen) { closeMenu(); return; }
    openMenu();
  }

  function closeMenu() {
    var el = document.getElementById('tsv-menu');
    if (el) el.remove();
    menuOpen = false;
  }

  function openMenu() {
    closeMenu();
    menuOpen = true;

    var panel = document.createElement('div');
    panel.id = 'tsv-menu';
    positionNearHud(panel);

    // ── GLOBAL HIGHLIGHTS ──
    panel.appendChild(menuHeading('Global Highlights'));

    panel.appendChild(menuCheckRow('Below NPC sell value', 'hlSell', function(v) {
      settings.hlSell = v; saveSettings(); scan();
    }));
    panel.appendChild(menuCheckRow('Below market value', 'hlMarket', function(v) {
      settings.hlMarket = v; saveSettings(); scan();
    }));
    panel.appendChild(menuCheckNumberRow('Delta \u2265', '% below market', 'hlDeltaMarket', 'deltaMarketThresh', function(sv, nv) {
      settings.hlDeltaMarket = sv; settings.deltaMarketThresh = nv; saveSettings(); scan();
    }));
    panel.appendChild(menuCheckNumberRow('Delta \u2265', '% below sell', 'hlDeltaSell', 'deltaSellThresh', function(sv, nv) {
      settings.hlDeltaSell = sv; settings.deltaSellThresh = nv; saveSettings(); scan();
    }));

    panel.appendChild(menuSep());

    // ── BADGES ──
    panel.appendChild(menuHeading('Badge Display'));

    panel.appendChild(menuCheckRow('Show badge labels', 'showBadges', function(v) {
      settings.showBadges = v; saveSettings(); scan();
    }));
    panel.appendChild(menuCheckRow('Show \u0394 vs market on badge', 'showDeltaMkt', function(v) {
      settings.showDeltaMkt = v; saveSettings(); scan();
    }));
    panel.appendChild(menuCheckRow('Show \u0394 vs NPC sell on badge', 'showDeltaSell', function(v) {
      settings.showDeltaSell = v; saveSettings(); scan();
    }));
    panel.appendChild(menuCheckRow('Show % vs market on badge', 'showPctMkt', function(v) {
      settings.showPctMkt = v; saveSettings(); scan();
    }));
    panel.appendChild(menuCheckRow('Show % vs NPC sell on badge', 'showPctSell', function(v) {
      settings.showPctSell = v; saveSettings(); scan();
    }));

    panel.appendChild(menuSep());

    // ── SHOP HIGHLIGHTS (only shown on shops.php) ──
    if (window.location.href.indexOf('shops.php') !== -1) {
      panel.appendChild(menuCheckRow('\u26a1 Enable shop highlights', 'showShopHighlights', function(v) {
        settings.showShopHighlights = v; saveSettings(); scanShop();
      }));
      panel.appendChild(menuSep());
      panel.appendChild(menuHeading('Shop: Buy from NPC'));
      panel.appendChild(menuCheckRow('Market > NPC price (flip)', 'shopBuyFlip', function(v) {
        settings.shopBuyFlip = v; saveSettings(); scanShop();
      }));
      panel.appendChild(menuCheckNumberRow('Market > NPC price +', '% (tax cover)', 'shopBuyPct', 'shopBuyPctThresh', function(sv, nv) {
        settings.shopBuyPct = sv; settings.shopBuyPctThresh = nv; saveSettings(); scanShop();
      }));

      panel.appendChild(menuSep());
      panel.appendChild(menuHeading('Shop: Sell to NPC'));
      panel.appendChild(menuCheckRow('⚠ Red: market > NPC buy value', 'shopSellWarn', function(v) {
        settings.shopSellWarn = v; saveSettings(); scanShop();
      }));
      panel.appendChild(menuCheckNumberRow('● Yellow: within', '% of mkt', 'shopSellPct', 'shopSellPctThresh', function(sv, nv) {
        settings.shopSellPct = sv; settings.shopSellPctThresh = nv; saveSettings(); scanShop();
      }));
      var sellNote = document.createElement('div');
      sellNote.style.cssText = 'font-size:10px;color:#666;margin:2px 0 4px;line-height:1.4;';
      sellNote.textContent = '✓ Green auto: NPC ≥ market value';
      panel.appendChild(sellNote);
      panel.appendChild(menuSep());
      panel.appendChild(menuHeading('Shop: Per-Item Color'));
      var shopItemNote = document.createElement('div');
      shopItemNote.style.cssText = 'font-size:10px;color:#888;margin:0 0 4px;line-height:1.4;';
      shopItemNote.textContent = 'Override global color for a specific item. Click item to cycle: none → green → yellow → red';
      panel.appendChild(shopItemNote);
      renderShopItemRules(panel);
      panel.appendChild(menuSep());
      panel.appendChild(menuHeading('Shop: Badges'));
      panel.appendChild(menuCheckRow('Show badges on shop rows', 'showShopBadges', function(v) {
        settings.showShopBadges = v; saveSettings(); scanShop();
      }));
      panel.appendChild(menuCheckRow('✓ Show green (NPC ≥ market)', 'showShopGreen', function(v) {
        settings.showShopGreen = v; saveSettings(); scanShop();
      }));
      panel.appendChild(menuSep());
    }

    // ── ITEM RULES ──
    panel.appendChild(menuHeading('Item Rules'));
    renderMenuRules(panel);

    // Add rule from current page items
    var addBtn = document.createElement('button');
    addBtn.className = 'tsv-menu-add-btn';
    addBtn.textContent = '+ Add rule for item on page';
    var listEl = null;
    addBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      if (listEl) { listEl.remove(); listEl = null; return; }
      listEl = buildPageItemPicker(function(itemId, itemName) {
        listEl.remove(); listEl = null;
        closeMenu();
        openEditorForItem(itemId, itemName);
      });
      panel.appendChild(listEl);
    });
    panel.appendChild(addBtn);

    document.body.appendChild(panel);

    // Close on outside click
    setTimeout(function () {
      document.addEventListener('click', function outsideClick(e) {
        var p = document.getElementById('tsv-menu');
        var ed = document.getElementById('tsv-editor');
        if (p && !p.contains(e.target) && (!ed || !ed.contains(e.target))) {
          closeMenu();
          document.removeEventListener('click', outsideClick);
        }
      });
    }, 50);
  }

  function menuHeading(text) {
    var h = document.createElement('h4');
    h.textContent = text;
    return h;
  }
  function menuSep() {
    var hr = document.createElement('hr');
    hr.className = 'tsv-menu-sep';
    return hr;
  }

  function menuCheckRow(label, key, onChange) {
    var row = document.createElement('div');
    row.className = 'tsv-menu-row';
    var cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.id = 'tsvm-' + key;
    cb.checked = !!settings[key];
    cb.addEventListener('change', function () { onChange(cb.checked); });
    var lbl = document.createElement('label');
    lbl.setAttribute('for', 'tsvm-' + key);
    lbl.textContent = label;
    row.appendChild(cb);
    row.appendChild(lbl);
    return row;
  }

  function menuCheckNumberRow(prefix, suffix, boolKey, numKey, onChange) {
    var row = document.createElement('div');
    row.className = 'tsv-menu-row';
    var cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.id = 'tsvm-' + boolKey;
    cb.checked = !!settings[boolKey];
    var inp = document.createElement('input');
    inp.type = 'number';
    inp.min = '0'; inp.max = '100'; inp.step = '1';
    inp.value = settings[numKey] || 7;
    inp.style.width = '52px';
    var lbl = document.createElement('label');
    lbl.setAttribute('for', 'tsvm-' + boolKey);
    lbl.textContent = prefix;
    var suf = document.createElement('span');
    suf.textContent = suffix;
    suf.style.color = '#888';
    suf.style.fontSize = '11px';

    function fire() { onChange(cb.checked, parseFloat(inp.value) || 7); }
    cb.addEventListener('change', fire);
    inp.addEventListener('change', fire);
    inp.addEventListener('click', function(e) { e.stopPropagation(); });

    row.appendChild(cb);
    row.appendChild(lbl);
    row.appendChild(inp);
    row.appendChild(suf);
    return row;
  }

  function renderMenuRules(panel) {
    var existing = panel.querySelector('.tsv-rules-list');
    if (existing) existing.remove();
    var list = document.createElement('div');
    list.className = 'tsv-rules-list';

    var allRules = [];
    for (var id in itemRules) {
      var rules = itemRules[id];
      if (!rules || !rules.length) continue;
      for (var ri = 0; ri < rules.length; ri++) {
        allRules.push({ id: id, ri: ri, rule: rules[ri] });
      }
    }

    if (!allRules.length) {
      var empty = document.createElement('div');
      empty.style.cssText = 'font-size:11px;color:#666;padding:3px 0;';
      empty.textContent = 'No item rules yet.';
      list.appendChild(empty);
    }

    for (var ai = 0; ai < allRules.length; ai++) {
      (function(entry) {
        var row = document.createElement('div');
        row.className = 'tsv-menu-rule-item';

        var dot = document.createElement('span');
        dot.className = 'tsv-rule-dot';
        dot.style.background = COLORS[entry.rule.color] ? COLORS[entry.rule.color].outline : '#aaa';

        var info = document.createElement('span');
        info.className = 'tsv-rule-info';
        info.title = ruleDesc(entry.rule);
        info.textContent = (entry.rule.label || itemRules[entry.id].name || entry.id) + ' \u2014 ' + ruleDesc(entry.rule);

        var del = document.createElement('button');
        del.className = 'tsv-menu-rule-del';
        del.textContent = '\u2715';
        del.title = 'Delete rule';
        del.addEventListener('click', function(e) {
          e.stopPropagation();
          itemRules[entry.id].splice(entry.ri, 1);
          if (!itemRules[entry.id].length) delete itemRules[entry.id];
          saveRules();
          scan();
          // Re-render the rules section
          var panel2 = document.getElementById('tsv-menu');
          if (panel2) { renderMenuRules(panel2); }
        });

        row.appendChild(dot);
        row.appendChild(info);
        row.appendChild(del);
        list.appendChild(row);
      })(allRules[ai]);
    }

    panel.appendChild(list);
  }

  function buildPageItemPicker(onSelect) {
    var wrap = document.createElement('div');
    wrap.className = 'tsv-page-items';

    var seen = {};
    var imgs = document.querySelectorAll('img[src*="/images/items/"]');
    for (var i = 0; i < imgs.length; i++) {
      var img = imgs[i];
      var sm = (img.getAttribute('src') || '').match(/\/images\/items\/(\d+)\//);
      var iid = sm ? sm[1] : '';
      var nm  = (img.alt || '').trim();
      if (!nm || seen[iid || nm]) continue;
      seen[iid || nm] = true;

      (function(itemId, itemName) {
        var btn = document.createElement('button');
        btn.className = 'tsv-page-item-btn';
        btn.textContent = itemName;
        btn.addEventListener('click', function(e) {
          e.stopPropagation();
          onSelect(itemId, itemName);
        });
        wrap.appendChild(btn);
      })(iid, nm);
    }
    return wrap;
  }

  function positionNearHud(el) {
    var hud = document.getElementById('tsv6-hud');
    el.style.right = '12px';
    if (hud) {
      var hr = hud.getBoundingClientRect();
      // Place below or above depending on space
      var spaceBelow = window.innerHeight - hr.bottom - 20;
      if (spaceBelow > 200) {
        el.style.top  = (hr.bottom + 6) + 'px';
        el.style.bottom = 'auto';
      } else {
        el.style.bottom = (window.innerHeight - hr.top + 6) + 'px';
        el.style.top = 'auto';
      }
    } else {
      el.style.top = '110px';
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  PER-ITEM RULE EDITOR
  // ═══════════════════════════════════════════════════════════════════════════

  function closeEditor() {
    var el = document.getElementById('tsv-editor');
    if (el) el.remove();
  }

  function openEditorForItem(itemId, itemName) {
    closeEditor();

    var existing = itemRules[itemId] ? JSON.parse(JSON.stringify(itemRules[itemId])) : [];
    // Ensure it's an array (legacy single-rule migration)
    if (existing && !Array.isArray(existing)) existing = [existing];
    var draft = existing.length ? existing : [];

    var ed = document.createElement('div');
    ed.id = 'tsv-editor';

    var heading = document.createElement('h3');
    heading.textContent = 'Rules for: ' + itemName;
    ed.appendChild(heading);

    var rulesWrap = document.createElement('div');
    ed.appendChild(rulesWrap);

    function renderRules() {
      rulesWrap.innerHTML = '';
      if (!draft.length) {
        draft.push({ type: 'fixed', threshold: 0, label: '', color: 'purple' });
      }
      for (var ri = 0; ri < draft.length; ri++) {
        rulesWrap.appendChild(buildRuleBlock(draft, ri));
      }
    }

    function buildRuleBlock(draftArr, idx) {
      var rule = draftArr[idx];
      var block = document.createElement('div');
      block.className = 'tsv-rule-block';

      // Delete this rule block
      var delBtn = document.createElement('button');
      delBtn.className = 'tsv-rule-block-del';
      delBtn.textContent = '\u2715';
      delBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        draftArr.splice(idx, 1);
        renderRules();
      });
      block.appendChild(delBtn);

      // Type selector
      var typeLbl = document.createElement('span');
      typeLbl.className = 'tsv-lbl';
      typeLbl.textContent = 'Condition';
      block.appendChild(typeLbl);

      var typeEl = document.createElement('select');
      var typeOpts = [
        { v: 'fixed',       t: 'Fixed price \u2264 $' },
        { v: 'pctMarket',   t: '% of market value \u2264' },
        { v: 'pctSell',     t: '% of NPC sell \u2264' },
        { v: 'deltaMarket', t: 'Delta \u2265 % below market' },
        { v: 'deltaSell',   t: 'Delta \u2265 % below NPC sell' }
      ];
      for (var ti = 0; ti < typeOpts.length; ti++) {
        var opt = document.createElement('option');
        opt.value = typeOpts[ti].v;
        opt.textContent = typeOpts[ti].t;
        if (rule.type === typeOpts[ti].v) opt.selected = true;
        typeEl.appendChild(opt);
      }
      typeEl.addEventListener('change', function() { rule.type = typeEl.value; });
      typeEl.addEventListener('click', function(e) { e.stopPropagation(); });
      block.appendChild(typeEl);

      // Threshold
      var threshLbl = document.createElement('span');
      threshLbl.className = 'tsv-lbl';
      threshLbl.textContent = 'Value';
      block.appendChild(threshLbl);

      var threshEl = document.createElement('input');
      threshEl.type = 'number';
      threshEl.min = '0';
      threshEl.value = rule.threshold || 0;
      threshEl.addEventListener('input', function() { rule.threshold = parseFloat(threshEl.value) || 0; });
      threshEl.addEventListener('click', function(e) { e.stopPropagation(); });
      block.appendChild(threshEl);

      // Label
      var labelLbl = document.createElement('span');
      labelLbl.className = 'tsv-lbl';
      labelLbl.textContent = 'Badge label (optional)';
      block.appendChild(labelLbl);

      var labelEl = document.createElement('input');
      labelEl.type = 'text';
      labelEl.maxLength = 20;
      labelEl.placeholder = 'e.g. \uD83E\uDDE4 Deal';
      labelEl.value = rule.label || '';
      labelEl.addEventListener('input', function() { rule.label = labelEl.value; });
      labelEl.addEventListener('click', function(e) { e.stopPropagation(); });
      block.appendChild(labelEl);

      // Color swatches
      var colorLbl = document.createElement('span');
      colorLbl.className = 'tsv-lbl';
      colorLbl.textContent = 'Highlight color';
      block.appendChild(colorLbl);

      var swatchRow = document.createElement('div');
      swatchRow.className = 'tsv-swatch-row';
      for (var ci = 0; ci < COLOR_KEYS.length; ci++) {
        (function(ck) {
          var sw = document.createElement('div');
          sw.className = 'tsv-swatch' + (rule.color === ck ? ' sel' : '');
          sw.style.background = COLORS[ck].outline;
          sw.title = ck;
          sw.addEventListener('click', function(e) {
            e.stopPropagation();
            rule.color = ck;
            swatchRow.querySelectorAll('.tsv-swatch').forEach(function(s) { s.classList.remove('sel'); });
            sw.classList.add('sel');
          });
          swatchRow.appendChild(sw);
        })(COLOR_KEYS[ci]);
      }
      block.appendChild(swatchRow);
      return block;
    }

    renderRules();

    // Add another rule
    var addMoreBtn = document.createElement('button');
    addMoreBtn.className = 'tsv-btn-add';
    addMoreBtn.textContent = '+ Add another condition';
    addMoreBtn.addEventListener('click', function(e) {
      e.stopPropagation();
      draft.push({ type: 'fixed', threshold: 0, label: '', color: 'purple' });
      renderRules();
    });
    ed.appendChild(addMoreBtn);

    // Footer buttons
    var foot = document.createElement('div');
    foot.className = 'tsv-ed-foot';

    var saveBtn = document.createElement('button');
    saveBtn.className = 'tsv-btn-save';
    saveBtn.textContent = 'Save';
    saveBtn.addEventListener('click', function(e) {
      e.stopPropagation();
      if (draft.length) {
        itemRules[itemId] = { name: itemName, rules: draft };
      } else {
        delete itemRules[itemId];
      }
      saveRules();
      updateRuleButtons();
      scan();
      closeEditor();
    });

    var cancelBtn = document.createElement('button');
    cancelBtn.className = 'tsv-btn-cancel';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.addEventListener('click', function(e) {
      e.stopPropagation();
      closeEditor();
    });

    foot.appendChild(saveBtn);
    foot.appendChild(cancelBtn);
    ed.appendChild(foot);

    document.body.appendChild(ed);
    positionEditorNearCursor(ed);

    // Close on outside click
    setTimeout(function () {
      document.addEventListener('click', function edOutside(e) {
        var edEl = document.getElementById('tsv-editor');
        if (edEl && !edEl.contains(e.target)) {
          closeEditor();
          document.removeEventListener('click', edOutside);
        }
      });
    }, 50);
  }

  function positionEditorNearCursor(el) {
    // Center on screen as fallback; will be overridden if card position is known
    el.style.top  = '50%';
    el.style.left = '50%';
    el.style.transform = 'translate(-50%, -50%)';
  }

  function ruleDesc(rule) {
    if (rule.type === 'fixed')       return '\u2264 $' + (rule.threshold || 0).toLocaleString();
    if (rule.type === 'pctMarket')   return '\u2264 ' + rule.threshold + '% of mkt';
    if (rule.type === 'pctSell')     return '\u2264 ' + rule.threshold + '% of sell';
    if (rule.type === 'deltaMarket') return '\u0394\u2265' + rule.threshold + '% vs mkt';
    if (rule.type === 'deltaSell')   return '\u0394\u2265' + rule.threshold + '% vs sell';
    return '';
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  RULE BUTTON ON CARDS
  // ═══════════════════════════════════════════════════════════════════════════

  function ensureRuleBtn(card, itemId, itemName) {
    // NOTE: Do NOT set position:relative on card — on PDA it's a flex row and
    // forcing relative positioning breaks the layout. Only the imgParent needs it.

    // Find or create the image wrapper anchor
    var img = card.querySelector('img[src*="/images/items/"]');
    if (!img) return;
    var imgParent = img.parentElement;
    if (!imgParent) return;
    if (getComputedStyle(imgParent).position === 'static') {
      imgParent.style.position = 'relative';
    }

    if (imgParent.querySelector('.tsv-rule-btn')) return;

    var btn = document.createElement('button');
    btn.className = 'tsv-rule-btn' + (itemRules[itemId] ? ' tsv-has-rule' : '');
    btn.textContent = '\u2605'; // ★
    btn.title = 'Set highlight rule for ' + itemName;

    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      e.preventDefault();
      closeMenu();
      openEditorForItem(itemId, itemName);
    });

    // Mobile / PDA: also open editor on item name tap
    var nameEl = findNameEl(card, itemName);
    if (nameEl && !nameEl._tsvBound) {
      nameEl._tsvBound = true;
      nameEl.style.cursor = 'pointer';
      nameEl.addEventListener('click', function(e) {
        // Only intercept if it looks like a name element (not a buy button etc)
        e.stopPropagation();
        closeMenu();
        openEditorForItem(itemId, itemName);
      });
    }

    imgParent.appendChild(btn);
  }

  function findNameEl(card, name) {
    // Try to find the element showing the item name text
    var all = card.querySelectorAll('span, div, p, a, strong, b');
    var lower = name.toLowerCase();
    for (var i = 0; i < all.length; i++) {
      var el = all[i];
      if (!el.children.length && el.textContent.trim().toLowerCase() === lower) return el;
    }
    return null;
  }

  function updateRuleButtons() {
    document.querySelectorAll('.tsv-rule-btn').forEach(function(btn) {
      // Determine itemId from nearest img
      var imgP = btn.parentElement;
      if (!imgP) return;
      var img = imgP.querySelector('img[src*="/images/items/"]');
      if (!img) return;
      var sm = (img.getAttribute('src') || '').match(/\/images\/items\/(\d+)\//);
      var iid = sm ? sm[1] : (img.alt || '').toLowerCase();
      if (itemRules[iid]) btn.classList.add('tsv-has-rule');
      else btn.classList.remove('tsv-has-rule');
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  BADGE HELPERS
  // ═══════════════════════════════════════════════════════════════════════════

  function applyBadge(card, text, color) {
    if (!settings.showBadges) return;
    // Append badge wrap to imgParent (the image container), not the card root.
    // imgParent already has position:relative from ensureRuleBtn.
    // This avoids layout issues on PDA flex rows.
    var img = card.querySelector('img[src*="/images/items/"]');
    var badgeAnchor = (img && img.parentElement) ? img.parentElement : card;
    var wrap = badgeAnchor.querySelector('.tsv-badge-wrap');
    if (!wrap) {
      wrap = document.createElement('div');
      wrap.className = 'tsv-badge-wrap';
      badgeAnchor.appendChild(wrap);
    }
    var badge = document.createElement('span');
    badge.className = 'tsv-badge tsv-badge-' + color;
    badge.textContent = text;
    wrap.appendChild(badge);
  }

  function badgeText(label, listed, ref, refType) {
    // refType: 'mkt' | 'sell' | undefined (show both if either flag on)
    var t = label || '';
    var showD = (refType === 'mkt') ? settings.showDeltaMkt : (refType === 'sell') ? settings.showDeltaSell : (settings.showDeltaMkt || settings.showDeltaSell);
    var showP = (refType === 'mkt') ? settings.showPctMkt   : (refType === 'sell') ? settings.showPctSell   : (settings.showPctMkt   || settings.showPctSell);
    if (showD && ref > 0) {
      var diff = listed - ref;
      t += ' ' + (diff >= 0 ? '+' : '') + '$' + Math.abs(Math.round(diff)).toLocaleString();
    }
    if (showP && ref > 0) {
      t += ' ' + Math.round(listed / ref * 100) + '%';
    }
    return t.trim();
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  API / CACHE
  // ═══════════════════════════════════════════════════════════════════════════

  function httpGet(url, onOk, onFail) {
    if (isOnPDA && typeof PDA_httpGet === 'function') {
      PDA_httpGet(url, function(r) {
        if (r && r.status === 200) onOk(r.responseText);
        else onFail('status ' + (r ? r.status : '?'));
      });
    } else {
      GM_xmlhttpRequest({
        method: 'GET', url: url,
        onload:  function(r) { onOk(r.responseText); },
        onerror: function()  { onFail('network error'); }
      });
    }
  }

  function load() {
    // Check cache first — this is the primary API-call throttle
    try {
      var raw = sGet(CACHE_STORE);
      var c = JSON.parse(raw || 'null');
      if (c && c.t && c.d && (Date.now() - c.t < CACHE_TTL)) {
        // Detect old v7 cache format where values were plain numbers, not objects.
        // If so, discard it and re-fetch so we get the proper { sell, market } objects.
        var sampleKey = Object.keys(c.d)[0];
        if (sampleKey && typeof c.d[sampleKey] === 'number') {
          sDel(CACHE_STORE); // wipe old format, fall through to fresh fetch
        } else {
          itemData = c.d;
          itemById = {};
          for (var _n in itemData) { var _e = itemData[_n]; if (_e && _e.id) itemById[String(_e.id)] = _e; }
          ready = true;
          return Promise.resolve();
        }
      }
    } catch(e) {}

    // Prevent concurrent fetches
    if (loading) return Promise.resolve();

    // Get key first — on PDA it comes from token replacement, on desktop from storage
    var key = getKey();
    if (!key) {
      if (!isOnPDA && !sGet(DESKKEY_STORE)) {
        var k = prompt('Torn PUBLIC API key (one-time setup):');
        if (k && k.trim()) { sSet(DESKKEY_STORE, k.trim()); key = k.trim(); }
      }
      if (!key) return Promise.resolve(); // no key — do not set loading=true
    }

    loading = true; // set AFTER key confirmed so it can never get permanently stuck

    var countEl = document.getElementById('tsv6-hud-counts');
    if (countEl) countEl.textContent = 'loading\u2026';

    var url = 'https://api.torn.com/torn/?selections=items&key=' + encodeURIComponent(key);
    return new Promise(function(resolve) {
      httpGet(url,
        function(text) {
          try {
            var json = JSON.parse(text);
            if (json.error) {
              var e1 = document.getElementById('tsv6-hud-counts');
              if (e1) e1.textContent = 'API err ' + json.error.code;
              loading = false;
              return resolve();
            }
            itemData = {};
            for (var id in json.items) {
              var item = json.items[id];
              var nm   = (item.name || '').trim().toLowerCase();
              // Try every known field name Torn has used across API versions
              var sell = Number(item.sell_price)  ||
                         Number(item.sellPrice)   ||
                         Number(item.sell_value)  ||
                         Number(item.sell)        || 0;
              var mkt  = Number(item.market_value)  ||
                         Number(item.marketValue)   ||
                         Number(item.market_price)  ||
                         Number(item.market)        || 0;
              if (nm && (sell || mkt)) {
                var ent = { id: Number(id), sell: sell, market: mkt };
                itemData[nm] = ent;
                itemById[id]  = ent;
              }
            }
            sSet(CACHE_STORE, JSON.stringify({ t: Date.now(), d: itemData }));
            ready = true;
            loading = false;
            resolve();
          } catch(e) {
            var e2 = document.getElementById('tsv6-hud-counts');
            if (e2) e2.textContent = 'parse err';
            loading = false;
            resolve();
          }
        },
        function() {
          var e3 = document.getElementById('tsv6-hud-counts');
          if (e3) e3.textContent = 'net err';
          loading = false;
          resolve();
        }
      );
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  DESKTOP TAMPERMONKEY MENU
  // ═══════════════════════════════════════════════════════════════════════════

  if (!isOnPDA) {
    try {
      GM_registerMenuCommand('TSV: Set API key', function() {
        var k = prompt('Torn PUBLIC API key:', getKey());
        if (!k || !k.trim()) return;
        sSet(DESKKEY_STORE, k.trim()); sDel(CACHE_STORE); ready = false; load().then(scan);
      });
      GM_registerMenuCommand('TSV: Clear cache + re-fetch', function() {
        sDel(CACHE_STORE); ready = false; load().then(scan);
      });
    } catch(e) {}
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  SCAN
  // ═══════════════════════════════════════════════════════════════════════════

  function isLocked(card) {
    return !!(
      card.querySelector('[class*="lock"]')     ||
      card.querySelector('[class*="disabled"]') ||
      card.querySelector('[class*="locked"]')
    );
  }

  // Extract the delta% Torn already renders on cards (e.g. "↓6%" or "↑10%").
  // Returns a signed number: negative means listed is below reference (good for buyers),
  // positive means above. Returns NaN if not found.
  // Used as fallback when API market_value is 0.
  function extractDomDeltaPct(card) {
    // Torn renders delta as text like "↓6%" or "↑22%" or "▼6%" — find it
    var text = card.innerText || '';
    var m = text.match(/[↓▼⬇↓v]\s*(\d+(?:\.\d+)?)%/i);
    if (m) return -parseFloat(m[1]); // negative = below market
    var m2 = text.match(/[↑▲⬆↑\^]\s*(\d+(?:\.\d+)?)%/i);
    if (m2) return parseFloat(m2[1]); // positive = above market
    // Also try plain arrow text that PDA uses
    var m3 = text.match(/↓(\d+)%/);
    if (m3) return -parseFloat(m3[1]);
    var m4 = text.match(/↑(\d+)%/);
    if (m4) return parseFloat(m4[1]);
    return NaN;
  }

  // Derive an implied market value from listed price + DOM delta%.
  // If listed=$12,578 and DOM shows ↑10%, then market = listed / 1.10
  function impliedMarket(listed, domDeltaPct) {
    if (isNaN(domDeltaPct)) return 0;
    // domDeltaPct is signed: -10 means listed is 10% below market
    // listed = market * (1 + domDeltaPct/100)  =>  market = listed / (1 + domDeltaPct/100)
    var factor = 1 + domDeltaPct / 100;
    if (factor <= 0) return 0;
    return Math.round(listed / factor);
  }


  // ═══════════════════════════════════════════════════════════════════════════
  //  SHOP PAGE SCAN (shops.php)
  // ═══════════════════════════════════════════════════════════════════════════

  function parseMoney2(t) {
    var n = parseInt((t || '').replace(/[^0-9]/g, ''), 10);
    return isNaN(n) ? 0 : n;
  }

  function shopBadge(row, text, colorClass) {
    row.querySelectorAll('.tsv-shop-badge').forEach(function(b) { b.remove(); });
    if (!text || !settings.showShopBadges) return;
    var anchor = row.querySelector('li.desc') || row;
    var badge = document.createElement('span');
    badge.className = 'tsv-shop-badge tsv-shop-badge-' + colorClass;
    badge.textContent = text;
    anchor.appendChild(badge);
  }

  function scanShop() {
    if (!ready) return;

    // Clear previous shop highlights
    document.querySelectorAll('.tsv-shop-buy,.tsv-shop-sell-warn,.tsv-shop-sell-ok').forEach(function(el) {
      el.classList.remove('tsv-shop-buy', 'tsv-shop-sell-warn', 'tsv-shop-sell-ok');
    });
    document.querySelectorAll('.tsv-shop-badge,.tsv-badge-wrap').forEach(function(b) { b.remove(); });

    var url = window.location.href;
    if (url.indexOf('shops.php') === -1) return;

    // ── BUY SECTION ──────────────────────────────────────────────────────────
    if (!settings.showShopHighlights) return; // master toggle off
    // Each buy card is a grid cell. We use a Set to process each card ONCE.
    var seenCards = [];
    var buyImgs = document.querySelectorAll('img[src*="/images/items/"]');
    for (var bi = 0; bi < buyImgs.length; bi++) {
      var img = buyImgs[bi];

      // Skip images inside the sell table
      var inTable = false;
      var p = img.parentElement;
      while (p) { if (p.tagName === 'TR' || p.tagName === 'TBODY' || p.tagName === 'TABLE') { inTable = true; break; } p = p.parentElement; }
      if (inTable) continue;

      // Walk up to card container (has a $ price within 5 levels)
      var card = img.parentElement, found = false;
      for (var j = 0; j < 5; j++) {
        if (!card) break;
        if (/\$[\d,]+/.test(card.innerText || '')) { found = true; break; }
        card = card.parentElement;
      }
      if (!found || !card) continue;

      // Skip already-processed cards
      var alreadySeen = false;
      for (var si = 0; si < seenCards.length; si++) { if (seenCards[si] === card) { alreadySeen = true; break; } }
      if (alreadySeen) continue;
      seenCards.push(card);

      // NPC price = first $ amount in card
      var pm = (card.innerText || '').match(/\$([\d,]+)/);
      if (!pm) continue;
      var npcPrice = parseMoney2(pm[1]);
      if (!npcPrice || npcPrice <= 1) continue;

      var sm    = (img.getAttribute('src') || '').match(/\/images\/items\/(\d+)\//);
      var imgId = sm ? sm[1] : '';
      var name  = (img.alt || '').trim().toLowerCase();
      var data  = (imgId && itemById[imgId]) ? itemById[imgId] : (itemData[name] || {});
      var mkt   = data.market || 0;
      if (!mkt) continue;

      var profit      = mkt - npcPrice;
      var profitPct   = npcPrice > 0 ? (profit / npcPrice * 100) : 0;
      var taxedProfit = mkt * 0.95 - npcPrice;

      var hit = false;
      if (settings.shopBuyFlip && mkt > npcPrice) hit = true;
      if (settings.shopBuyPct  && profitPct >= settings.shopBuyPctThresh) hit = true;

      if (hit && taxedProfit > 0) {
        card.classList.add('tsv-shop-buy');
        var imgP = img.parentElement;
        if (imgP && getComputedStyle(imgP).position === 'static') imgP.style.position = 'relative';
        if (imgP && !imgP.querySelector('.tsv-badge-wrap')) {
          var wrap = document.createElement('div');
          wrap.className = 'tsv-badge-wrap';
          var b = document.createElement('span');
          b.className = 'tsv-badge tsv-badge-green';
          b.textContent = '+$' + Math.round(taxedProfit).toLocaleString() + ' (' + Math.round(profitPct) + '%)';
          wrap.appendChild(b);
          imgP.appendChild(wrap);
        }
      }
    }

    // ── SELL SECTION ─────────────────────────────────────────────────────────
    if (!settings.showShopHighlights) return; // master toggle off
    // Real DOM: .sell-items-list > li[data-item="ID"]
    //   li.value  → NPC buy price (plain text, e.g. "$3,100")
    //   li.desc span.name → item name
    //   data-item attr → Torn item ID (matches itemById keys)
    var sellRows = document.querySelectorAll('.sell-items-list > li[data-item]');
    for (var ri = 0; ri < sellRows.length; ri++) {
      var row = sellRows[ri];
      var itemId2 = row.getAttribute('data-item') || '';

      // NPC buy price — li.value is always a plain "$X,XXX" text node
      var valueLi = row.querySelector('li.value');
      if (!valueLi) continue;
      var npcBuyVal = parseMoney2(valueLi.textContent || '');
      if (!npcBuyVal) continue;

      // Market data
      var nameEl2 = row.querySelector('span.name');
      var name2   = nameEl2 ? nameEl2.textContent.trim().toLowerCase() : '';
      var data2   = (itemId2 && itemById[itemId2]) ? itemById[itemId2]
                  : (name2 && itemData[name2]) ? itemData[name2] : {};
      var mkt2 = data2.market || 0;

      // Per-item shop color override (green/yellow/red/none)
      var shopRuleKey   = 'shop_' + itemId2;
      var shopRuleEntry = itemRules[shopRuleKey];
      if (shopRuleEntry && shopRuleEntry.shopColor) {
        if (shopRuleEntry.shopColor !== 'none') {
          row.classList.add('tsv-shop-sell-' + shopRuleEntry.shopColor);
          shopBadge(row, shopRuleEntry.label || '', shopRuleEntry.shopColor);
        }
        continue;
      }

      // 🟢 Green: NPC pays at or above market — great, sell here
      if (settings.showShopGreen && mkt2 > 0 && npcBuyVal >= mkt2) {
        row.classList.add('tsv-shop-sell-ok');
        var bonus    = npcBuyVal - mkt2;
        var bonusPct = Math.round((npcBuyVal / mkt2) * 100);
        shopBadge(row, '\u2713 $' + bonus.toLocaleString() + ' > mkt (' + bonusPct + '%)', 'green');

      // 🔴 Red: market clearly beats NPC — warn, better to list
      } else if (settings.shopSellWarn && mkt2 > 0 && mkt2 > npcBuyVal) {
        row.classList.add('tsv-shop-sell-warn');
        var missed    = mkt2 * 0.95 - npcBuyVal;
        var missedPct = Math.round((missed / npcBuyVal) * 100);
        shopBadge(row, '\u26a0 +$' + Math.round(missed).toLocaleString() + ' (' + missedPct + '%) on mkt', 'red');

      // 🟡 Yellow: NPC pays within X% of market — decent deal
      } else if (settings.shopSellPct && mkt2 > 0) {
        var pctOfMkt = npcBuyVal / mkt2 * 100;
        if (pctOfMkt >= (100 - settings.shopSellPctThresh)) {
          row.classList.add('tsv-shop-sell-yellow');
          shopBadge(row, Math.round(pctOfMkt) + '% of mkt', 'yellow');
        }
      }
    }
  }

  function scan() {
    if (!ready) return;
    if (window.location.href.indexOf('shops.php') !== -1) return; // shop page uses scanShop()

    // Clear previous highlights and badges
    var COLOR_NAMES = ['green','yellow','blue','orange','purple','red'];
    var toRemove = [];
    for (var ci = 0; ci < COLOR_NAMES.length; ci++) {
      var els = document.querySelectorAll('.tsv-hl-' + COLOR_NAMES[ci]);
      for (var ei = 0; ei < els.length; ei++) toRemove.push({ el: els[ei], c: COLOR_NAMES[ci] });
    }
    for (var ri = 0; ri < toRemove.length; ri++) {
      toRemove[ri].el.classList.remove('tsv-hl-' + toRemove[ri].c);
    }
    document.querySelectorAll('.tsv-badge-wrap').forEach(function(el) { el.remove(); });

    var imgs   = document.querySelectorAll('img[src*="/images/items/"]');
    var counts = { green:0, yellow:0, blue:0, orange:0, purple:0, red:0 };

    for (var i = 0; i < imgs.length; i++) {
      var img = imgs[i];

      // Item ID from image URL
      var sm    = (img.getAttribute('src') || '').match(/\/images\/items\/(\d+)\//);
      var imgId = sm ? sm[1] : '';

      // Find card container
      var card = img.parentElement, found = false;
      for (var j = 0; j < 6; j++) {
        if (!card) break;
        if (/\$[\d,]+/.test(card.innerText || '')) { found = true; break; }
        card = card.parentElement;
      }
      if (!found || !card || isLocked(card)) continue;

      // Listed price
      var pm = (card.innerText || '').match(/\$([\d,]+)/);
      if (!pm) continue;
      var listed = parseMoney(pm[1]);
      if (!listed || isNaN(listed) || listed <= 1) continue;

      // Item name
      var name = (img.alt || '').trim().toLowerCase();
      if (!name) {
        var lines = (card.innerText || '').split('\n');
        for (var ln = 0; ln < lines.length; ln++) {
          var line = lines[ln].trim();
          if (line && !/^\$|^\(|^\d/.test(line)) { name = line.toLowerCase(); break; }
        }
      }
      if (!name) continue;

      // ID lookup is more reliable than name on PDA (img.alt may differ)
      var data   = (imgId && itemById[imgId]) ? itemById[imgId] : (itemData[name] || {});
      var sell   = data.sell   || 0;
      var market = data.market || 0;
      // Key rules by Torn's canonical item ID from the API (most stable).
      // Falls back to image URL ID, then item name — in that order.
      var ruleId = (data.id ? String(data.id) : '') || imgId || name;

      // If API gave us no market value, derive it from Torn's rendered delta%
      // This is the primary fix for PDA where market_value is often 0 in the API response
      if (!market && listed > 1) {
        var domDelta = extractDomDeltaPct(card);
        if (!isNaN(domDelta)) {
          market = impliedMarket(listed, domDelta);
        }
      }

      // Ensure rule button on every card
      ensureRuleBtn(card, ruleId, img.alt || name);

      // ── Item rules (override all globals) ─────────────────────────────────
      var entry = itemRules[ruleId];
      if (entry) {
        var rules = entry.rules || [];
        for (var ri = 0; ri < rules.length; ri++) {
          var rule = rules[ri];
          var hit  = false, ref = 0;

          if (rule.type === 'fixed' && listed <= rule.threshold) {
            hit = true; ref = rule.threshold;
          } else if (rule.type === 'pctMarket' && market > 0 && listed <= (rule.threshold / 100) * market) {
            hit = true; ref = market;
          } else if (rule.type === 'pctSell' && sell > 0 && listed <= (rule.threshold / 100) * sell) {
            hit = true; ref = sell;
          } else if (rule.type === 'deltaMarket' && market > 0 && ((market - listed) / market * 100) >= rule.threshold) {
            hit = true; ref = market;
          } else if (rule.type === 'deltaSell' && sell > 0 && ((sell - listed) / sell * 100) >= rule.threshold) {
            hit = true; ref = sell;
          }

          if (hit) {
            var rc = rule.color || 'purple';
            card.classList.add('tsv-hl-' + rc);
            counts[rc] = (counts[rc] || 0) + 1;
            applyBadge(card, badgeText(rule.label || ruleDesc(rule), listed, ref), rc);
          }
        }
        continue; // item has rules → skip globals for this card
      }

      // ── Global: delta % below market ──────────────────────────────────────
      if (settings.hlDeltaMarket && market > 0) {
        var dpMkt = (market - listed) / market * 100;
        if (dpMkt >= settings.deltaMarketThresh) {
          card.classList.add('tsv-hl-orange');
          counts.orange++;
          applyBadge(card, badgeText('\u0394' + settings.deltaMarketThresh + '%mkt', listed, market, 'mkt'), 'orange');
          continue;
        }
      }

      // ── Global: delta % below NPC sell ────────────────────────────────────
      if (settings.hlDeltaSell && sell > 0) {
        var dpSell = (sell - listed) / sell * 100;
        if (dpSell >= settings.deltaSellThresh) {
          card.classList.add('tsv-hl-orange');
          counts.orange++;
          applyBadge(card, badgeText('\u0394' + settings.deltaSellThresh + '%sell', listed, sell, 'sell'), 'orange');
          continue;
        }
      }

      // ── Global: below market value ────────────────────────────────────────
      if (settings.hlMarket && market > 0 && listed < market) {
        card.classList.add('tsv-hl-blue');
        counts.blue++;
        applyBadge(card, badgeText('MKT', listed, market, 'mkt'), 'blue');
        continue;
      }

      // ── Global: below / at NPC sell value ─────────────────────────────────
      if (settings.hlSell && sell > 0) {
        if (listed < sell) {
          card.classList.add('tsv-hl-green');
          counts.green++;
          applyBadge(card, badgeText('SELL', listed, sell, 'sell'), 'green');
        } else if (listed === sell) {
          card.classList.add('tsv-hl-yellow');
          counts.yellow++;
          applyBadge(card, badgeText('=SELL', listed, sell, 'sell'), 'yellow');
        }
      }
    }

    updateHudCounts(counts);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  OBSERVER + BOOT
  // ═══════════════════════════════════════════════════════════════════════════

  function triggerScan() {
    clearTimeout(scanTimer);
    var fn = (window.location.href.indexOf('shops.php') !== -1) ? scanShop : scan;
    scanTimer = setTimeout(fn, SCAN_DELAY);
  }

  var observer = new MutationObserver(function(mutations) {
    for (var m = 0; m < mutations.length; m++) {
      if (mutations[m].addedNodes.length || mutations[m].removedNodes.length) {
        triggerScan(); return;
      }
    }
  });

  function boot() {
    // Don't run on inventory or crimes pages
    var _href = window.location.href;
    if (_href.indexOf('/item.php') !== -1) return;
    if (_href.indexOf('sid=crimes') !== -1) return;

    loadSettings();
    loadRules();
    injectStyles();
    buildHud();
    observer.observe(document.documentElement, { childList: true, subtree: true });

    var isShop = window.location.href.indexOf('shops.php') !== -1;
    load().then(isShop ? scanShop : scan);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

})();