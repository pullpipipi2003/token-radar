(function () {
  'use strict';
  var R = window.RADAR;
  var $ = function (id) { return document.getElementById(id); };
  var state = { view: 'radar', tier: 'all', q: '', cat: 'all', chain: 'all', sort: 'implied_desc' };

  function usd(n) {
    if (n === null || n === undefined) return '--';
    var a = Math.abs(n);
    if (a >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (a >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (a >= 1e3) return '$' + (n / 1e3).toFixed(0) + 'K';
    return '$' + n.toFixed(0);
  }
  function esc(s) {
    return String(s === null || s === undefined ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  function pct(n) {
    if (n === null || n === undefined) return '<span class="neutral-chg">n/a</span>';
    var cls = n > 0 ? 'pos-chg' : n < 0 ? 'neg-chg' : 'neutral-chg';
    return '<span class="' + cls + '">' + (n > 0 ? '+' : '') + n.toFixed(1) + '%</span>';
  }
  function age(d) {
    if (d === null || d === undefined) return 'n/a';
    return d >= 365 ? (d / 365).toFixed(1) + 'y' : d + 'd';
  }
  function roi(r) { return r.airdrop_pool_usd / (r.capital_usd * 1000); }

  function init() {
    $('model-version').textContent = R.model_version;
    $('meta-asof').textContent = R.as_of;
    $('meta-floor').textContent = usd(R.floor_usd);
    $('meta-coverage').textContent = R.watchlist_size + '/' + R.watchlist_size;
    $('kpi-count').textContent = R.board_size;
    $('kpi-count-sub').textContent = R.watchlist_size + ' watchlist + ' + R.early_size + ' early discovery';
    $('kpi-tvl').textContent = usd(R.total_pretoken_tvl_usd);
    $('kpi-fdv').textContent = usd(R.total_implied_fdv_usd);
    $('kpi-airdrop').textContent = usd(R.total_airdrop_pool_usd);

    var cats = {}, chains = {};
    R.rows.forEach(function (r) {
      cats[r.category || 'Uncategorized'] = 1;
      r.chains.forEach(function (c) { chains[c] = 1; });
    });
    fill('category-select', Object.keys(cats).sort());
    fill('chain-select', Object.keys(chains).sort());

    document.querySelectorAll('.tab-btn').forEach(function (b) {
      b.addEventListener('click', function () {
        state.view = b.dataset.view;
        document.querySelectorAll('.tab-btn').forEach(function (x) { x.classList.toggle('active', x === b); });
        $('radar-view').classList.toggle('hidden', state.view !== 'radar');
        $('live-view').classList.toggle('hidden', state.view !== 'live');
        $('radar-filters').classList.toggle('hidden', state.view !== 'radar');
        $('results-bar').classList.toggle('hidden', state.view !== 'radar');
      });
    });
    document.querySelectorAll('.pill').forEach(function (p) {
      p.addEventListener('click', function () {
        state.tier = p.dataset.tier;
        document.querySelectorAll('.pill').forEach(function (x) { x.classList.toggle('active', x === p); });
        render();
      });
    });
    $('search-input').addEventListener('input', function (e) { state.q = e.target.value.toLowerCase(); render(); });
    $('category-select').addEventListener('change', function (e) { state.cat = e.target.value; render(); });
    $('chain-select').addEventListener('change', function (e) { state.chain = e.target.value; render(); });
    $('sort-select').addEventListener('change', function (e) { state.sort = e.target.value; render(); });
    $('reset-btn').addEventListener('click', function () {
      state = { view: 'radar', tier: 'all', q: '', cat: 'all', chain: 'all', sort: 'implied_desc' };
      $('search-input').value = '';
      $('category-select').value = 'all';
      $('chain-select').value = 'all';
      $('sort-select').value = 'implied_desc';
      document.querySelectorAll('.pill').forEach(function (x) { x.classList.toggle('active', x.dataset.tier === 'all'); });
      render();
    });
    $('modal-close').addEventListener('click', closeModal);
    $('detail-modal').addEventListener('click', function (e) { if (e.target === $('detail-modal')) closeModal(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeModal(); });

    renderLive();
    render();
    var hash = decodeURIComponent(location.hash.replace('#', ''));
    if (hash.indexOf('=') > 0) {
      // deep link: #tier=A-Tier&cat=Lending&chain=Ethereum&sort=growth_desc&q=text
      hash.split('&').forEach(function (kv) {
        var p = kv.split('=');
        if (p[0] === 'tier') { state.tier = p[1]; document.querySelectorAll('.pill').forEach(function (x) { x.classList.toggle('active', x.dataset.tier === p[1]); }); }
        if (p[0] === 'cat') { state.cat = p[1]; $('category-select').value = p[1]; }
        if (p[0] === 'chain') { state.chain = p[1]; $('chain-select').value = p[1]; }
        if (p[0] === 'sort') { state.sort = p[1]; $('sort-select').value = p[1]; }
        if (p[0] === 'q') { state.q = p[1].toLowerCase(); $('search-input').value = p[1]; }
      });
      render();
    } else if (hash) {
      var row = R.rows.find(function (r) { return r.slug === hash; });
      if (row) openModal(row);
    }
  }

  function fill(id, items) {
    var sel = $(id);
    items.forEach(function (v) {
      var o = document.createElement('option');
      o.value = v; o.textContent = v;
      sel.appendChild(o);
    });
  }

  function filtered() {
    var out = R.rows.filter(function (r) {
      if (state.tier === 'watchlist' && !r.is_watchlist) return false;
      if (state.tier !== 'all' && state.tier !== 'watchlist' && r.tier !== state.tier) return false;
      if (state.cat !== 'all' && (r.category || 'Uncategorized') !== state.cat) return false;
      if (state.chain !== 'all' && r.chains.indexOf(state.chain) < 0) return false;
      if (state.q) {
        var hay = (r.name + ' ' + r.slug + ' ' + (r.category || '') + ' ' + r.chains.join(' ')).toLowerCase();
        if (hay.indexOf(state.q) < 0) return false;
      }
      return true;
    });
    var s = state.sort;
    out.sort(function (a, b) {
      if (s === 'tvl_desc') return b.tvl_usd - a.tvl_usd;
      if (s === 'growth_desc') return (b.change_7d || -999) - (a.change_7d || -999);
      if (s === 'age_desc') return (b.age_days || 0) - (a.age_days || 0);
      if (s === 'efficiency_desc') return roi(b) - roi(a);
      return b.implied_value_usd - a.implied_value_usd;
    });
    return out;
  }

  function render() {
    var rows = filtered();
    $('showing-label').textContent = 'Showing ' + rows.length + ' of ' + R.rows.length + ' protocols';
    $('radar-tbody').innerHTML = rows.map(function (r) {
      return '<tr data-slug="' + esc(r.slug) + '">' +
        '<td class="col-rank">' + r.rank + '</td>' +
        '<td><div class="proto-cell"><div class="proto-name">' + esc(r.name) +
        (r.is_watchlist ? ' <span class="watch-dot">WATCH</span>' : '') + '</div>' +
        '<div class="proto-slug">' + esc(r.slug) + '</div></div></td>' +
        '<td><span class="tier-badge tier-' + r.tier + '">' + r.tier + '</span></td>' +
        '<td><span class="cat-tag">' + esc(r.category || 'Uncategorized') + '</span></td>' +
        '<td><div class="chain-chips">' + r.chains.slice(0, 3).map(function (c) { return '<span class="chain-chip">' + esc(c) + '</span>'; }).join('') +
        (r.chains.length > 3 ? '<span class="chain-chip">+' + (r.chains.length - 3) + '</span>' : '') + '</div></td>' +
        '<td class="col-num">' + usd(r.tvl_usd) + '</td>' +
        '<td class="col-num">' + pct(r.change_7d) + '</td>' +
        '<td class="col-num">' + age(r.age_days) + '</td>' +
        '<td><span class="mult-pill">' + r.sector_multiple.toFixed(2) + ' &times; ' + r.growth_multiplier.toFixed(2) + ' &times; ' + r.maturity_multiplier.toFixed(2) + ' &times; ' + r.scale_multiplier.toFixed(2) + '</span></td>' +
        '<td class="col-num fdv-val">' + usd(r.implied_value_usd) + '</td>' +
        '<td class="col-num airdrop-val">' + usd(r.airdrop_pool_usd) + '</td>' +
        '<td><button class="btn-plan">View plan</button></td></tr>';
    }).join('');
    document.querySelectorAll('#radar-tbody tr').forEach(function (tr) {
      tr.addEventListener('click', function () {
        var row = R.rows.find(function (r) { return r.slug === tr.dataset.slug; });
        if (row) openModal(row);
      });
    });
  }

  function renderLive() {
    $('live-tbody').innerHTML = R.live.map(function (r) {
      return '<tr><td><div class="proto-cell"><div class="proto-name">' + esc(r.name) + '</div><div class="proto-slug">' + esc(r.slug) + '</div></div></td>' +
        '<td><span class="cat-tag">' + esc(r.category || 'Uncategorized') + '</span></td>' +
        '<td><div class="chain-chips">' + r.chains.slice(0, 3).map(function (c) { return '<span class="chain-chip">' + esc(c) + '</span>'; }).join('') + '</div></td>' +
        '<td class="col-num">' + usd(r.tvl_usd) + '</td>' +
        '<td class="col-num fdv-val">' + usd(r.mcap_usd) + '</td>' +
        '<td class="col-num">' + (r.mcap_tvl_ratio === null ? '--' : r.mcap_tvl_ratio.toFixed(2) + 'x') + '</td>' +
        '<td class="col-num">' + pct(r.change_7d) + '</td></tr>';
    }).join('');
  }

  function openModal(r) {
    $('modal-badges').innerHTML = '<span class="tier-badge tier-' + r.tier + '">' + r.tier + '</span>' +
      (r.is_watchlist ? '<span class="watch-dot">WATCHLIST</span>' : '<span class="watch-dot">EARLY DISCOVERY</span>') +
      '<span class="watch-dot">PRE-TOKEN</span>';
    $('modal-title').textContent = '#' + r.rank + ' ' + r.name;
    $('modal-subtitle').textContent = r.slug + ' \u2022 ' + (r.category || 'Uncategorized') + ' \u2022 ' + r.chains.join(', ');
    $('modal-kpis').innerHTML = [
      ['TVL', usd(r.tvl_usd), ''], ['Implied FDV', usd(r.implied_value_usd), 'accent-emerald'],
      ['Est. Airdrop Pool', usd(r.airdrop_pool_usd), 'accent-amber'], ['Age', age(r.age_days), '']
    ].map(function (k) {
      return '<div class="m-kpi"><div class="m-kpi-label">' + k[0] + '</div><div class="m-kpi-val ' + k[2] + '">' + k[1] + '</div></div>';
    }).join('');
    var g = r.change_7d === null ? 0 : Math.max(-60, Math.min(120, r.change_7d));
    $('modal-factors').innerHTML = [
      ['Sector multiple', r.sector_multiple.toFixed(2) + 'x', 'FDV/TVL baseline for ' + (r.category || 'unknown category')],
      ['Momentum', r.growth_multiplier.toFixed(3) + 'x', '7d TVL change ' + g.toFixed(1) + '% (clamped -60..120)'],
      ['Maturity', r.maturity_multiplier.toFixed(3) + 'x', (r.age_days === null ? 'age unknown, 365d assumed' : r.age_days + ' days tracked with no token')],
      ['Liquidity scale', r.scale_multiplier.toFixed(3) + 'x', 'log10(TVL / $10M) moat bonus, max +25%']
    ].map(function (f) {
      return '<div class="factor-box"><div class="factor-title">' + f[0] + '</div><div class="factor-mult">' + f[1] + '</div><div class="factor-desc">' + f[2] + '</div></div>';
    }).join('');
    $('modal-farm-summary').innerHTML = '<span class="p-tag">Capital $' + r.capital_usd + '</span><span class="p-tag">Hold ' + r.hold_days + 'd</span><span class="p-tag">Gas ' + esc(r.gas_tier) + '</span>';
    $('modal-steps').innerHTML = r.farm_steps.map(function (s) {
      var m = /^\[([^\]]+)\]\s*(.*?)\s*Cost:\s*(.*?)\.\s*Time:\s*(.*?)\.$/.exec(s);
      if (!m) return '<div class="step-card"><div class="step-body">' + esc(s) + '</div></div>';
      return '<div class="step-card"><div class="step-top"><span class="step-phase">' + esc(m[1]) + '</span><span class="step-meta"><span class="step-cost">' + esc(m[3]) + '</span><span class="step-time">' + esc(m[4]) + '</span></span></div><div class="step-body">' + esc(m[2]) + '</div></div>';
    }).join('');
    $('detail-modal').classList.remove('hidden');
  }

  function closeModal() { $('detail-modal').classList.add('hidden'); }

  init();
})();
