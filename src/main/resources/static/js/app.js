'use strict';

// ============================================================
// Helpers
// ============================================================
const $ = id => document.getElementById(id);
const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
const MOD = isMac ? '⌘' : 'Ctrl+';

function esc(s) {
    if (s == null) return '';
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function icon(name, cls = '') { return `<svg class="i ${cls}"><use href="#i-${name}"/></svg>`; }

function lsGet(key, fallback) {
    try { const v = localStorage.getItem(key); return v == null ? fallback : JSON.parse(v); } catch (e) { return fallback; }
}
function lsSet(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* storage unavailable */ } }

function debounce(fn, ms) {
    let t;
    const d = (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
    d.flush = () => { clearTimeout(t); fn(); };
    return d;
}

async function api(method, url, body, opts = {}) {
    const init = { method, headers: {}, signal: opts.signal };
    if (body !== undefined) {
        init.headers['Content-Type'] = 'application/json';
        init.body = typeof body === 'string' ? body : JSON.stringify(body);
    }
    const res = await fetch(url, init);
    if (!res.ok) {
        let msg = `${res.status} ${res.statusText}`;
        try { const j = await res.json(); msg = j.error || j.message || msg; } catch (e) { /* not json */ }
        throw new Error(msg);
    }
    const text = await res.text();
    return text ? JSON.parse(text) : null;
}

function formatBytes(b) {
    if (!b) return '0 B';
    if (b < 1024) return b + ' B';
    if (b < 1048576) return (b / 1024).toFixed(1) + ' KB';
    return (b / 1048576).toFixed(2) + ' MB';
}
function formatMs(ms) { return ms >= 1000 ? (ms / 1000).toFixed(2) + ' s' : ms + ' ms'; }

const STATUS_TEXT = { 100: 'Continue', 200: 'OK', 201: 'Created', 202: 'Accepted', 204: 'No Content', 206: 'Partial Content', 301: 'Moved Permanently', 302: 'Found', 303: 'See Other', 304: 'Not Modified', 307: 'Temporary Redirect', 308: 'Permanent Redirect', 400: 'Bad Request', 401: 'Unauthorized', 403: 'Forbidden', 404: 'Not Found', 405: 'Method Not Allowed', 406: 'Not Acceptable', 408: 'Request Timeout', 409: 'Conflict', 410: 'Gone', 413: 'Payload Too Large', 415: 'Unsupported Media Type', 422: 'Unprocessable Entity', 429: 'Too Many Requests', 500: 'Internal Server Error', 501: 'Not Implemented', 502: 'Bad Gateway', 503: 'Service Unavailable', 504: 'Gateway Timeout' };
function statusClass(code) { return !code ? 'status-err' : code < 300 ? 'status-2xx' : code < 400 ? 'status-3xx' : code < 500 ? 'status-4xx' : 'status-5xx'; }
function shortMethod(m) { return esc(({ DELETE: 'DEL', OPTIONS: 'OPT' })[m] || m); }
// Methods come from imports too; only plain tokens may become a CSS class
function methodClass(m) { return /^[A-Z]{1,20}$/.test(m) ? m : 'OTHER'; }

function headerValue(headers, name) {
    if (!headers) return '';
    const k = Object.keys(headers).find(h => h.toLowerCase() === name.toLowerCase());
    return k ? headers[k] : '';
}

let toastTimer;
function toast(msg, isError = false, kind = '') {
    const el = $('toast');
    el.textContent = msg;
    el.classList.toggle('error', isError);
    el.classList.toggle('achievement', kind === 'achievement');
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), isError ? 3500 : 1800);
}

async function copyText(text) {
    try { await navigator.clipboard.writeText(text); }
    catch (e) {
        const ta = document.createElement('textarea');
        ta.value = text; document.body.appendChild(ta); ta.select();
        document.execCommand('copy'); ta.remove();
    }
}

function download(filename, content, type) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([content], { type }));
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ============================================================
// State
// ============================================================
const state = {
    tree: { collections: [], requests: [] },
    history: [],
    sidebarTab: 'collections',
    search: '',
    expanded: new Set(lsGet('reqly.expanded', [])),
    environments: [],
    tabs: [],
    activeTabId: null,
    tabSeq: 0,
    viewMode: 'pretty',
    inFlight: null,
};

// ============================================================
// Dialogs & modals
// ============================================================
function openModal(id) { tooltip.hide(); $(id).classList.add('active'); }
function closeModal(id) { $(id).classList.remove('active'); }

let dialogResolve = null;
/** Styled replacement for alert/confirm/prompt. Resolves to true/false, or the input value/null. */
function uiDialog({ title, message = '', okText = 'OK', cancelText = 'Cancel', danger = false, input = null, alertOnly = false }) {
    $('dialogTitle').textContent = title;
    const body = $('dialogMessage');
    body.innerHTML = message;
    let field = null;
    if (input) {
        field = document.createElement('input');
        field.className = 'input';
        field.value = input.value || '';
        field.placeholder = input.placeholder || '';
        body.appendChild(field);
        if (message) field.style.marginTop = '10px';
    }
    const ok = $('dialogOk'), cancel = $('dialogCancel');
    ok.textContent = okText;
    ok.className = 'btn ' + (danger ? 'btn-danger' : 'btn-primary');
    cancel.textContent = cancelText;
    cancel.style.display = alertOnly ? 'none' : '';
    openModal('dialogModal');
    setTimeout(() => (field || ok).focus(), 30);
    if (field) { field.select(); field.onkeydown = e => { if (e.key === 'Enter') ok.click(); }; }
    return new Promise(resolve => {
        dialogResolve = v => { dialogResolve = null; closeModal('dialogModal'); resolve(v); };
        ok.onclick = () => dialogResolve(field ? field.value : true);
        cancel.onclick = () => dialogResolve(field ? null : false);
    });
}
const uiConfirm = (title, message, okText = 'Delete') => uiDialog({ title, message, okText, danger: true });
const uiPrompt = (title, value, placeholder) => uiDialog({ title, okText: 'Save', input: { value, placeholder } });

// ============================================================
// Context menu
// ============================================================
function openMenu(ev, items, anchorRow, anchorEl = null) {
    ev.preventDefault();
    ev.stopPropagation();
    const menu = $('ctxMenu');
    menu.style.minWidth = anchorEl ? anchorEl.offsetWidth + 'px' : '';
    menu.innerHTML = items.map((it, i) => it === '-' ? '<div class="ctx-sep"></div>'
        : `<div class="ctx-item${it.danger ? ' danger' : ''}${it.checked ? ' checked' : ''}" data-i="${i}">${it.checked !== undefined ? `<span class="ctx-check">${it.checked ? '✓' : ''}</span>` : ''}${it.icon ? icon(it.icon) : ''}<span class="${it.className || ''}">${esc(it.label)}</span>${it.shortcut ? `<span class="shortcut">${it.shortcut}</span>` : ''}</div>`).join('');
    menu.onclick = e => {
        const el = e.target.closest('.ctx-item');
        if (!el) return;
        hideMenu();
        items[+el.dataset.i].action();
    };
    document.querySelectorAll('.menu-open').forEach(r => r.classList.remove('menu-open'));
    if (anchorRow) anchorRow.classList.add('menu-open');
    menu.classList.add('active');
    const r = (anchorEl || ev.target.closest('button'))?.getBoundingClientRect();
    let x = r ? r.left : ev.clientX, y = r ? r.bottom + 4 : ev.clientY;
    x = Math.min(x, window.innerWidth - menu.offsetWidth - 8);
    if (y + menu.offsetHeight > window.innerHeight - 8) y = Math.max(8, (r ? r.top - 4 : ev.clientY) - menu.offsetHeight);
    menu.style.left = x + 'px';
    menu.style.top = y + 'px';
}
/**
 * Native <select> popups are drawn by the OS and ignore the theme, so every select opens
 * the app's own menu instead. The <select> stays the source of truth (value, change events, keyboard).
 */
let menuSelect = null;
function initThemedSelects() {
    document.addEventListener('mousedown', e => {
        const sel = e.target.closest('select');
        if (!sel || sel.multiple || sel.disabled || e.button !== 0) return;
        e.preventDefault();
        if (menuSelect === sel && $('ctxMenu').classList.contains('active')) { hideMenu(); return; }
        sel.focus();
        const items = [...sel.options].map(o => ({
            label: o.textContent,
            checked: o.selected,
            className: sel.classList.contains('method-select') ? `method-badge method-${methodClass(o.value)}` : '',
            action: () => {
                if (sel.value === o.value) return;
                sel.value = o.value;
                sel.dispatchEvent(new Event('input', { bubbles: true }));
                sel.dispatchEvent(new Event('change', { bubbles: true }));
            },
        }));
        openMenu(e, items, null, sel.closest('.env-picker') || sel);
        menuSelect = sel;
    }, true);
}

function hideMenu() {
    menuSelect = null;
    $('ctxMenu').classList.remove('active');
    document.querySelectorAll('.menu-open').forEach(r => r.classList.remove('menu-open'));
}

// ============================================================
// Key-value editor (params, headers, form body, env variables)
// ============================================================
const kvConfig = {};

function initKv(id, opts = {}) {
    kvConfig[id] = { toggle: true, keyLabel: 'Key', valLabel: 'Value', keyPh: 'Key', valPh: 'Value', ...opts };
    const el = $(id);
    el.addEventListener('input', e => {
        const tr = e.target.closest('tr');
        if (tr && tr.classList.contains('placeholder')) promoteKvRow(id, tr);
        onKvChange(id);
    });
    el.addEventListener('change', e => {
        if (e.target.type !== 'checkbox') return;
        e.target.closest('tr').classList.toggle('disabled', !e.target.checked);
        onKvChange(id);
    });
    el.addEventListener('click', e => {
        const del = e.target.closest('.row-del');
        if (!del) return;
        del.closest('tr').remove();
        onKvChange(id);
    });
}

function setKv(id, rows, resetMode = false) {
    const el = $(id), cfg = kvConfig[id];
    if (resetMode) el.dataset.mode = 'table';
    if (el.dataset.mode === 'bulk') {
        el.querySelector('textarea').value = rowsToBulk(rows);
        return;
    }
    el.dataset.mode = 'table';
    el.innerHTML = `<table class="kv-table"><thead><tr>${cfg.toggle ? '<th class="col-check"></th>' : ''}<th>${cfg.keyLabel}</th><th>${cfg.valLabel}</th>${cfg.secrets ? '<th class="col-del"></th>' : ''}<th class="col-del"></th></tr></thead><tbody></tbody></table>`;
    rows.forEach(r => appendKvRow(id, r));
    appendKvRow(id, null);
    updateBulkButton(id);
}

function appendKvRow(id, row) {
    const cfg = kvConfig[id];
    const tr = document.createElement('tr');
    if (!row) tr.className = 'placeholder';
    else if (row.enabled === false) tr.className = 'disabled';
    tr.innerHTML = (cfg.toggle ? `<td class="col-check"><input type="checkbox" title="Include in the request (unchecked rows are kept but not sent)" ${!row || row.enabled !== false ? 'checked' : ''}></td>` : '')
        + `<td><input type="text" data-k spellcheck="false" placeholder="${row ? '' : esc(cfg.keyPh)}" value="${esc(row?.key ?? '')}"></td>`
        + `<td><input type="${row?.secret ? 'password' : 'text'}" data-v spellcheck="false" autocomplete="off" placeholder="${row ? '' : esc(cfg.valPh)}" value="${esc(row?.value ?? '')}"></td>`
        + (cfg.secrets ? `<td class="col-del"><button class="icon-btn row-secret${row?.secret ? ' active' : ''}" title="Secret: mask this value on screen">${icon('lock')}</button></td>` : '')
        + `<td class="col-del"><button class="icon-btn row-del" title="Remove">${icon('x')}</button></td>`;
    $(id).querySelector('tbody').appendChild(tr);
}

function promoteKvRow(id, tr) {
    tr.classList.remove('placeholder');
    tr.querySelectorAll('input[data-k], input[data-v]').forEach(i => { i.placeholder = ''; });
    appendKvRow(id, null);
}

function getKv(id) {
    const el = $(id);
    if (el.dataset.mode === 'bulk') return bulkToRows(el.querySelector('textarea').value);
    return [...el.querySelectorAll('tbody tr:not(.placeholder)')].map(tr => {
        const cb = tr.querySelector('input[type=checkbox]');
        return { key: tr.querySelector('[data-k]').value, value: tr.querySelector('[data-v]').value, enabled: !cb || cb.checked, secret: !!tr.querySelector('.row-secret.active') };
    }).filter(r => r.key || r.value);
}

function rowsToBulk(rows) { return rows.map(r => (r.enabled === false ? '//' : '') + r.key + ': ' + r.value).join('\n'); }
function bulkToRows(text) {
    return text.split('\n').map(l => l.trim()).filter(Boolean).map(l => {
        const enabled = !l.startsWith('//');
        if (!enabled) l = l.slice(2).trim();
        const i = l.indexOf(':');
        return i < 0 ? { key: l, value: '', enabled } : { key: l.slice(0, i).trim(), value: l.slice(i + 1).trim(), enabled };
    });
}

function toggleBulk(id) {
    const el = $(id), rows = getKv(id);
    if (el.dataset.mode === 'bulk') {
        el.dataset.mode = 'table';
        setKv(id, rows);
    } else {
        el.dataset.mode = 'bulk';
        el.innerHTML = '<textarea class="code bulk-text" spellcheck="false" placeholder="key: value  (one per line, prefix // to disable)"></textarea>';
        el.querySelector('textarea').value = rowsToBulk(rows);
        el.querySelector('textarea').focus();
    }
    updateBulkButton(id);
}

function updateBulkButton(id) {
    const btn = document.querySelector(`[data-bulk="${id}"]`);
    if (btn) btn.textContent = $(id).dataset.mode === 'bulk' ? 'Key-Value Edit' : 'Bulk Edit';
}

function onKvChange(id) {
    if (id === 'envVarsEditor') return;
    if (id === 'paramsEditor') syncUrlFromParams();
    markDirty();
    updateIndicators();
}

/** Enabled query rows in order (repeated keys allowed), from paramRows or the older params map. */
const queryRows = dto => dto.paramRows ? dto.paramRows.filter(r => r.enabled !== false) : mapToRows(dto.params, true);
const rowsToMap = (rows, enabled) => Object.fromEntries(rows.filter(r => r.key && (r.enabled !== false) === enabled).map(r => [r.key, r.value]));
const mapToRows = (map, enabled) => Object.entries(map || {}).map(([key, value]) => ({ key, value: value ?? '', enabled }));

// ============================================================
// URL <-> params sync
// ============================================================
function splitUrl(url) {
    const i = url.indexOf('?');
    return i < 0 ? { base: url, query: '' } : { base: url.slice(0, i), query: url.slice(i + 1) };
}
function safeDecode(s) { try { return decodeURIComponent(s.replace(/\+/g, ' ')); } catch (e) { return s; } }
function parseQuery(q) {
    return q.split('&').filter(Boolean).map(p => {
        const i = p.indexOf('=');
        return { key: safeDecode(i < 0 ? p : p.slice(0, i)), value: i < 0 ? '' : safeDecode(p.slice(i + 1)), enabled: true };
    });
}
// Encode only what would change the meaning of the query, so {{vars}} and readable text stay as typed
const encQuery = s => String(s).replace(/%/g, '%25').replace(/ /g, '%20').replace(/&/g, '%26').replace(/#/g, '%23').replace(/\+/g, '%2B');
function composeUrl(base, rows) {
    const q = rows.filter(r => r.enabled !== false && r.key)
        .map(r => { const k = encQuery(r.key).replace(/=/g, '%3D'); return r.value === '' ? k : `${k}=${encQuery(r.value)}`; }).join('&');
    return q ? `${base}?${q}` : base;
}
function syncUrlFromParams() {
    const input = $('urlInput');
    input.value = composeUrl(splitUrl(input.value).base, getKv('paramsEditor'));
    renderTabs();
    renderUrlMirror();
}
function syncParamsFromUrl() {
    const { query } = splitUrl($('urlInput').value);
    const disabled = getKv('paramsEditor').filter(r => r.enabled === false);
    setKv('paramsEditor', [...parseQuery(query), ...disabled]);
}

// Form bodies keep {{variables}} unencoded so the server can substitute them.
function encodeFormPart(s) { return String(s).split(/(\{\{[^}]+\}\})/).map(p => p.startsWith('{{') ? p : encodeURIComponent(p)).join(''); }
function encodeForm(rows) { return rows.filter(r => r.enabled !== false && r.key).map(r => `${encodeFormPart(r.key)}=${encodeFormPart(r.value)}`).join('&'); }

// ============================================================
// Request editor
// ============================================================
function currentBodyType() { return document.querySelector('input[name=bodyType]:checked').value; }

function setBodyType(type) {
    const radio = document.querySelector(`input[name=bodyType][value="${type}"]`) || document.querySelector('input[name=bodyType][value=raw]');
    radio.checked = true;
    const t = radio.value;
    $('bodyNone').style.display = t === 'none' ? '' : 'none';
    $('bodyEditor').style.display = t === 'raw' || t === 'text' ? '' : 'none';
    $('formEditor').style.display = t === 'x-www-form-urlencoded' ? '' : 'none';
    $('formDataEditor').style.display = t === 'form-data' ? '' : 'none';
    $('gqlEditor').style.display = t === 'graphql' ? '' : 'none';
    $('beautifyBtn').style.display = t === 'raw' || t === 'graphql' ? '' : 'none';
    $('bodyEditor').placeholder = t === 'raw' ? '{ "key": "value" }' : 'Plain text body';
}

const AUTH_HINTS = {
    '': 'This request does not use any authorization.',
    bearer: 'The token is sent as an Authorization: Bearer header. Variables like {{token}} work here.',
    basic: 'Username and password are Base64-encoded into an Authorization: Basic header.',
    apikey: 'The key/value pair is sent as a request header.',
};

function renderAuthFields(type, cfg = {}) {
    $('authHint').textContent = AUTH_HINTS[type || ''];
    const f = $('authFields');
    const field = (label, id, value, ph, type = 'text') => `<div><label class="field-label">${label}</label>${type === 'password'
        ? `<div class="pw-wrap"><input type="password" class="input" id="${id}" value="${esc(value)}" placeholder="${esc(ph)}" spellcheck="false"><button class="icon-btn" type="button" onclick="const i=this.previousElementSibling;i.type=i.type==='password'?'text':'password'" title="Show/hide">${icon('eye')}</button></div>`
        : `<input type="text" class="input" id="${id}" value="${esc(value)}" placeholder="${esc(ph)}" spellcheck="false">`}</div>`;
    if (type === 'bearer') f.innerHTML = field('Token', 'authToken', cfg.token || '', 'Token or {{variable}}');
    else if (type === 'basic') f.innerHTML = field('Username', 'authUsername', cfg.username || '', 'Username') + field('Password', 'authPassword', cfg.password || '', 'Password', 'password');
    else if (type === 'apikey') f.innerHTML = field('Key', 'authApiKey', cfg.key || 'X-API-Key', 'Header name') + field('Value', 'authApiValue', cfg.value || '', 'Value or {{variable}}');
    else f.innerHTML = '';
}

function getAuth() {
    const type = $('authTypeSelect').value;
    const v = id => $(id)?.value || '';
    if (type === 'bearer') return { type, config: { token: v('authToken') } };
    if (type === 'basic') return { type, config: { username: v('authUsername'), password: v('authPassword') } };
    if (type === 'apikey') return { type, config: { key: v('authApiKey') || 'X-API-Key', value: v('authApiValue'), addTo: 'header' } };
    return { type: null, config: null };
}

function buildRequestDto() {
    const tab = activeTab();
    const params = getKv('paramsEditor'), headers = getKv('headersEditor');
    const bodyType = currentBodyType();
    const auth = getAuth();
    return {
        id: tab?.requestId || null,
        name: tab?.name || null,
        method: $('methodSelect').value,
        url: splitUrl($('urlInput').value.trim()).base,
        params: rowsToMap(params, true),
        disabledParams: rowsToMap(params, false),
        paramRows: params.filter(r => r.key || r.value).map(({ key, value, enabled }) => ({ key, value, enabled: enabled !== false })),
        headers: rowsToMap(headers, true),
        disabledHeaders: rowsToMap(headers, false),
        body: bodyType === 'x-www-form-urlencoded' ? (encodeForm(getKv('formEditor')) || null)
            : bodyType === 'form-data' ? (getFormData().length ? JSON.stringify(getFormData()) : null)
            : bodyType === 'graphql' ? (($('gqlQuery').value || $('gqlVars').value) ? JSON.stringify({ query: $('gqlQuery').value, variables: $('gqlVars').value }) : null)
            : ($('bodyEditor').value || null),
        bodyType,
        settings: getSettings(),
        authType: auth.type,
        authConfig: auth.config,
        testScript: $('testEditor').value || null,
        preRequestScript: $('preScriptEditor').value || null,
        postResponseScript: $('postScriptEditor').value || null,
        collectionId: tab?.collectionId || null,
    };
}

const AUTO_CONTENT_TYPE = { raw: 'application/json', text: 'text/plain', 'x-www-form-urlencoded': 'application/x-www-form-urlencoded', graphql: 'application/json' };

/** What actually goes over the wire: no body for "none", plus an automatic Content-Type like Postman adds. */
function prepareForSend(dto) {
    const out = { ...dto, headers: { ...dto.headers } };
    if (dto.bodyType === 'none') out.body = null;
    if (dto.bodyType === 'graphql' && dto.body) {
        // Stored as {query, variables-as-text}; sent as the standard GraphQL JSON payload
        const g = JSON.parse(dto.body);
        let variables;
        try { variables = g.variables?.trim() ? JSON.parse(g.variables) : undefined; } catch (e) { variables = undefined; }
        out.body = JSON.stringify(variables === undefined ? { query: g.query } : { query: g.query, variables });
    }
    const ct = AUTO_CONTENT_TYPE[dto.bodyType];
    if (out.body && ct && !headerValue(out.headers, 'content-type')) out.headers['Content-Type'] = ct;
    return out;
}

function loadRequestToUI(dto) {
    dto = dto || {};
    const method = dto.method || 'GET';
    const sel = $('methodSelect');
    if (![...sel.options].some(o => o.value === method)) sel.add(new Option(method, method));
    sel.value = method;
    colorMethodSelect();
    const { base, query } = splitUrl(dto.url || '');
    const paramRows = [...parseQuery(query), ...(dto.paramRows
        ? dto.paramRows.map(r => ({ key: r.key, value: r.value ?? '', enabled: r.enabled !== false }))
        : [...mapToRows(dto.params, true), ...mapToRows(dto.disabledParams, false)])];
    setKv('paramsEditor', paramRows, true);
    $('urlInput').value = composeUrl(base, paramRows);
    renderUrlMirror();
    setKv('headersEditor', [...mapToRows(dto.headers, true), ...mapToRows(dto.disabledHeaders, false)], true);
    const bodyType = dto.bodyType || (dto.body ? 'raw' : 'none');
    setBodyType(bodyType);
    $('bodyEditor').value = ['raw', 'text', 'none'].includes(bodyType) ? dto.body || '' : '';
    setKv('formEditor', bodyType === 'x-www-form-urlencoded' ? parseQuery(dto.body || '') : [], true);
    let fd = [];
    if (bodyType === 'form-data') { try { fd = JSON.parse(dto.body || '[]'); } catch (e) { fd = []; } }
    setFormData(fd);
    let gql = {};
    if (bodyType === 'graphql') { try { gql = JSON.parse(dto.body || '{}'); } catch (e) { gql = {}; } }
    $('gqlQuery').value = gql.query || '';
    $('gqlVars').value = gql.variables || '';
    setSettings(dto.settings);
    $('authTypeSelect').value = dto.authType || '';
    renderAuthFields(dto.authType, dto.authConfig || {});
    $('testEditor').value = dto.testScript || '';
    $('preScriptEditor').value = dto.preRequestScript || '';
    $('postScriptEditor').value = dto.postResponseScript || '';
    updateIndicators();
}

function colorMethodSelect() {
    const s = $('methodSelect');
    s.className = 'method-select method-' + s.value;
}

function updateIndicators() {
    const params = getKv('paramsEditor').filter(r => r.enabled !== false && r.key).length;
    const headers = getKv('headersEditor').filter(r => r.enabled !== false && r.key).length;
    const tests = $('testEditor').value.split('\n').filter(l => l.trim() && !l.trim().startsWith('//') && !l.trim().startsWith('#')).length;
    $('cntParams').textContent = params || '';
    $('cntHeaders').textContent = headers || '';
    $('cntTests').textContent = tests || '';
    $('markAuth').style.display = $('authTypeSelect').value ? '' : 'none';
    const bt = currentBodyType();
    const hasBody = bt === 'x-www-form-urlencoded' ? getKv('formEditor').length > 0
        : bt === 'form-data' ? getFormData().length > 0
        : bt === 'graphql' ? $('gqlQuery').value.trim() !== ''
        : bt !== 'none' && $('bodyEditor').value.trim() !== '';
    const st = getSettings();
    $('markSettings').style.display = st ? '' : 'none';
    const pre = $('preScriptEditor').value.trim(), post = $('postScriptEditor').value.trim();
    $('markScripts').style.display = pre || post ? '' : 'none';
    $('markPre').style.display = pre ? '' : 'none';
    $('markPost').style.display = post ? '' : 'none';
    $('markBody').style.display = hasBody ? '' : 'none';
    const ct = AUTO_CONTENT_TYPE[bt];
    const hasCt = getKv('headersEditor').some(r => r.enabled !== false && r.key.toLowerCase() === 'content-type');
    $('autoHeaderHint').innerHTML = hasBody && ct && !hasCt ? `· auto <code>Content-Type: ${ct}</code>` : '';
}

// ---------- Scripts tab ----------
function initScriptEditor() {
    const show = kind => {
        document.querySelectorAll('#scriptSeg button').forEach(b => b.classList.toggle('active', b.dataset.script === kind));
        $('preScriptEditor').style.display = kind === 'prerequest' ? '' : 'none';
        $('postScriptEditor').style.display = kind === 'test' ? '' : 'none';
        $('scriptSnippets').innerHTML = '<span class="field-label">Snippets</span>' + SCRIPT_SNIPPETS[kind].map(([label], i) => `<div class="snippet" data-sn="${i}" title="${esc(SCRIPT_SNIPPETS[kind][i][1])}">${esc(label)}</div>`).join('')
            + '<p class="hint" style="margin-top:8px">Logs appear in the <a href="#" onclick="toggleConsole(true);return false" style="color:var(--accent)">Console</a>. <code>pm.environment.set()</code> saves to the active environment.</p>';
        $('scriptSnippets').dataset.kind = kind;
    };
    $('scriptSeg').addEventListener('click', e => { const b = e.target.closest('[data-script]'); if (b) show(b.dataset.script); });
    $('scriptSnippets').addEventListener('click', e => {
        const sn = e.target.closest('[data-sn]');
        if (!sn) return;
        const kind = $('scriptSnippets').dataset.kind;
        const ed = kind === 'prerequest' ? $('preScriptEditor') : $('postScriptEditor');
        ed.value = (ed.value.trim() ? ed.value.replace(/\s*$/, '\n\n') : '') + SCRIPT_SNIPPETS[kind][+sn.dataset.sn][1];
        ed.focus();
        ed.dispatchEvent(new Event('input', { bubbles: true }));
    });
    ['preScriptEditor', 'postScriptEditor'].forEach(id => $(id).addEventListener('input', updateIndicators));
    show('prerequest');
}

// ---------- Request settings ----------
/** null when everything is default, so untouched requests don't store settings */
function getSettings() {
    const secs = parseFloat($('setTimeout').value);
    const s = {};
    if (secs > 0) s.timeoutMs = Math.round(secs * 1000);
    if ($('setInsecure').checked) s.insecure = true;
    if (!$('setRedirects').checked) s.followRedirects = false;
    return Object.keys(s).length ? s : null;
}
function setSettings(st) {
    st = st || {};
    $('setTimeout').value = st.timeoutMs ? st.timeoutMs / 1000 : '';
    $('setInsecure').checked = !!st.insecure;
    $('setRedirects').checked = st.followRedirects !== false;
}

// ---------- form-data editor (text fields + files) ----------
// File objects can't be saved; they live on the tab until it's closed or the page reloads.
function fdFiles() { const t = activeTab(); if (t && !t.files) t.files = {}; return t?.files || {}; }

function setFormData(rows) {
    const el = $('formDataEditor');
    el.innerHTML = `<table class="kv-table fd-table"><thead><tr><th class="col-check"></th><th>Key</th><th class="col-type">Type</th><th>Value</th><th class="col-del"></th></tr></thead><tbody></tbody></table>`;
    rows.forEach(r => appendFormDataRow(r));
    appendFormDataRow(null);
}

function appendFormDataRow(row) {
    const tbody = $('formDataEditor').querySelector('tbody');
    const tr = document.createElement('tr');
    const isFile = row?.type === 'file';
    tr.className = !row ? 'placeholder' : row.enabled === false ? 'disabled' : '';
    tr.innerHTML = `<td class="col-check"><input type="checkbox" ${!row || row.enabled !== false ? 'checked' : ''} title="Include in the request"></td>
        <td><input type="text" data-k spellcheck="false" placeholder="${row ? '' : 'Key'}" value="${esc(row?.key ?? '')}"></td>
        <td class="col-type"><select class="fd-type" title="Text field or file upload"><option value="text"${isFile ? '' : ' selected'}>Text</option><option value="file"${isFile ? ' selected' : ''}>File</option></select></td>
        <td class="fd-val">${fdValueCell(row)}</td>
        <td class="col-del"><button class="icon-btn row-del" title="Remove">${icon('x')}</button></td>`;
    tbody.appendChild(tr);
}

function fdValueCell(row) {
    if (row?.type !== 'file') return `<input type="text" data-v spellcheck="false" placeholder="${row ? '' : 'Value'}" value="${esc(row?.value ?? '')}">`;
    const idx = row._idx;
    const f = idx != null ? fdFiles()[idx] : null;
    const name = f?.name || row.fileName;
    return `<label class="fd-file${f ? ' ready' : name ? ' missing' : ''}" title="${f ? 'Click to choose a different file' : name ? 'Files are not saved. Choose it again to send it' : 'Choose a file'}">${icon('file')}<span>${esc(name || 'Choose file…')}</span><input type="file" hidden></label>`;
}

function getFormData() {
    const el = $('formDataEditor');
    if (!el) return [];
    return [...el.querySelectorAll('tbody tr:not(.placeholder)')].map(tr => {
        const type = tr.querySelector('.fd-type').value;
        const row = { key: tr.querySelector('[data-k]').value, type, enabled: tr.querySelector('input[type=checkbox]').checked };
        if (type === 'file') row.fileName = tr.querySelector('.fd-file span')?.textContent.replace('Choose file…', '') || '';
        else row.value = tr.querySelector('[data-v]')?.value || '';
        return row;
    }).filter(r => r.key || r.value || r.fileName);
}

function initFormDataEditor() {
    const el = $('formDataEditor');
    const rowIndex = tr => [...el.querySelectorAll('tbody tr:not(.placeholder)')].indexOf(tr);
    const changed = () => { markDirty(); updateIndicators(); };
    el.addEventListener('input', e => {
        const tr = e.target.closest('tr');
        if (tr?.classList.contains('placeholder') && e.target.matches('input[type=text]')) {
            tr.classList.remove('placeholder');
            tr.querySelectorAll('input[type=text]').forEach(i => { i.placeholder = ''; });
            appendFormDataRow(null);
        }
        changed();
    });
    el.addEventListener('change', e => {
        const tr = e.target.closest('tr');
        if (e.target.matches('input[type=checkbox]')) tr.classList.toggle('disabled', !e.target.checked);
        if (e.target.matches('.fd-type')) {
            if (tr.classList.contains('placeholder')) { tr.classList.remove('placeholder'); appendFormDataRow(null); }
            tr.querySelector('.fd-val').innerHTML = fdValueCell({ type: e.target.value, _idx: rowIndex(tr) });
        }
        if (e.target.matches('.fd-file input[type=file]') && e.target.files[0]) {
            const idx = rowIndex(tr);
            fdFiles()[idx] = e.target.files[0];
            tr.querySelector('.fd-val').innerHTML = fdValueCell({ type: 'file', _idx: idx });
        }
        changed();
    });
    el.addEventListener('click', e => {
        const del = e.target.closest('.row-del');
        if (!del) return;
        const tr = del.closest('tr');
        const idx = rowIndex(tr);
        // keep file slots aligned with row positions
        const files = fdFiles(), next = {};
        Object.entries(files).forEach(([k, f]) => { const i = +k; if (i < idx) next[i] = f; else if (i > idx) next[i - 1] = f; });
        activeTab().files = next;
        tr.remove();
        changed();
    });
}

function beautifyBody() {
    const ed = currentBodyType() === 'graphql' ? $('gqlVars') : $('bodyEditor');
    try {
        ed.value = JSON.stringify(JSON.parse(ed.value), null, 2);
        markDirty();
    } catch (e) {
        toast('Invalid JSON: ' + e.message, true);
    }
}

// ============================================================
// Request tabs
// ============================================================
function activeTab() { return state.tabs.find(t => t.id === state.activeTabId); }

function newTab(dto = null, opts = {}) {
    const tab = { id: ++state.tabSeq, requestId: dto?.id || null, collectionId: dto?.collectionId || opts.collectionId || null, name: opts.name ?? dto?.name ?? null, dto, result: opts.result || null, bulk: null, dirty: !!opts.dirty };
    state.tabs.push(tab);
    switchToTab(tab.id);
    return tab;
}

function snapshotActiveTab() {
    const cur = activeTab();
    if (cur) cur.dto = buildRequestDto();
}

function switchToTab(id) {
    if (state.activeTabId !== id) snapshotActiveTab();
    state.activeTabId = id;
    const tab = activeTab();
    loadRequestToUI(tab.dto);
    restoreResponse(tab);
    if ($('resHistory').classList.contains('active')) loadResponseHistory();
    setSending(!!tab.inFlight);
    if (tab.inFlight) showResponseLoading();
    renderTabs();
    renderRequestTitle();
    highlightActiveInTree();
    document.querySelector(`.req-tab[data-tab="${id}"]`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    persistTabs();
}

async function closeTab(id) {
    const idx = state.tabs.findIndex(t => t.id === id);
    if (idx < 0) return;
    const tab = state.tabs[idx];
    if (tab.dirty) {
        const ok = await uiDialog({ title: 'Discard changes?', message: `<b>${esc(tabTitle(tab))}</b> has unsaved changes. Close it anyway?`, okText: 'Discard', danger: true });
        if (!ok) return;
    }
    closeTabs([id]);
}

async function confirmCloseTabs(ids) {
    const dirty = state.tabs.filter(t => ids.includes(t.id) && t.dirty).length;
    if (dirty && !(await uiDialog({ title: 'Discard changes?', message: `${dirty} tab${dirty > 1 ? 's have' : ' has'} unsaved changes. Close anyway?`, okText: 'Discard', danger: true }))) return;
    closeTabs(ids);
}

function closeTabs(ids) {
    const activeIdx = state.tabs.findIndex(t => t.id === state.activeTabId);
    state.tabs = state.tabs.filter(t => !ids.includes(t.id));
    if (!state.tabs.length) { state.activeTabId = null; newTab(); return; }
    if (ids.includes(state.activeTabId)) {
        state.activeTabId = null;
        switchToTab(state.tabs[Math.min(activeIdx, state.tabs.length - 1)].id);
    } else {
        renderTabs();
        persistTabs();
    }
}

function duplicateTab(id) {
    if (id === state.activeTabId) snapshotActiveTab();
    const src = state.tabs.find(t => t.id === id);
    const dto = { ...src.dto, id: null };
    newTab(dto, { name: src.name ? src.name + ' Copy' : null, collectionId: src.collectionId, dirty: true });
}

function tabTitle(tab) {
    if (tab.name) return tab.name;
    const url = tab.id === state.activeTabId ? $('urlInput').value : tab.dto?.url;
    return url || 'Untitled Request';
}
function tabMethod(tab) { return tab.id === state.activeTabId ? $('methodSelect').value : (tab.dto?.method || 'GET'); }

function renderTabs() {
    $('reqTabs').innerHTML = state.tabs.map(t => {
        const m = tabMethod(t);
        const url = t.id === state.activeTabId ? $('urlInput').value : composeUrl(t.dto?.url || '', mapToRows(t.dto?.params, true));
        const tip = [tabTitle(t), t.name && url ? `${m} ${url}` : '', t.dirty ? 'Unsaved changes' : ''].filter(Boolean).join('\n');
        return `<div class="req-tab${t.id === state.activeTabId ? ' active' : ''}${t.dirty ? ' dirty' : ''}" data-tab="${t.id}" title="${esc(tip)}">
            <span class="method-badge method-${methodClass(m)}">${shortMethod(m)}</span>
            <span class="req-tab-title">${esc(tabTitle(t))}</span>
            <span class="req-tab-close" data-close="${t.id}" title="Close tab" data-tip-key="⌥W"><span class="dot"></span>${icon('x')}</span>
        </div>`;
    }).join('');
}

function markDirty() {
    const tab = activeTab();
    if (!tab) return;
    if (!tab.dirty) { tab.dirty = true; renderTabs(); }
    persistTabs();
}

function isPristine(tab) {
    return tab && !tab.requestId && !tab.dirty && !tab.result && !$('urlInput').value;
}

/** Opens a request in the current tab if it's empty, otherwise a new tab. */
function openInTab(dto, opts = {}) {
    const cur = activeTab();
    if (!opts.forceNew && isPristine(cur)) {
        Object.assign(cur, { requestId: dto.id || null, collectionId: dto.collectionId || null, name: opts.name ?? dto.name ?? null, dto, result: opts.result || null, bulk: null, dirty: !!opts.dirty });
        state.activeTabId = null;
        switchToTab(cur.id);
        return cur;
    }
    return newTab(dto, opts);
}

const persistTabs = debounce(() => {
    snapshotActiveTab();
    lsSet('reqly.tabs', {
        active: state.activeTabId,
        tabs: state.tabs.map(t => ({ id: t.id, requestId: t.requestId, collectionId: t.collectionId, name: t.name, dto: t.dto, dirty: t.dirty })),
    });
}, 400);

function restoreTabs() {
    const saved = lsGet('reqly.tabs', null);
    if (!saved?.tabs?.length) return false;
    state.tabs = saved.tabs.map(t => ({ ...t, result: null, bulk: null }));
    state.tabSeq = Math.max(...state.tabs.map(t => t.id));
    const active = state.tabs.find(t => t.id === saved.active) || state.tabs[0];
    switchToTab(active.id);
    return true;
}

function openTabMenu(ev, id) {
    openMenu(ev, [
        { label: 'New tab', shortcut: '⌥T', action: () => newTab() },
        { label: 'Duplicate tab', action: () => duplicateTab(id) },
        '-',
        { label: 'Close tab', shortcut: '⌥W', action: () => closeTab(id) },
        { label: 'Close other tabs', action: () => confirmCloseTabs(state.tabs.filter(t => t.id !== id).map(t => t.id)) },
        { label: 'Close tabs to the right', action: () => confirmCloseTabs(state.tabs.slice(state.tabs.findIndex(t => t.id === id) + 1).map(t => t.id)) },
        { label: 'Close all tabs', action: () => confirmCloseTabs(state.tabs.map(t => t.id)) },
    ]);
}

function openTabListMenu(ev) {
    openMenu(ev, state.tabs.map(t => ({ label: `${tabMethod(t)}  ${tabTitle(t)}${t.dirty ? ' •' : ''}`, action: () => switchToTab(t.id) })));
}

function renderRequestTitle() {
    const tab = activeTab();
    if (!tab) return;
    const path = tab.requestId ? (findRequestPath(tab.requestId) || []) : tab.collectionId ? folderPath(tab.collectionId) : [];
    $('requestTitle').innerHTML = path.map(p => `<span class="crumb">${esc(p)}</span><span class="crumb">/</span>`).join('')
        + `<span class="name" id="requestName" title="Click to rename">${esc(tab.name || 'Untitled Request')}</span>`
        + (tab.requestId ? '' : '<span class="hint">· not saved</span>');
}

function startTitleRename() {
    const tab = activeTab();
    const span = $('requestName');
    const input = document.createElement('input');
    input.className = 'rename-input';
    input.style.maxWidth = '360px';
    input.value = tab.name || '';
    input.placeholder = 'Request name';
    span.replaceWith(input);
    input.focus(); input.select();
    let done = false;
    const commit = async save => {
        if (done) return; done = true;
        const name = input.value.trim();
        if (save && name && name !== tab.name) {
            if (tab.requestId) {
                try { await api('PATCH', `/api/requests/${tab.requestId}`, { name }); await loadTree(); }
                catch (e) { toast('Rename failed: ' + e.message, true); }
            }
            tab.name = name;
            persistTabs();
        }
        renderTabs();
        renderRequestTitle();
    };
    input.onkeydown = e => { if (e.key === 'Enter') commit(true); if (e.key === 'Escape') commit(false); };
    input.onblur = () => commit(true);
}

// ============================================================
// Sending
// ============================================================
function envQuery(prefix = '?') {
    const id = $('envSelect').value;
    return id ? `${prefix}environmentId=${id}` : '';
}

function setSending(sending) {
    const btn = $('sendBtn');
    btn.classList.toggle('cancel', sending);
    btn.innerHTML = sending ? '<span class="spinner"></span>Cancel' : 'Send';
    btn.dataset.tip = sending ? 'Stop waiting for this response' : 'Send request';
}

function sendOrCancel() {
    const tab = activeTab();
    if (tab?.inFlight) { tab.inFlight.abort(); return; }
    sendRequest();
}

async function sendRequest() {
    let dto = buildRequestDto();
    if (!dto.url) { toast('Enter a URL first', true); $('urlInput').focus(); return; }
    const tab = activeTab();
    const ctrl = new AbortController();
    tab.inFlight = ctrl;
    fx($('sendBtn'), 'fx-launch');
    playSound('send');
    setSending(true);
    showResponseLoading();
    try {
        const ctx = createScriptContext(dto, { requestName: tab.name || defaultRequestName(dto) });
        if (dto.preRequestScript) dto = await runPreRequest(ctx, dto.preRequestScript);
        const missing = undefinedVars(dto);
        if (missing.length) toast(`Undefined: ${missing.map(n => `{{${n}}}`).join(', ')}${activeEnv() ? '' : ' (no environment selected)'}`, true);
        const result = await executeWithFiles(dto, tab, ctrl.signal);
        logNetwork(ctx.requestName, wireRequest(dto, currentEnvVars()), result);
        if (dto.postResponseScript) await runPostResponse(ctx, dto.postResponseScript, result);
        if (ctx.tests.length) result.testResults = [...(result.testResults || []), ...ctx.tests];
        tab.result = result;
        const ok = result.success && result.statusCode < 400;
        recordTelemetry(ok);
        if (tab.id === state.activeTabId) {
            playSound(ok ? 'ok' : 'err');
            fx(document.querySelector('.response-panel'), ok ? 'fx-ok' : 'fx-err');
            if (!ok) fx(document.querySelector('.content'), 'fx-shake');
            const tests = result.testResults || [];
            if (isScifi() && tests.length && tests.every(t => t.passed)) {
                setTimeout(() => { toast(`✦ Achievement · All ${tests.length} test${tests.length > 1 ? 's' : ''} passed  +${tests.length * 10} XP`, false, 'achievement'); playSound('achieve'); }, 450);
            }
        }
        if (result.captureEnvironment) {
            await loadEnvironments();
            const names = result.captures.filter(c => c.ok).map(c => `{{${c.name}}}`).join(', ');
            setTimeout(() => toast(`Saved ${names} to ${result.captureEnvironment}`), isScifi() ? 1800 : 0);
        }
        if (tab.id === state.activeTabId) {
            displayResponse(result);
            if ($('resHistory').classList.contains('active')) loadResponseHistory();
        }
        if (state.sidebarTab === 'history') loadHistory();
    } catch (e) {
        if (tab.id === state.activeTabId) {
            if (e.name === 'AbortError') {
                tab.result = null;
                resetResponse();
                $('responseBody').innerHTML = `<div class="empty-state">${icon('x')}<div>Request cancelled</div></div>`;
            }
            else displayError(e.message);
        }
    } finally {
        tab.inFlight = null;
        if (tab.id === state.activeTabId) setSending(false);
    }
}

/** Uses the multipart endpoint when a form-data request has files attached. */
async function executeWithFiles(dto, tab, signal) {
    const wire = prepareForSend(dto);
    const files = tab.files || {};
    const rows = dto.bodyType === 'form-data' ? getFormData() : [];
    const missing = rows.filter((r, i) => r.type === 'file' && r.enabled !== false && !files[i]).map(r => r.key);
    if (missing.length) toast(`No file chosen for ${missing.join(', ')}; those fields are skipped`, true);
    const attached = rows.map((r, i) => r.type === 'file' && r.enabled !== false && files[i] ? i : -1).filter(i => i >= 0);
    if (!attached.length) return api('POST', '/api/execute' + envQuery(), wire, { signal });
    const fd = new FormData();
    fd.append('request', new Blob([JSON.stringify(wire)], { type: 'application/json' }));
    attached.forEach(i => fd.append(`file:${i}`, files[i], files[i].name));
    const res = await fetch('/api/execute/multipart' + envQuery(), { method: 'POST', body: fd, signal });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    return res.json();
}

async function sendBulk() {
    const dto = buildRequestDto();
    if (!dto.url) return toast('Enter a URL first', true);
    const times = Math.max(1, +$('bulkCount').value || 1);
    const tab = activeTab();
    selectTab('resTabsBar', 'resBulk');
    $('bulkResults').innerHTML = `<div class="empty-state"><span class="spinner"></span><div>Running ${times} requests…</div></div>`;
    try {
        tab.bulk = await api('POST', `/api/execute/bulk?times=${times}${envQuery('&')}`, prepareForSend(dto));
        if (tab.id === state.activeTabId) displayBulkResults(tab.bulk);
    } catch (e) {
        if (tab.id === state.activeTabId) $('bulkResults').innerHTML = `<div class="error-box">${esc(e.message)}</div>`;
    }
}

async function sendCsv() {
    const dto = buildRequestDto();
    const file = $('csvFile').files[0];
    if (!dto.url) return toast('Enter a URL first', true);
    if (!file) return toast('Choose a CSV file first', true);
    const fd = new FormData();
    fd.append('request', new Blob([JSON.stringify(prepareForSend(dto))], { type: 'application/json' }));
    fd.append('csv', file);
    const tab = activeTab();
    selectTab('resTabsBar', 'resBulk');
    $('bulkResults').innerHTML = '<div class="empty-state"><span class="spinner"></span><div>Running CSV data-driven requests…</div></div>';
    try {
        const res = await fetch('/api/execute/csv' + envQuery(), { method: 'POST', body: fd });
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
        tab.bulk = await res.json();
        if (tab.id === state.activeTabId) displayBulkResults(tab.bulk);
    } catch (e) {
        if (tab.id === state.activeTabId) $('bulkResults').innerHTML = `<div class="error-box">${esc(e.message)}</div>`;
    }
}

// ============================================================
// Response display
// ============================================================
function emptyResponseHtml() {
    return `<div class="empty-state"><div class="radar"></div>${icon('send')}<div>${isScifi() ? 'Awaiting transmission. Enter a URL and hit Send' : 'Enter the URL and click Send to get a response'}</div>
        <div class="shortcuts"><span class="kbd">${MOD}↵</span><span>Send request</span><span class="kbd">${MOD}S</span><span>Save request</span><span class="kbd">⌥T</span><span>New tab</span><span class="kbd">⌥W</span><span>Close tab</span></div></div>`;
}

function resetResponse() {
    $('responseMeta').innerHTML = '';
    $('resBodyToolbar').style.display = 'none';
    $('responseBody').innerHTML = emptyResponseHtml();
    $('responseHeaders').innerHTML = '<div class="empty-state"><div>No response headers yet</div></div>';
    $('testResults').innerHTML = '<div class="empty-state"><div>Add assertions in the Tests tab, then send the request</div></div>';
    $('bulkResults').innerHTML = '<div class="empty-state"><div>Use the Bulk / CSV tab to run this request many times</div></div>';
    $('cntResHeaders').textContent = '';
    $('cntResTests').textContent = '';
}

function restoreResponse(tab) {
    resetResponse();
    if (tab.bulk) displayBulkResults(tab.bulk);
    if (tab.result) displayResponse(tab.result);
}

function showResponseLoading() {
    $('responseMeta').innerHTML = '';
    $('resBodyToolbar').style.display = 'none';
    $('responseBody').innerHTML = '<div class="empty-state"><span class="spinner"></span><div>Sending request…</div></div>';
    selectTab('resTabsBar', 'resBody');
}

function displayResponse(result) {
    if (!result.success) return displayError(result.error || 'Request failed', result.responseTimeMs);
    const code = result.statusCode;
    $('responseMeta').innerHTML = `<span class="status-badge ${statusClass(code)}" title="${code < 300 ? 'Success' : code < 400 ? 'Redirect' : code < 500 ? 'Client error: check the request' : 'Server error'}">${code} ${STATUS_TEXT[code] || ''}</span>
        <span title="Time from sending the request until the full response arrived">Time <b>${formatMs(result.responseTimeMs)}</b></span><span title="Size of the response body">Size <b>${formatBytes(result.responseSizeBytes)}</b></span>`;
    $('resBodyToolbar').style.display = '';
    renderResponseBody(result);

    const headers = Object.entries(result.responseHeaders || {});
    $('cntResHeaders').textContent = headers.length || '';
    $('responseHeaders').innerHTML = headers.length
        ? `<table class="hdr-table">${headers.map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`).join('')}</table>`
        : '<div class="empty-state"><div>No headers</div></div>';

    const tests = result.testResults || [];
    const caps = result.captures || [];
    const passed = tests.filter(t => t.passed).length;
    const cnt = $('cntResTests');
    cnt.textContent = tests.length ? `${passed}/${tests.length}` : caps.length ? `${caps.filter(c => c.ok).length}↧` : '';
    cnt.classList.toggle('fail', passed < tests.length || caps.some(c => !c.ok));
    $('testResults').innerHTML = tests.length || caps.length
        ? (tests.length ? renderTestList(tests) : '') + renderCaptures(result)
        : '<div class="empty-state"><div>No tests for this request</div></div>';
}

/** Values saved from the response with `source -> name` lines in the Tests tab. */
function renderCaptures(result) {
    const caps = result.captures || [];
    if (!caps.length) return '';
    const target = result.captureEnvironment
        ? `Saved to <b>${esc(result.captureEnvironment)}</b>`
        : '<span style="color:var(--yellow)">Not saved: select an environment to keep captured values</span>';
    return `<div class="capture-head"><span class="field-label" style="margin:0">Captured variables</span><span class="hint">${target}</span></div>`
        + caps.map(c => `<div class="test-result"><span class="test-tag ${c.ok ? 'pass' : 'fail'}">${c.ok ? 'SET' : 'MISS'}</span><div><div class="test-name">{{${esc(c.name)}}} <span class="muted">← ${esc(c.source)}</span></div><div class="test-msg">${c.ok ? esc(displayValue(c.name, c.value)) : esc(c.message || '')}</div></div></div>`).join('');
}

/** Shows a variable value, masked if it is marked secret in the active environment. */
function displayValue(name, value, env = activeEnv()) {
    const v = String(value ?? '');
    if (!isSecretVar(name, env)) return v.length > 300 ? v.slice(0, 300) + '…' : v;
    return v ? '•'.repeat(Math.min(12, Math.max(6, v.length))) : '';
}

function isSecretVar(name, env = activeEnv()) {
    return !!env && parseSecrets(env.secrets).includes(name);
}
function activeEnv() { return state.environments.find(e => String(e.id) === $('envSelect').value); }
function parseSecrets(json) { try { const v = JSON.parse(json || '[]'); return Array.isArray(v) ? v : []; } catch (e) { return []; } }

function renderTestList(tests) {
    const passed = tests.filter(t => t.passed).length;
    return `<div class="test-summary"><span style="color:var(--green)">${passed} passed</span><span style="color:${passed < tests.length ? 'var(--red)' : 'var(--text-muted)'}">${tests.length - passed} failed</span></div>`
        + tests.map(t => `<div class="test-result"><span class="test-tag ${t.passed ? 'pass' : 'fail'}">${t.passed ? 'PASS' : 'FAIL'}</span><div><div class="test-name">${esc(t.testName || '')}</div><div class="test-msg">${esc(t.message || '')}</div></div></div>`).join('');
}

function displayError(msg, time) {
    $('responseMeta').innerHTML = `<span class="status-badge status-err">Error</span>${time ? `<span>Time <b>${formatMs(time)}</b></span>` : ''}`;
    $('resBodyToolbar').style.display = 'none';
    $('responseBody').innerHTML = `<div style="padding:12px"><div class="error-box">Could not get a response\n\n${esc(msg)}</div></div>`;
    selectTab('resTabsBar', 'resBody');
}

function renderResponseBody(result) {
    const body = result.responseBody ?? '';
    const ct = headerValue(result.responseHeaders, 'content-type');
    const isHtml = /html/i.test(ct) || /^\s*<(!doctype|html)/i.test(body);
    document.querySelector('#viewModeSeg [data-mode=preview]').style.display = isHtml ? '' : 'none';
    let mode = state.viewMode === 'preview' && !isHtml ? 'pretty' : state.viewMode;
    document.querySelectorAll('#viewModeSeg button').forEach(b => b.classList.toggle('active', b.dataset.mode === mode));
    const el = $('responseBody');
    if (!body) { el.innerHTML = '<div class="empty-state"><div>Response body is empty</div></div>'; return; }
    if (mode === 'preview') {
        el.innerHTML = '<iframe sandbox></iframe>';
        el.querySelector('iframe').srcdoc = body;
        return;
    }
    let tree = null;
    if (mode === 'pretty' && body.length < 3_000_000) {
        try {
            JSON.parse(body); // validate; the lossless parser below keeps big numbers exactly as sent
            tree = body.length < 1_500_000 ? parseJsonLossless(body) : null;
            if (!tree) el.innerHTML = '<pre>' + highlightJson(prettyJson(body)) + '</pre>';
        } catch (e) { tree = null; mode = 'raw'; }
    }
    setJsonTools(!!tree);
    if (tree) {
        const q = $('jsonFilter').value.trim();
        if (q) {
            try {
                const found = jsonPath(tree, q);
                el.innerHTML = `<div class="jp-result-head">${found.length} match${found.length === 1 ? '' : 'es'} for <code>${esc(q.startsWith('$') ? q : '$' + q)}</code></div>` + jsonTreeHtml({ t: 'a', items: found });
            } catch (e) {
                el.innerHTML = `<div style="padding:12px"><div class="error-box">Invalid JSONPath: ${esc(e.message)}</div></div>`;
            }
        } else {
            el.innerHTML = jsonTreeHtml(tree);
        }
    } else if (mode !== 'pretty' || !el.querySelector('pre')) {
        el.innerHTML = '<pre>' + esc(body) + '</pre>';
    }
    if ($('resSearch').classList.contains('active')) runResponseSearch();
}

function setJsonTools(on) {
    $('jsonFilterBox').style.display = on || $('jsonFilter').value ? '' : 'none';
    $('treeCollapseBtn').style.display = on ? '' : 'none';
    $('treeExpandBtn').style.display = on ? '' : 'none';
}

// ---------- Lossless JSON tree (numbers stay as their original text) ----------
function parseJsonLossless(src) {
    let i = 0;
    const lit = /-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null/y;
    const ws = () => { while (i < src.length && (src[i] === ' ' || src[i] === '\n' || src[i] === '\r' || src[i] === '\t')) i++; };
    const str = () => {
        const start = i++;
        while (src[i] !== '"') i += src[i] === '\\' ? 2 : 1;
        i++;
        return src.slice(start, i);
    };
    const val = () => {
        ws();
        const c = src[i];
        if (c === '{') {
            i++; const e = [];
            ws(); if (src[i] === '}') { i++; return { t: 'o', e }; }
            for (;;) {
                ws(); const raw = str(); ws(); i++; // ':'
                e.push([JSON.parse(raw), raw, val()]);
                ws(); if (src[i++] === '}') break;
            }
            return { t: 'o', e };
        }
        if (c === '[') {
            i++; const items = [];
            ws(); if (src[i] === ']') { i++; return { t: 'a', items }; }
            for (;;) { items.push(val()); ws(); if (src[i++] === ']') break; }
            return { t: 'a', items };
        }
        if (c === '"') return { t: 's', raw: str() };
        lit.lastIndex = i;
        const m = lit.exec(src);
        i = lit.lastIndex;
        return { t: m[0] === 'null' ? 'null' : m[0] === 'true' || m[0] === 'false' ? 'bool' : 'num', raw: m[0] };
    };
    return val();
}

function jsonTreeHtml(node) {
    const out = [];
    const walk = (n, keyRaw, last) => {
        const key = keyRaw != null ? `<span class="j-key">${esc(keyRaw)}</span>: ` : '';
        const comma = last ? '' : ',';
        if (n.t === 'o' || n.t === 'a') {
            const kids = n.t === 'o' ? n.e : n.items;
            const [open, close] = n.t === 'o' ? ['{', '}'] : ['[', ']'];
            if (!kids.length) { out.push(`<div class="jl">${key}<span class="jp">${open}${close}</span>${comma}</div>`); return; }
            out.push(`<div class="jt"><div class="jl jt-head"><span class="jt-tog"></span>${key}<span class="jp">${open}</span><span class="jt-sum">${kids.length} ${n.t === 'o' ? (kids.length === 1 ? 'key' : 'keys') : (kids.length === 1 ? 'item' : 'items')} ${close}${comma}</span></div><div class="jt-children">`);
            kids.forEach((k, idx) => n.t === 'o' ? walk(k[2], k[1], idx === kids.length - 1) : walk(k, null, idx === kids.length - 1));
            out.push(`</div><div class="jl jt-close"><span class="jp">${close}</span>${comma}</div></div>`);
            return;
        }
        const cls = n.t === 's' ? 'j-str' : n.t === 'num' ? 'j-num' : n.t === 'bool' ? 'j-bool' : 'j-null';
        out.push(`<div class="jl">${key}<span class="${cls}">${esc(n.raw)}</span>${comma}</div>`);
    };
    walk(node, null, true);
    return `<div class="json-tree">${out.join('')}</div>`;
}

function setTreeCollapsed(collapsed) {
    document.querySelectorAll('#responseBody .jt').forEach((el, i) => el.classList.toggle('collapsed', collapsed && i > 0));
}

// ---------- JSONPath subset: $ . .. * [n] [*] ['key'] ----------
function jsonPath(root, expr) {
    let p = expr.trim();
    if (p.startsWith('$')) p = p.slice(1);
    const segs = [];
    const re = /^(?:\.\.([\w$-]+|\*)|\.([\w$-]+|\*)|\[\s*(-?\d+)\s*\]|\[\s*\*\s*\]|\[\s*(['"])(.*?)\4\s*\])/;
    while (p.length) {
        const m = re.exec(p);
        if (!m) throw new Error(`unexpected "${p.slice(0, 20)}"`);
        if (m[1] != null) segs.push({ deep: true, name: m[1] });
        else if (m[2] != null) segs.push({ name: m[2] });
        else if (m[3] != null) segs.push({ index: +m[3] });
        else if (m[5] != null) segs.push({ name: m[5] });
        else segs.push({ name: '*' });
        p = p.slice(m[0].length);
    }
    const children = n => n.t === 'o' ? n.e.map(e => e[2]) : n.t === 'a' ? n.items : [];
    const childNamed = (n, name) => {
        if (name === '*') return children(n);
        if (n.t === 'o') return n.e.filter(e => e[0] === name).map(e => e[2]);
        return [];
    };
    const descendants = n => [n, ...children(n).flatMap(descendants)];
    let cur = [root];
    for (const s of segs) {
        if (s.deep) cur = cur.flatMap(descendants).flatMap(n => childNamed(n, s.name));
        else if (s.index != null) cur = cur.flatMap(n => n.t === 'a' ? [n.items[s.index < 0 ? n.items.length + s.index : s.index]].filter(Boolean) : []);
        else cur = cur.flatMap(n => childNamed(n, s.name));
    }
    return cur;
}

// ---------- Find in response ----------
const resSearch = { hits: [], index: 0 };

function openResponseSearch() {
    if (!activeTab()?.result) return;
    selectTab('resTabsBar', 'resBody');
    $('resSearch').classList.add('active');
    const input = $('resSearchInput');
    input.focus(); input.select();
    runResponseSearch();
}

function closeResponseSearch() {
    $('resSearch').classList.remove('active');
    clearSearchMarks();
    $('resSearchCount').textContent = '';
}

function clearSearchMarks() {
    document.querySelectorAll('#responseBody mark.hit').forEach(m => m.replaceWith(document.createTextNode(m.textContent)));
    $('responseBody').normalize();
    resSearch.hits = [];
}

function runResponseSearch() {
    clearSearchMarks();
    const q = $('resSearchInput').value;
    if (!q) { $('resSearchCount').textContent = ''; return; }
    const ql = q.toLowerCase();
    const walker = document.createTreeWalker($('responseBody'), NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    for (const node of nodes) {
        const text = node.nodeValue, lower = text.toLowerCase();
        let at = lower.indexOf(ql);
        if (at < 0) continue;
        const frag = document.createDocumentFragment();
        let last = 0;
        while (at >= 0 && resSearch.hits.length < 5000) {
            frag.appendChild(document.createTextNode(text.slice(last, at)));
            const mark = document.createElement('mark');
            mark.className = 'hit';
            mark.textContent = text.slice(at, at + q.length);
            frag.appendChild(mark);
            resSearch.hits.push(mark);
            last = at + q.length;
            at = lower.indexOf(ql, last);
        }
        frag.appendChild(document.createTextNode(text.slice(last)));
        node.replaceWith(frag);
    }
    resSearch.index = 0;
    focusSearchHit();
}

function stepResponseSearch(d) {
    if (!resSearch.hits.length) return;
    resSearch.index = (resSearch.index + d + resSearch.hits.length) % resSearch.hits.length;
    focusSearchHit();
}

function focusSearchHit() {
    const n = resSearch.hits.length;
    $('resSearchCount').textContent = n ? `${resSearch.index + 1} / ${n}${n >= 5000 ? '+' : ''}` : 'No matches';
    resSearch.hits.forEach((m, i) => m.classList.toggle('current', i === resSearch.index));
    const cur = resSearch.hits[resSearch.index];
    if (!cur) return;
    for (let jt = cur.closest('.jt.collapsed'); jt; jt = jt.parentElement?.closest('.jt.collapsed')) jt.classList.remove('collapsed');
    cur.scrollIntoView({ block: 'center' });
}

// ---------- Response history & diff (saved requests) ----------
const respHistory = { items: [], selected: [], requestId: null };

async function loadResponseHistory() {
    const tab = activeTab();
    const el = $('responseHistory');
    if (!tab?.requestId) {
        el.innerHTML = '<div class="empty-state"><div>Save this request to keep a history of its responses</div></div>';
        return;
    }
    respHistory.requestId = tab.requestId;
    respHistory.selected = [];
    try { respHistory.items = await api('GET', `/api/requests/${tab.requestId}/history`); } catch (e) { respHistory.items = []; }
    renderResponseHistory();
}

function renderResponseHistory() {
    const el = $('responseHistory');
    if (!respHistory.items.length) { el.innerHTML = '<div class="empty-state"><div>No responses yet. Send this request to start its history</div></div>'; return; }
    const sel = respHistory.selected;
    el.innerHTML = `<div class="rh-bar"><span class="hint">${sel.length === 2 ? 'Comparing the two selected responses' : 'Tick two responses to compare them'}</span>${sel.length === 2 ? '<button class="btn btn-sm" onclick="respHistory.selected=[];renderResponseHistory()">Clear</button>' : ''}</div>
        <div class="rh-list">${respHistory.items.map((h, i) => `<label class="rh-row${sel.includes(i) ? ' selected' : ''}">
            <input type="checkbox" data-rh="${i}" ${sel.includes(i) ? 'checked' : ''}>
            <span class="status-badge ${statusClass(h.statusCode)}">${h.statusCode || 'ERR'}</span>
            <span class="rh-time">${new Date(h.executedAt).toLocaleString()}</span>
            <span class="hint">${h.responseTimeMs != null ? formatMs(h.responseTimeMs) : ''} · ${formatBytes(h.responseSizeBytes)}</span>
            <button class="btn btn-ghost btn-sm" data-rh-view="${i}">View</button>
        </label>`).join('')}</div>
        <div id="rhDetail"></div>`;
    if (sel.length === 2) showDiff(respHistory.items[Math.max(...sel)], respHistory.items[Math.min(...sel)]);
}

function prettyText(body) {
    try { JSON.parse(body); return prettyJson(body); } catch (e) { return body || ''; }
}

function showDiff(older, newer) {
    const a = prettyText(older.responseBody).split('\n'), b = prettyText(newer.responseBody).split('\n');
    const el = $('rhDetail');
    if (a.length * b.length > 4_000_000) { el.innerHTML = '<div class="hint" style="padding:12px">These responses are too large to diff in the browser.</div>'; return; }
    // LCS table, then walk it to produce the line diff
    const n = a.length, m = b.length;
    const dp = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    const lines = [];
    let i = 0, j = 0, adds = 0, dels = 0;
    while (i < n && j < m) {
        if (a[i] === b[j]) { lines.push([' ', a[i]]); i++; j++; }
        else if (dp[i + 1][j] >= dp[i][j + 1]) { lines.push(['-', a[i++]]); dels++; }
        else { lines.push(['+', b[j++]]); adds++; }
    }
    while (i < n) { lines.push(['-', a[i++]]); dels++; }
    while (j < m) { lines.push(['+', b[j++]]); adds++; }
    const when = h => new Date(h.executedAt).toLocaleTimeString();
    el.innerHTML = `<div class="diff-head"><span>${when(older)} → ${when(newer)}</span><span class="diff-add">+${adds}</span><span class="diff-del">−${dels}</span>${!adds && !dels ? '<span class="hint">Identical bodies</span>' : ''}</div>
        <pre class="diff">${lines.map(([t, l]) => `<div class="d${t === '+' ? 'a' : t === '-' ? 'd' : 'n'}"><span class="dm">${t}</span>${esc(l)}</div>`).join('')}</pre>`;
}

function viewHistoryResponse(i) {
    const h = respHistory.items[i];
    const body = h.responseBody || '';
    let html;
    try { JSON.parse(body); html = highlightJson(prettyJson(body)); } catch (e) { html = esc(body); }
    $('rhDetail').innerHTML = `<div class="diff-head"><span>${new Date(h.executedAt).toLocaleString()}</span><span class="status-badge ${statusClass(h.statusCode)}">${h.statusCode || 'ERR'}</span></div><pre class="diff">${html}</pre>`;
}

function initResponseTools() {
    $('jsonFilter').addEventListener('input', debounce(() => { const r = activeTab()?.result; if (r?.success) renderResponseBody(r); }, 250));
    $('resSearchInput').addEventListener('input', debounce(runResponseSearch, 150));
    $('resSearchInput').addEventListener('keydown', e => {
        if (e.key === 'Enter') { e.preventDefault(); stepResponseSearch(e.shiftKey ? -1 : 1); }
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeResponseSearch(); }
    });
    $('responseBody').addEventListener('click', e => {
        const head = e.target.closest('.jt-head');
        if (head && (e.target.closest('.jt-tog') || e.target.closest('.jt-sum') || e.target.closest('.jp'))) head.parentElement.classList.toggle('collapsed');
    });
    $('responseHistory').addEventListener('change', e => {
        const cb = e.target.closest('[data-rh]');
        if (!cb) return;
        const i = +cb.dataset.rh;
        respHistory.selected = cb.checked ? [...respHistory.selected, i].slice(-2) : respHistory.selected.filter(x => x !== i);
        renderResponseHistory();
    });
    $('responseHistory').addEventListener('click', e => {
        const v = e.target.closest('[data-rh-view]');
        if (v) { e.preventDefault(); viewHistoryResponse(+v.dataset.rhView); }
    });
    $('resTabsBar').addEventListener('click', e => { if (e.target.closest('[data-panel=resHistory]')) loadResponseHistory(); });
    document.addEventListener('keydown', e => {
        if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'f' && activeTab()?.result && !document.querySelector('.modal-overlay.active')) {
            e.preventDefault();
            openResponseSearch();
        }
    });
}

/** Re-indents valid JSON text without parsing values, so 12345678901234567890 and 1.0 stay exactly as sent. */
function prettyJson(src) {
    let out = '', indent = 0, inStr = false;
    const nl = () => '\n' + '  '.repeat(indent);
    for (let i = 0; i < src.length; i++) {
        const c = src[i];
        if (inStr) {
            out += c;
            if (c === '\\') out += src[++i];
            else if (c === '"') inStr = false;
            continue;
        }
        if (c === '"') { inStr = true; out += c; }
        else if (c === '{' || c === '[') {
            let j = i + 1;
            while (j < src.length && /\s/.test(src[j])) j++;
            if (src[j] === (c === '{' ? '}' : ']')) { out += c + src[j]; i = j; }
            else { indent++; out += c + nl(); }
        }
        else if (c === '}' || c === ']') { indent--; out += nl() + c; }
        else if (c === ',') out += ',' + nl();
        else if (c === ':') out += ': ';
        else if (!/\s/.test(c)) out += c;
    }
    return out;
}

/** Token-based so numbers/keywords inside strings are never coloured. */
function highlightJson(json) {
    const re = /("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false)\b|\bnull\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g;
    let out = '', last = 0, m;
    while ((m = re.exec(json))) {
        out += esc(json.slice(last, m.index));
        const tok = esc(m[0]);
        if (m[1]) out += m[2] ? `<span class="j-key">${esc(m[1])}</span>${esc(m[2])}` : `<span class="j-str">${tok}</span>`;
        else if (m[3]) out += `<span class="j-bool">${tok}</span>`;
        else if (m[0] === 'null') out += `<span class="j-null">${tok}</span>`;
        else out += `<span class="j-num">${tok}</span>`;
        last = re.lastIndex;
    }
    return out + esc(json.slice(last));
}

function copyResponseBody() {
    const r = activeTab()?.result;
    if (!r) return;
    copyText(r.responseBody || '').then(() => toast('Response copied'));
}

function downloadResponse() {
    const r = activeTab()?.result;
    if (!r) return;
    const ct = headerValue(r.responseHeaders, 'content-type') || 'text/plain';
    const ext = /json/.test(ct) ? 'json' : /html/.test(ct) ? 'html' : /xml/.test(ct) ? 'xml' : 'txt';
    const name = (activeTab().name || 'response').replace(/[^\w.-]+/g, '_');
    download(`${name}.${ext}`, r.responseBody || '', ct);
}

function displayBulkResults(s) {
    const pct = s.totalRequests ? Math.round(s.successCount * 100 / s.totalRequests) : 0;
    $('bulkResults').innerHTML = `
        <div class="bulk-stats">
            <div class="stat-card"><div class="stat-label">Requests</div><div class="stat-value">${s.totalRequests}</div></div>
            <div class="stat-card"><div class="stat-label">Success</div><div class="stat-value" style="color:var(--green)">${s.successCount} <span class="hint">${pct}%</span></div></div>
            <div class="stat-card"><div class="stat-label">Failed</div><div class="stat-value" style="color:${s.failCount ? 'var(--red)' : 'inherit'}">${s.failCount}</div></div>
            <div class="stat-card"><div class="stat-label">Avg</div><div class="stat-value">${formatMs(s.avgResponseTimeMs)}</div></div>
            <div class="stat-card"><div class="stat-label">Min / Max</div><div class="stat-value" style="font-size:14px">${formatMs(s.minResponseTimeMs)} / ${formatMs(s.maxResponseTimeMs)}</div></div>
            <div class="stat-card"><div class="stat-label">P95</div><div class="stat-value">${formatMs(s.p95ResponseTimeMs)}</div></div>
            <div class="stat-card"><div class="stat-label">Throughput</div><div class="stat-value">${(s.requestsPerSecond || 0).toFixed(1)} <span class="hint">req/s</span></div></div>
            <div class="stat-card"><div class="stat-label">Duration</div><div class="stat-value">${formatMs(s.totalDurationMs)}</div></div>
        </div>
        ${bulkErrorsHtml(s)}
        <div class="field-label">Status codes</div>
        ${(s.statusBreakdown || []).map(b => `<div style="display:flex;gap:10px;align-items:center;margin:6px 0"><span class="status-badge ${statusClass(b.statusCode)}">${b.statusCode || 'ERR'}</span><span>${b.count} <span class="muted">(${b.percentage.toFixed(1)}%)</span></span></div>`).join('')}`;
}

/** Failed requests only show "ERR" in the status breakdown; list the distinct reasons. */
function bulkErrorsHtml(s) {
    const counts = {};
    (s.results || []).filter(r => !r.success).forEach(r => { const m = r.error || 'Request failed'; counts[m] = (counts[m] || 0) + 1; });
    const list = Object.entries(counts);
    if (!list.length) return '';
    return `<div class="field-label">Errors</div><div class="error-box" style="margin-bottom:14px">${list.map(([m, n]) => `${n}× ${esc(m)}`).join('\n')}</div>`;
}

function selectTab(barId, panelId) {
    const bar = $(barId);
    bar.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.panel === panelId));
    const content = bar.closest('.request-panel, .response-panel').querySelector('.tab-content');
    content.querySelectorAll(':scope > .tab-panel').forEach(p => p.classList.toggle('active', p.id === panelId));
}

// ============================================================
// cURL
// ============================================================
function shellQuote(s) { return "'" + String(s).replace(/'/g, "'\\''") + "'"; }

function currentEnvVars() {
    const env = state.environments.find(e => String(e.id) === $('envSelect').value);
    return parseEnvVars(env?.variables);
}
function substituteVars(s, vars) {
    if (s == null) return s;
    return Object.entries(vars).reduce((acc, [k, v]) => acc.split('{{' + k + '}}').join(v), String(s));
}

function buildCurl(rawDto, vars = {}) {
    const dto = prepareForSend(rawDto);
    const sub = s => substituteVars(s, vars);
    const url = composeUrl(dto.url || '', queryRows(dto));
    const parts = [`curl --location --request ${dto.method || 'GET'} ${shellQuote(sub(url))}`];
    const headers = { ...(dto.headers || {}) };
    if (headers._insecure === 'true') parts.push('--insecure');
    delete headers._insecure;
    // Same rule as the server: configured auth replaces an explicit header of the same name
    const auth = dto.authConfig || {};
    if (dto.authType && dto.authConfig) {
        const authHeader = dto.authType === 'apikey' ? (auth.key || 'X-API-Key') : 'Authorization';
        Object.keys(headers).filter(k => k.toLowerCase() === authHeader.toLowerCase()).forEach(k => delete headers[k]);
    }
    if (dto.authType === 'bearer') parts.push(`--header ${shellQuote('Authorization: Bearer ' + sub(auth.token || ''))}`);
    if (dto.authType === 'basic') parts.push(`--user ${shellQuote(sub(auth.username || '') + ':' + sub(auth.password || ''))}`);
    if (dto.authType === 'apikey') parts.push(`--header ${shellQuote((auth.key || 'X-API-Key') + ': ' + sub(auth.value || ''))}`);
    Object.entries(headers).forEach(([k, v]) => parts.push(`--header ${shellQuote(k + ': ' + sub(v))}`));
    if (dto.bodyType === 'form-data' && dto.body) {
        JSON.parse(dto.body).filter(r => r.enabled !== false && r.key).forEach(r => parts.push(`--form ${shellQuote(r.type === 'file' ? `${sub(r.key)}=@"${r.fileName || 'file'}"` : `${sub(r.key)}=${sub(r.value || '')}`)}`));
    } else if (dto.body) parts.push(`--data-raw ${shellQuote(sub(dto.body))}`);
    return parts.join(' \\\n  ');
}

// ---------- Code snippets ----------
/** The request as it goes over the wire: params in the URL, auth turned into headers, variables optionally filled in. */
function wireRequest(rawDto, vars) {
    const dto = prepareForSend(rawDto);
    const sub = v => substituteVars(v, vars);
    const url = sub(composeUrl(dto.url || '', queryRows(dto)));
    const headers = {};
    Object.entries(dto.headers || {}).forEach(([k, v]) => { if (k !== '_insecure') headers[sub(k)] = sub(v); });
    const auth = dto.authConfig || {};
    if (dto.authType && dto.authConfig) {
        const name = dto.authType === 'apikey' ? (auth.key || 'X-API-Key') : 'Authorization';
        Object.keys(headers).filter(k => k.toLowerCase() === name.toLowerCase()).forEach(k => delete headers[k]);
        if (dto.authType === 'bearer') headers.Authorization = 'Bearer ' + sub(auth.token || '');
        if (dto.authType === 'basic') headers.Authorization = 'Basic ' + btoa(unescape(encodeURIComponent(sub(auth.username || '') + ':' + sub(auth.password || ''))));
        if (dto.authType === 'apikey') headers[name] = sub(auth.value || '');
    }
    let form = null, body = null;
    if (dto.bodyType === 'form-data' && dto.body) form = JSON.parse(dto.body).filter(r => r.enabled !== false && r.key).map(r => ({ ...r, key: sub(r.key), value: sub(r.value || '') }));
    else if (dto.body) body = sub(dto.body);
    const insecure = (dto.headers || {})._insecure === 'true' || dto.settings?.insecure;
    return { method: dto.method || 'GET', url, headers, body, form, insecure, timeoutMs: dto.settings?.timeoutMs };
}

const q = s => JSON.stringify(String(s));
const SNIPPETS = {
    curl: (dto, vars) => buildCurl(dto, vars),
    fetch: (dto, vars) => {
        const w = wireRequest(dto, vars);
        const lines = [];
        if (w.form) {
            lines.push('const form = new FormData();');
            w.form.forEach(r => lines.push(r.type === 'file' ? `form.append(${q(r.key)}, fileInput.files[0]); // ${r.fileName || 'choose a file'}` : `form.append(${q(r.key)}, ${q(r.value)});`));
            lines.push('');
        }
        const opts = [`  method: ${q(w.method)},`];
        const hs = Object.entries(w.headers);
        if (hs.length) opts.push('  headers: {', ...hs.map(([k, v]) => `    ${q(k)}: ${q(v)},`), '  },');
        if (w.form) opts.push('  body: form,');
        else if (w.body != null) opts.push(`  body: ${q(w.body)},`);
        if (w.timeoutMs) opts.push(`  signal: AbortSignal.timeout(${w.timeoutMs}),`);
        lines.push(`const response = await fetch(${q(w.url)}, {`, ...opts, '});', '', 'console.log(response.status, await response.text());');
        if (w.insecure) lines.unshift('// Note: browsers can\'t skip SSL verification; in Node set NODE_TLS_REJECT_UNAUTHORIZED=0 for testing only.', '');
        return lines.join('\n');
    },
    python: (dto, vars) => {
        const w = wireRequest(dto, vars);
        const lines = ['import requests', '', `url = ${q(w.url)}`];
        const hs = Object.entries(w.headers);
        if (hs.length) lines.push('headers = {', ...hs.map(([k, v]) => `    ${q(k)}: ${q(v)},`), '}');
        const args = ['url'];
        if (hs.length) args.push('headers=headers');
        if (w.form) {
            const text = w.form.filter(r => r.type !== 'file'), files = w.form.filter(r => r.type === 'file');
            if (text.length) { lines.push('data = {', ...text.map(r => `    ${q(r.key)}: ${q(r.value)},`), '}'); args.push('data=data'); }
            if (files.length) { lines.push('files = {', ...files.map(r => `    ${q(r.key)}: open(${q(r.fileName || 'file')}, "rb"),`), '}'); args.push('files=files'); }
        } else if (w.body != null) { lines.push(`payload = ${q(w.body)}`); args.push('data=payload'); }
        if (w.insecure) args.push('verify=False');
        if (w.timeoutMs) args.push(`timeout=${w.timeoutMs / 1000}`);
        lines.push('', `response = requests.request(${q(w.method)}, ${args.join(', ')})`, 'print(response.status_code, response.text)');
        return lines.join('\n');
    },
    java: (dto, vars) => {
        const w = wireRequest(dto, vars);
        const lines = ['import java.net.URI;', 'import java.net.http.*;', 'import java.time.Duration;', '', 'HttpClient client = HttpClient.newHttpClient();', 'HttpRequest request = HttpRequest.newBuilder()', `        .uri(URI.create(${q(w.url)}))`];
        Object.entries(w.headers).forEach(([k, v]) => lines.push(`        .header(${q(k)}, ${q(v)})`));
        if (w.timeoutMs) lines.push(`        .timeout(Duration.ofMillis(${w.timeoutMs}))`);
        const pub = w.form ? 'HttpRequest.BodyPublishers.noBody() /* multipart needs a helper, e.g. Apache HttpClient MultipartEntityBuilder */'
            : w.body != null ? `HttpRequest.BodyPublishers.ofString(${q(w.body)})` : 'HttpRequest.BodyPublishers.noBody()';
        lines.push(`        .method(${q(w.method)}, ${pub})`, '        .build();', '', 'HttpResponse<String> response = client.send(request, HttpResponse.BodyHandlers.ofString());', 'System.out.println(response.statusCode() + " " + response.body());');
        if (w.insecure) lines.unshift('// Note: this request ignores SSL errors in Reqly; Java needs a custom SSLContext for that.', '');
        return lines.join('\n');
    },
};

let snippetLang = lsGet('reqly.snippetLang', 'curl');
function openSnippetModal() {
    if (!buildRequestDto().url) return toast('Enter a URL first', true);
    renderSnippet();
    openModal('snippetModal');
}
function renderSnippet() {
    document.querySelectorAll('#snippetTabs .tab').forEach(t => t.classList.toggle('active', t.dataset.lang === snippetLang));
    const vars = $('snippetResolve').checked ? currentEnvVars() : {};
    $('snippetCode').textContent = SNIPPETS[snippetLang](buildRequestDto(), vars);
}
function copySnippet() { copyText($('snippetCode').textContent).then(() => toast('Snippet copied')); }
function initSnippets() {
    $('snippetTabs').addEventListener('click', e => { const t = e.target.closest('[data-lang]'); if (t) { snippetLang = t.dataset.lang; lsSet('reqly.snippetLang', snippetLang); renderSnippet(); } });
    $('snippetResolve').addEventListener('change', renderSnippet);
}

async function copyCurl(dto) {
    if (!dto.url) return toast('Nothing to copy: the request has no URL', true);
    await copyText(buildCurl(dto, currentEnvVars()));
    toast('cURL copied to clipboard');
}
function copyCurrentAsCurl() { copyCurl(buildRequestDto()); }

async function copySavedRequestCurl(id) {
    const open = state.tabs.find(t => t.requestId === id);
    if (open && open.id === state.activeTabId) return copyCurl(buildRequestDto());
    copyCurl(open?.dto || await api('GET', `/api/requests/${id}`));
}

// ============================================================
// Saving
// ============================================================
async function saveCurrentRequest() {
    const tab = activeTab();
    const dto = buildRequestDto();
    if (!tab.requestId) return openSaveModal('save');
    try {
        const snapshot = JSON.stringify(dto);
        const saved = await api('POST', '/api/requests', dto);
        // Edits made while the save was in flight keep the tab dirty
        const now = tab.id === state.activeTabId ? buildRequestDto() : tab.dto;
        tab.dirty = JSON.stringify({ ...now, id: dto.id }) !== snapshot;
        tab.requestId = saved.id;
        tab.name = saved.name;
        renderTabs();
        persistTabs();
        await loadTree();
        toast('Saved');
    } catch (e) { toast('Save failed: ' + e.message, true); }
}

function openSaveMenu(ev) {
    openMenu(ev, [
        { label: 'Save', shortcut: MOD + 'S', action: saveCurrentRequest },
        { label: 'Save as…', action: () => openSaveModal('saveAs') },
        '-',
        { label: 'Copy as cURL', icon: 'copy', action: copyCurrentAsCurl },
        { label: 'Code snippet…', icon: 'copy', action: openSnippetModal },
    ]);
}

// --- Folder picker modal (save / save as / move) ---
let picker = { selected: null, mode: 'save', disabled: new Set(), onOk: null, rootLabel: null };

function renderFolderPicker() {
    const rows = [];
    if (picker.rootLabel) rows.push({ id: null, name: picker.rootLabel, depth: 0, root: true });
    const walk = (folders, depth) => folders.forEach(f => { rows.push({ id: f.id, name: f.name, depth }); walk(f.folders, depth + 1); });
    walk(state.tree.collections, 0);
    $('folderPicker').innerHTML = rows.map(r => {
        const dis = r.id != null && picker.disabled.has(r.id);
        return `<div class="folder-option${picker.selected === r.id ? ' selected' : ''}${dis ? ' disabled' : ''}" data-id="${r.id ?? ''}" style="padding-left:${8 + r.depth * 16}px">${icon(r.root ? 'file' : r.depth ? 'folder' : 'collection')}${esc(r.name)}</div>`;
    }).join('') || '<div class="hint" style="padding:8px">No collections yet. Create one below.</div>';
}

function openSaveModal(mode) {
    const tab = activeTab();
    picker = { mode, selected: tab.collectionId ?? state.tree.collections[0]?.id ?? null, disabled: new Set(), rootLabel: null };
    $('saveModalTitle').textContent = mode === 'saveAs' ? 'Save request as' : 'Save request';
    $('saveNameRow').style.display = '';
    $('savePickerLabel').textContent = 'Save to';
    $('saveReqName').value = mode === 'saveAs' && tab.name ? tab.name + ' Copy' : (tab.name || defaultRequestName(buildRequestDto()));
    $('saveModalOk').textContent = 'Save';
    picker.onOk = async () => {
        const name = $('saveReqName').value.trim();
        if (!name) return toast('Name is required', true);
        if (picker.selected == null) return toast('Choose a collection to save into', true);
        const dto = { ...buildRequestDto(), name, collectionId: picker.selected };
        if (mode === 'saveAs') dto.id = null;
        try {
            const saved = await api('POST', '/api/requests', dto);
            closeModal('saveModal');
            if (mode === 'saveAs') {
                newTab({ ...dto, id: saved.id }, { name: saved.name });
            } else {
                Object.assign(tab, { requestId: saved.id, name: saved.name, collectionId: picker.selected, dirty: false });
            }
            state.expanded.add(picker.selected); saveExpanded();
            await loadTree();
            renderTabs(); renderRequestTitle(); persistTabs();
            toast('Saved');
        } catch (e) { toast('Save failed: ' + e.message, true); }
    };
    renderFolderPicker();
    openModal('saveModal');
    setTimeout(() => { $('saveReqName').focus(); $('saveReqName').select(); }, 30);
}

function defaultRequestName(dto) {
    const path = dto.url.replace(/^\w+:\/\//, '').replace(/^\{\{\w+\}\}/, '');
    return path ? `${dto.method} ${path}` : 'New Request';
}

function openMoveModal(type, id) {
    const node = type === 'folder' ? findFolder(id) : findRequestNode(id);
    picker = {
        mode: 'move',
        selected: type === 'folder' ? (node.parentId ?? null) : findRequestParent(id),
        disabled: type === 'folder' ? new Set(descendantFolderIds(node)) : new Set(),
        rootLabel: type === 'folder' ? 'Top level (new collection)' : 'Unsorted',
    };
    $('saveModalTitle').textContent = `Move “${node.name}”`;
    $('saveNameRow').style.display = 'none';
    $('savePickerLabel').textContent = 'Move to';
    $('saveModalOk').textContent = 'Move';
    picker.onOk = async () => {
        try {
            await moveItem(type, id, picker.selected);
            closeModal('saveModal');
        } catch (e) { toast('Move failed: ' + e.message, true); }
    };
    renderFolderPicker();
    openModal('saveModal');
}

async function moveItem(type, id, targetFolderId) {
    if (type === 'folder') await api('PATCH', `/api/collections/${id}`, { parentId: targetFolderId });
    else {
        await api('PATCH', `/api/requests/${id}`, { collectionId: targetFolderId });
        state.tabs.filter(t => t.requestId === id).forEach(t => { t.collectionId = targetFolderId; });
    }
    if (targetFolderId != null) { state.expanded.add(targetFolderId); saveExpanded(); }
    await loadTree();
    renderRequestTitle();
    toast('Moved');
}

async function createFolderInPicker() {
    const name = await uiPrompt('New collection', '', 'Collection name');
    if (!name?.trim()) return openModal('saveModal');
    const col = await api('POST', '/api/collections', { name: name.trim() });
    await loadTree();
    picker.selected = col.id;
    renderFolderPicker();
    openModal('saveModal');
}

// ============================================================
// Tree helpers
// ============================================================
function allFolders(list = state.tree.collections, out = []) { list.forEach(f => { out.push(f); allFolders(f.folders, out); }); return out; }
function findFolder(id) { return allFolders().find(f => f.id === id); }
function findRequestNode(id) {
    for (const f of allFolders()) { const r = f.requests.find(r => r.id === id); if (r) return r; }
    return state.tree.requests.find(r => r.id === id);
}
function findRequestParent(id) { return allFolders().find(f => f.requests.some(r => r.id === id))?.id ?? null; }
function folderPath(id) {
    const path = [];
    for (let f = findFolder(id); f; f = f.parentId != null ? findFolder(f.parentId) : null) path.unshift(f.name);
    return path;
}
function findRequestPath(id) { const p = findRequestParent(id); return p != null ? folderPath(p) : null; }
function descendantFolderIds(folder) { return allFolders([folder]).map(f => f.id); }
function requestIdsIn(folder) { return allFolders([folder]).flatMap(f => f.requests.map(r => r.id)); }
function countRequests(folder) { return requestIdsIn(folder).length; }
function saveExpanded() { lsSet('reqly.expanded', [...state.expanded]); }

async function loadTree() {
    try {
        state.tree = await api('GET', '/api/tree');
    } catch (e) {
        toast('Could not load collections: ' + e.message, true);
        return;
    }
    // Tabs pointing at requests that no longer exist become unsaved drafts
    const ids = new Set([...allFolders().flatMap(f => f.requests.map(r => r.id)), ...state.tree.requests.map(r => r.id)]);
    state.tabs.forEach(t => { if (t.requestId && !ids.has(t.requestId)) { t.requestId = null; t.dirty = true; } });
    if (state.sidebarTab === 'collections') renderSidebar();
    renderRequestTitle();
    renderTabs();
}

// ============================================================
// Sidebar: collections tree
// ============================================================
function hl(text) {
    const q = state.search.trim().toLowerCase();
    if (!q) return esc(text);
    const s = String(text), lower = s.toLowerCase();
    let out = '', i = 0, j;
    while ((j = lower.indexOf(q, i)) >= 0) { out += esc(s.slice(i, j)) + '<mark>' + esc(s.slice(j, j + q.length)) + '</mark>'; i = j + q.length; }
    return out + esc(s.slice(i));
}

function filterFolder(f, q) {
    if (f.name.toLowerCase().includes(q)) return f;
    const folders = f.folders.map(c => filterFolder(c, q)).filter(Boolean);
    const requests = f.requests.filter(r => matchesRequest(r, q));
    return folders.length || requests.length ? { ...f, folders, requests } : null;
}
function matchesRequest(r, q) { return (r.name || '').toLowerCase().includes(q) || (r.url || '').toLowerCase().includes(q) || r.method.toLowerCase() === q; }

function renderSidebar() {
    $('sidebarAddBtn').style.display = state.sidebarTab === 'collections' ? '' : 'none';
    $('sidebarClearBtn').style.display = state.sidebarTab === 'history' ? '' : 'none';
    $('sidebarSearch').placeholder = state.sidebarTab === 'collections' ? 'Search collections' : 'Search history';
    if (state.sidebarTab === 'history') return renderHistory();
    const q = state.search.trim().toLowerCase();
    const folders = q ? state.tree.collections.map(f => filterFolder(f, q)).filter(Boolean) : state.tree.collections;
    const unsorted = q ? state.tree.requests.filter(r => matchesRequest(r, q)) : state.tree.requests;
    let html = folders.map(f => folderHtml(f, 0, !!q)).join('');
    if (unsorted.length) {
        html += `<div class="tree-section" data-drop-root="1"><span>Unsorted</span></div>` + unsorted.map(r => requestHtml(r, 0)).join('');
    }
    if (!html) {
        html = q ? `<div class="sidebar-empty">No results for “${esc(state.search)}”</div>`
            : `<div class="sidebar-empty">${icon('collection')}<div>No collections yet</div><button class="btn" onclick="createFolder(null)">${icon('plus')}Create collection</button><button class="btn btn-ghost" onclick="openImportModal('postman')">${icon('import')}Import from Postman</button></div>`;
    } else if (!unsorted.length && !q) {
        html += `<div class="tree-section" data-drop-root="1" style="opacity:.0;height:30px"></div>`;
    }
    $('sidebarList').innerHTML = html;
    highlightActiveInTree();
}

function folderHtml(f, depth, forceOpen) {
    const open = forceOpen || state.expanded.has(f.id);
    const count = countRequests(f);
    let html = `<div class="tree-row${depth === 0 ? ' collection-root' : ''}${open ? ' open' : ''}" data-type="folder" data-id="${f.id}" draggable="true" style="padding-left:${4 + depth * 14}px">
        ${icon('chevron', 'chev')}${icon(depth === 0 ? 'collection' : 'folder', 'folder-icon')}
        <span class="tree-name">${hl(f.name)}</span><span class="tree-count">${count || ''}</span>
        <span class="row-actions"><button class="icon-btn" data-action="add-request" title="Add request to this folder">${icon('plus')}</button><button class="icon-btn" data-action="menu" title="More actions">${icon('more')}</button></span>
    </div>`;
    if (open) {
        const inner = f.folders.map(c => folderHtml(c, depth + 1, forceOpen)).join('') + f.requests.map(r => requestHtml(r, depth + 1)).join('');
        html += inner || `<div class="tree-empty" style="padding-left:${36 + depth * 14}px">Empty. <a href="#" data-action="add-request" data-folder="${f.id}" style="color:var(--accent);margin-left:4px">Add a request</a></div>`;
    }
    return html;
}

function requestHtml(r, depth) {
    return `<div class="tree-row" data-type="request" data-id="${r.id}" draggable="true" style="padding-left:${4 + depth * 14}px">
        <span class="method-badge method-${methodClass(r.method)}">${shortMethod(r.method)}</span>
        <span class="tree-name">${hl(r.name || r.url)}</span>
        <span class="row-actions"><button class="icon-btn" data-action="menu" title="More actions">${icon('more')}</button></span>
    </div>`;
}

function highlightActiveInTree() {
    const id = activeTab()?.requestId;
    document.querySelectorAll('#sidebarList .tree-row[data-type=request]').forEach(r => r.classList.toggle('active', +r.dataset.id === id));
}

function toggleFolder(id) {
    if (state.expanded.has(id)) state.expanded.delete(id); else state.expanded.add(id);
    saveExpanded();
    renderSidebar();
}

const opening = new Set();
async function openRequest(id, forceNew = false) {
    const existing = state.tabs.find(t => t.requestId === id);
    if (existing && !forceNew) return switchToTab(existing.id);
    if (opening.has(id)) return; // a second click (e.g. double-click) while the first is still loading
    opening.add(id);
    try {
        const dto = await api('GET', `/api/requests/${id}`);
        openInTab(dto, { forceNew, name: dto.name });
    } catch (e) { toast('Could not open request: ' + e.message, true); }
    finally { opening.delete(id); }
}

function folderMenu(ev, id, row) {
    const f = findFolder(id);
    openMenu(ev, [
        { label: 'Add request', icon: 'plus', action: () => createRequestIn(id) },
        { label: 'Add folder', icon: 'folder', action: () => createFolder(id) },
        { label: 'Run', icon: 'play', action: () => openRunner(id) },
        '-',
        { label: 'Rename', action: () => startRename('folder', id) },
        { label: 'Duplicate', action: () => duplicateFolder(id) },
        { label: 'Move to…', action: () => openMoveModal('folder', id) },
        { label: 'Export (Postman v2.1)', icon: 'download', action: () => exportFolder(id) },
        '-',
        { label: 'Delete', icon: 'trash', danger: true, action: () => deleteFolder(f) },
    ], row);
}

function requestMenu(ev, id, row) {
    openMenu(ev, [
        { label: 'Open in new tab', action: () => openRequest(id, true) },
        '-',
        { label: 'Rename', action: () => startRename('request', id) },
        { label: 'Duplicate', action: () => duplicateRequest(id) },
        { label: 'Move to…', action: () => openMoveModal('request', id) },
        { label: 'Copy as cURL', icon: 'copy', action: () => copySavedRequestCurl(id) },
        '-',
        { label: 'Delete', icon: 'trash', danger: true, action: () => deleteRequest(id) },
    ], row);
}

function startRename(type, id) {
    const row = document.querySelector(`#sidebarList .tree-row[data-type="${type}"][data-id="${id}"]`);
    if (!row) return;
    const nameEl = row.querySelector('.tree-name');
    const node = type === 'folder' ? findFolder(id) : findRequestNode(id);
    const input = document.createElement('input');
    input.className = 'rename-input';
    input.value = node.name;
    nameEl.replaceWith(input);
    row.draggable = false;
    input.focus(); input.select();
    let done = false;
    const commit = async save => {
        if (done) return; done = true;
        const name = input.value.trim();
        if (save && name && name !== node.name) {
            try {
                await api('PATCH', type === 'folder' ? `/api/collections/${id}` : `/api/requests/${id}`, { name });
                if (type === 'request') state.tabs.filter(t => t.requestId === id).forEach(t => { t.name = name; });
                persistTabs();
            } catch (e) { toast('Rename failed: ' + e.message, true); }
        }
        await loadTree();
    };
    input.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') commit(true); if (e.key === 'Escape') commit(false); });
    input.addEventListener('blur', () => commit(true));
    input.addEventListener('click', e => e.stopPropagation());
}

async function createFolder(parentId) {
    try {
        const col = await api('POST', '/api/collections', { name: parentId ? 'New Folder' : 'New Collection', parentId });
        if (parentId) state.expanded.add(parentId);
        saveExpanded();
        state.search = ''; $('sidebarSearch').value = '';
        if (state.sidebarTab !== 'collections') switchSidebar('collections');
        await loadTree();
        startRename('folder', col.id);
    } catch (e) { toast('Could not create folder: ' + e.message, true); }
}

async function createRequestIn(folderId) {
    try {
        const saved = await api('POST', '/api/requests', { name: 'New Request', method: 'GET', url: '', bodyType: 'none', headers: {}, params: {}, collectionId: folderId });
        state.expanded.add(folderId); saveExpanded();
        await loadTree();
        const dto = await api('GET', `/api/requests/${saved.id}`);
        openInTab(dto, { name: dto.name });
        startRename('request', saved.id);
    } catch (e) { toast('Could not create request: ' + e.message, true); }
}

async function duplicateFolder(id) {
    try {
        const copy = await api('POST', `/api/collections/${id}/duplicate`);
        await loadTree();
        toast(`Duplicated as “${copy.name}”`);
    } catch (e) { toast('Duplicate failed: ' + e.message, true); }
}

async function duplicateRequest(id) {
    try {
        const copy = await api('POST', `/api/requests/${id}/duplicate`);
        await loadTree();
        openInTab(copy, { forceNew: true, name: copy.name });
        toast(`Duplicated as “${copy.name}”`);
    } catch (e) { toast('Duplicate failed: ' + e.message, true); }
}

async function deleteFolder(f) {
    const n = countRequests(f);
    const ok = await uiConfirm(`Delete “${f.name}”?`, `This permanently deletes the folder${f.folders.length ? ', its sub-folders' : ''}${n ? ` and <b>${n} request${n > 1 ? 's' : ''}</b>` : ''}. This can't be undone.`);
    if (!ok) return;
    const ids = requestIdsIn(f);
    try {
        await api('DELETE', `/api/collections/${f.id}`);
        detachTabs(ids);
        await loadTree();
        toast('Deleted');
    } catch (e) { toast('Delete failed: ' + e.message, true); }
}

async function deleteRequest(id) {
    const r = findRequestNode(id);
    const ok = await uiConfirm(`Delete “${r?.name}”?`, 'This permanently deletes the saved request. This can\'t be undone.');
    if (!ok) return;
    try {
        await api('DELETE', `/api/requests/${id}`);
        detachTabs([id]);
        await loadTree();
        toast('Deleted');
    } catch (e) { toast('Delete failed: ' + e.message, true); }
}

/** Open tabs for deleted requests stay open as unsaved drafts. */
function detachTabs(requestIds) {
    state.tabs.filter(t => requestIds.includes(t.requestId)).forEach(t => { t.requestId = null; t.collectionId = null; t.dirty = true; });
    renderTabs(); renderRequestTitle(); persistTabs();
}

function exportFolder(id) {
    const a = document.createElement('a');
    a.href = `/api/collections/${id}/export`;
    a.download = '';
    a.click();
}

// Drag & drop between folders
let dragItem = null;
function initTreeDnd() {
    const list = $('sidebarList');
    list.addEventListener('dragstart', e => {
        const row = e.target.closest('.tree-row');
        if (!row) return;
        dragItem = { type: row.dataset.type, id: +row.dataset.id };
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', row.dataset.type + ':' + row.dataset.id);
    });
    const target = e => {
        const t = e.target.closest('.tree-row[data-type=folder], .tree-row[data-type=request], [data-drop-root]');
        // only requests can be dropped between requests
        if (t?.dataset.type === 'request' && dragItem?.type !== 'request') return null;
        if (t?.dataset.type === 'request' && +t.dataset.id === dragItem?.id) return null;
        return t;
    };
    const clearMarks = () => list.querySelectorAll('.drop-target, .drop-before').forEach(el => el.classList.remove('drop-target', 'drop-before'));
    list.addEventListener('dragover', e => {
        const t = target(e);
        if (!dragItem || !t) return;
        if (t.dataset.type === 'folder' && dragItem.type === 'folder' && descendantFolderIds(findFolder(dragItem.id)).includes(+t.dataset.id)) return;
        e.preventDefault();
        clearMarks();
        t.classList.add(t.dataset.type === 'request' ? 'drop-before' : 'drop-target');
    });
    list.addEventListener('dragleave', e => { const t = target(e); if (t && !t.contains(e.relatedTarget)) t.classList.remove('drop-target', 'drop-before'); });
    list.addEventListener('drop', async e => {
        const t = target(e);
        clearMarks();
        if (!dragItem || !t) return;
        e.preventDefault();
        if (t.dataset.type === 'request') {
            const item = dragItem; dragItem = null;
            try { await placeRequestBefore(item.id, +t.dataset.id); } catch (err) { toast('Move failed: ' + err.message, true); }
            return;
        }
        const dest = t.dataset.type === 'folder' ? +t.dataset.id : null;
        const item = dragItem; dragItem = null;
        const currentParent = item.type === 'folder' ? findFolder(item.id).parentId ?? null : findRequestParent(item.id);
        if (dest === currentParent || (item.type === 'folder' && dest === item.id)) return;
        try { await moveItem(item.type, item.id, dest); } catch (err) { toast('Move failed: ' + err.message, true); }
    });
    list.addEventListener('dragend', () => { dragItem = null; clearMarks(); });
}

/** Moves a request next to another one (into its folder if needed) and saves the new order. */
async function placeRequestBefore(id, beforeId) {
    const dest = findRequestParent(beforeId);
    if (findRequestParent(id) !== dest) {
        await api('PATCH', `/api/requests/${id}`, { collectionId: dest });
        state.tabs.filter(t => t.requestId === id).forEach(t => { t.collectionId = dest; });
    }
    const siblings = (dest != null ? findFolder(dest).requests : state.tree.requests).map(r => r.id).filter(x => x !== id);
    siblings.splice(siblings.indexOf(beforeId), 0, id);
    await api('POST', '/api/requests/reorder', siblings);
    await loadTree();
}

// ============================================================
// Sidebar: history
// ============================================================
async function loadHistory() {
    try { state.history = await api('GET', '/api/history'); } catch (e) { state.history = []; }
    if (state.sidebarTab === 'history') renderHistory();
}

function dayLabel(iso) {
    const d = new Date(iso), today = new Date();
    const yest = new Date(); yest.setDate(today.getDate() - 1);
    if (d.toDateString() === today.toDateString()) return 'Today';
    if (d.toDateString() === yest.toDateString()) return 'Yesterday';
    return d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
}

function renderHistory() {
    const q = state.search.trim().toLowerCase();
    const items = state.history.map((h, i) => ({ h, i })).filter(({ h }) => !q || h.url.toLowerCase().includes(q) || h.method.toLowerCase() === q);
    if (!items.length) {
        $('sidebarList').innerHTML = `<div class="sidebar-empty">${icon('history')}<div>${q ? 'No matching requests' : 'Requests you send will show up here'}</div></div>`;
        return;
    }
    let html = '', lastDay = null;
    items.forEach(({ h, i }) => {
        const day = dayLabel(h.executedAt);
        if (day !== lastDay) { html += `<div class="tree-section">${day}</div>`; lastDay = day; }
        const time = new Date(h.executedAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
        const htip = `${h.method} ${h.url}\n${h.statusCode ? `${h.statusCode} ${STATUS_TEXT[h.statusCode] || ''}` : 'No response'}${h.responseTimeMs != null ? ` · ${formatMs(h.responseTimeMs)}` : ''} · ${new Date(h.executedAt).toLocaleString()}\nClick to open with its response`;
        html += `<div class="history-row" data-hist="${i}" title="${esc(htip)}">
            <span class="method-badge method-${methodClass(h.method)}">${shortMethod(h.method)}</span>
            <span class="history-url">${hl(h.url.replace(/^https?:\/\//, ''))}</span>
            <span class="history-meta"><span class="${statusClass(h.statusCode).replace('status-', 'c-')}" style="color:${h.statusCode >= 400 || !h.statusCode ? 'var(--red)' : 'var(--green)'}">${h.statusCode || 'ERR'}</span> · ${time}</span>
        </div>`;
    });
    $('sidebarList').innerHTML = html;
}

function openHistoryItem(h) {
    const parse = s => { try { return s ? JSON.parse(s) : null; } catch (e) { return null; } };
    const dto = { method: h.method, url: h.url, headers: parse(h.requestHeaders) || {}, body: h.requestBody, bodyType: h.requestBody ? 'raw' : 'none' };
    const result = h.statusCode ? {
        success: true, statusCode: h.statusCode, responseBody: h.responseBody, responseHeaders: parse(h.responseHeaders) || {},
        responseTimeMs: h.responseTimeMs, responseSizeBytes: h.responseSizeBytes, testResults: parse(h.testResults) || [],
    } : null;
    const tab = openInTab(dto, { result });
    if (result && tab.id === state.activeTabId) displayResponse(result);
}

async function clearHistory() {
    if (!(await uiConfirm('Clear history?', 'All entries in your request history will be deleted.', 'Clear'))) return;
    await api('DELETE', '/api/history');
    state.history = [];
    renderHistory();
}

function switchSidebar(tab) {
    state.sidebarTab = tab;
    document.querySelectorAll('.sidebar-tab').forEach(t => t.classList.toggle('active', t.dataset.side === tab));
    state.search = ''; $('sidebarSearch').value = '';
    if (tab === 'history') loadHistory();
    renderSidebar();
}

// ============================================================
// Environments
// ============================================================
let editingEnvId = null;

function parseEnvVars(json) {
    if (!json) return {};
    try { const v = JSON.parse(json); return v && typeof v === 'object' ? v : {}; } catch (e) { return {}; }
}

async function loadEnvironments() {
    try { state.environments = await api('GET', '/api/environments'); } catch (e) { state.environments = []; }
    const sel = $('envSelect');
    const current = sel.value || String(lsGet('reqly.env', ''));
    sel.innerHTML = '<option value="">No environment</option>' + state.environments.map(e => `<option value="${e.id}">${esc(e.name)}</option>`).join('');
    sel.value = state.environments.some(e => String(e.id) === current) ? current : '';
    renderUrlMirror();
}

async function openEnvModal(envId) {
    openModal('envModal');
    await loadEnvironments();
    const target = state.environments.find(e => e.id === envId)
        || state.environments.find(e => String(e.id) === $('envSelect').value)
        || state.environments[0];
    if (target) selectEnv(target.id); else newEnvironment();
}

function renderEnvList() {
    const activeId = $('envSelect').value;
    $('envList').innerHTML = state.environments.map(e =>
        `<div class="env-item${e.id === editingEnvId ? ' active' : ''}" data-env="${e.id}" title="${esc(e.name)}${String(e.id) === activeId ? '\nActive environment' : ''}"><span class="name">${esc(e.name)}</span>${String(e.id) === activeId ? '<span class="in-use" title="Active"></span>' : ''}</div>`
    ).join('') || '<div class="hint" style="padding:8px">No environments yet</div>';
}

function selectEnv(id) {
    const env = state.environments.find(e => e.id === id);
    if (!env) return;
    editingEnvId = id;
    renderEnvEditor(env.name, parseEnvVars(env.variables), parseSecrets(env.secrets));
    renderEnvList();
}

function newEnvironment() {
    editingEnvId = null;
    renderEnvList();
    renderEnvEditor('New Environment', {});
    const n = $('envName'); n.focus(); n.select();
}

function renderEnvEditor(name, vars, secrets = []) {
    const isActive = editingEnvId != null && String(editingEnvId) === $('envSelect').value;
    $('envEditor').innerHTML = `
        <input type="text" class="env-name-input" id="envName" value="${esc(name)}" placeholder="Environment name" />
        <div class="env-table-wrap"><div id="envVarsEditor"></div></div>
        <div class="env-editor-foot">
            <div class="hint">Reference variables as <code>{{name}}</code> in the URL, params, headers, body and auth.</div>
            <div style="display:flex;gap:8px">
                ${editingEnvId ? `<button class="btn btn-ghost" onclick="deleteEnv(${editingEnvId})" style="color:var(--red)">${icon('trash')}Delete</button>
                <button class="btn" onclick="duplicateEnv(${editingEnvId})" title="Make a copy of this environment">Duplicate</button>
                <button class="btn" onclick="activateEnv(${editingEnvId})" ${isActive ? 'disabled' : ''} title="Use this environment when sending requests">${isActive ? 'Active' : 'Set active'}</button>` : ''}
                <button class="btn btn-primary" onclick="saveEnvironment()">Save</button>
            </div>
        </div>`;
    if (!kvConfig.envVarsEditor) kvConfig.envVarsEditor = { toggle: false, secrets: true, keyLabel: 'Variable', valLabel: 'Value', keyPh: 'Add variable', valPh: 'Value' };
    const ed = $('envVarsEditor');
    ed.addEventListener('input', e => { const tr = e.target.closest('tr'); if (tr?.classList.contains('placeholder')) promoteKvRow('envVarsEditor', tr); });
    ed.addEventListener('click', e => {
        const d = e.target.closest('.row-del');
        if (d) return d.closest('tr').remove();
        const lock = e.target.closest('.row-secret');
        if (lock) {
            const on = lock.classList.toggle('active');
            lock.closest('tr').querySelector('[data-v]').type = on ? 'password' : 'text';
        }
    });
    // Secret values are revealed only while their field is focused
    ed.addEventListener('focusin', e => { if (e.target.matches('[data-v][type=password]')) e.target.type = 'text'; });
    ed.addEventListener('focusout', e => { if (e.target.matches('[data-v]') && e.target.closest('tr').querySelector('.row-secret.active')) e.target.type = 'password'; });
    setKv('envVarsEditor', mapToRows(vars, true).map(r => ({ ...r, secret: secrets.includes(r.key) })), true);
}

async function saveEnvironment() {
    const name = $('envName').value.trim();
    if (!name) return toast('Environment name is required', true);
    const rows = getKv('envVarsEditor');
    const variables = JSON.stringify(rowsToMap(rows, true));
    const secrets = JSON.stringify(rows.filter(r => r.secret && r.key).map(r => r.key));
    try {
        const saved = await api('POST', '/api/environments', { id: editingEnvId, name, variables, secrets });
        await loadEnvironments();
        selectEnv(saved.id);
        toast('Environment saved');
    } catch (e) { toast('Save failed: ' + e.message, true); }
}

async function duplicateEnv(id) {
    const env = state.environments.find(e => e.id === id);
    const saved = await api('POST', '/api/environments', { name: env.name + ' Copy', variables: env.variables, secrets: env.secrets || '[]' });
    await loadEnvironments();
    selectEnv(saved.id);
}

function activateEnv(id) {
    $('envSelect').value = String(id);
    lsSet('reqly.env', String(id));
    renderEnvList();
    selectEnv(id);
}

async function deleteEnv(id) {
    const env = state.environments.find(e => e.id === id);
    if (!(await uiConfirm(`Delete “${env?.name}”?`, 'The environment and all its variables will be deleted.'))) return;
    await api('DELETE', `/api/environments/${id}`);
    if ($('envSelect').value === String(id)) { $('envSelect').value = ''; lsSet('reqly.env', ''); }
    editingEnvId = null;
    await loadEnvironments();
    if (state.environments[0]) selectEnv(state.environments[0].id); else newEnvironment();
}

function toggleEnvQuickLook(ev) {
    ev.stopPropagation();
    const pop = $('envPopover');
    if (pop.classList.contains('active')) { pop.classList.remove('active'); return; }
    const env = state.environments.find(e => String(e.id) === $('envSelect').value);
    const vars = Object.entries(parseEnvVars(env?.variables));
    pop.innerHTML = `<div class="popover-head"><span>${env ? esc(env.name) : 'No environment selected'}</span><button class="btn btn-sm" onclick="$('envPopover').classList.remove('active');openEnvModal(${env?.id ?? 'undefined'})">${env ? 'Edit' : 'Manage'}</button></div>
        <div class="popover-body">${env ? (vars.length ? `<table>${vars.map(([k, v]) => `<tr><td>${esc(k)}${isSecretVar(k, env) ? ' ' + icon('lock', 'muted') : ''}</td><td>${esc(displayValue(k, v, env))}</td></tr>`).join('')}</table>` : '<div class="hint" style="padding:10px 12px">No variables in this environment</div>')
            : '<div class="hint" style="padding:10px 12px">Pick an environment to use its {{variables}} in requests.</div>'}</div>`;
    const r = $('envQuickLookBtn').getBoundingClientRect();
    pop.style.top = (r.bottom + 6) + 'px';
    pop.style.left = Math.max(8, r.right - 380) + 'px';
    pop.classList.add('active');
}

// ============================================================
// Import
// ============================================================
let importMode = 'curl';

function openImportModal(mode = 'curl') {
    setImportMode(mode);
    openModal('importModal');
    setTimeout(() => $(mode === 'curl' ? 'curlInput' : 'postmanInput').focus(), 30);
}

function setImportMode(mode) {
    importMode = mode;
    document.querySelectorAll('#importTabs .tab').forEach(t => t.classList.toggle('active', t.dataset.import === mode));
    $('importCurlPane').style.display = mode === 'curl' ? '' : 'none';
    $('importPostmanPane').style.display = mode === 'postman' ? '' : 'none';
    $('importBackupPane').style.display = mode === 'backup' ? '' : 'none';
    $('importBtn').textContent = mode === 'backup' ? 'Restore' : 'Import';
}

async function importCurlText(curl, intoCurrent = false) {
    const dto = await api('POST', '/api/import/curl', { curl });
    if (intoCurrent) {
        const tab = activeTab();
        tab.dto = { ...dto, id: tab.requestId, name: tab.name };
        loadRequestToUI(tab.dto);
        markDirty();
        renderTabs();
    } else {
        openInTab(dto, { dirty: true });
    }
}

async function runImport() {
    const btn = $('importBtn');
    btn.disabled = true;
    try {
        if (importMode === 'curl') {
            const curl = $('curlInput').value.trim();
            if (!curl) return toast('Paste a cURL command first', true);
            await importCurlText(curl);
            $('curlInput').value = '';
            closeModal('importModal');
        } else if (importMode === 'backup') {
            const file = $('backupFile').files[0];
            if (!file) return toast('Choose a backup file first', true);
            const res = await api('POST', '/api/import/all', await file.text());
            await Promise.all([loadTree(), loadEnvironments()]);
            closeModal('importModal');
            $('backupFile').value = ''; $('backupFileName').textContent = 'Choose a reqly-backup-….json file…';
            toast(`Restored ${res.collections} collection${res.collections === 1 ? '' : 's'}, ${res.requests} requests, ${res.environments} environment${res.environments === 1 ? '' : 's'}`);
        } else {
            const json = $('postmanInput').value.trim();
            if (!json) return toast('Choose or paste a Postman collection first', true);
            const res = await api('POST', '/api/import/postman', json);
            state.expanded.add(res.collectionId); saveExpanded();
            await Promise.all([loadTree(), loadEnvironments()]);
            closeModal('importModal');
            $('postmanInput').value = ''; $('postmanFileName').textContent = 'Choose a Postman collection (.json, v2.0 / v2.1)…';
            toast(`Imported “${res.name}”: ${res.requests} request${res.requests === 1 ? '' : 's'}${res.environmentId ? ' + environment' : ''}`);
        }
    } catch (e) {
        toast('Import failed: ' + e.message, true);
    } finally {
        btn.disabled = false;
    }
}

// ============================================================
// Collection runner
// ============================================================
const runner = { folderId: null, items: [], running: false, stop: false, data: null };

// --- Data files: each row is one iteration, columns become {{variables}} ---

/** RFC 4180-style CSV: quoted fields, "" escapes, commas/newlines inside quotes, CRLF, BOM. */
function parseCsv(text) {
    const rows = [];
    let row = [], field = '', inQuotes = false;
    text = text.replace(/^﻿/, '');
    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (inQuotes) {
            if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
            else if (c === '"') inQuotes = false;
            else field += c;
        } else if (c === '"') inQuotes = true;
        else if (c === ',') { row.push(field); field = ''; }
        else if (c === '\n' || c === '\r') {
            if (c === '\r' && text[i + 1] === '\n') i++;
            row.push(field); rows.push(row); row = []; field = '';
        } else field += c;
    }
    if (field || row.length) { row.push(field); rows.push(row); }
    const nonEmpty = rows.filter(r => r.some(v => v.trim() !== ''));
    if (nonEmpty.length < 2) throw new Error('The CSV needs a header row and at least one data row');
    const columns = nonEmpty[0].map(h => h.trim());
    if (columns.some(c => !c)) throw new Error('Every column in the header row needs a name');
    return { columns, rows: nonEmpty.slice(1).map(r => Object.fromEntries(columns.map((c, i) => [c, r[i] ?? '']))) };
}

function parseJsonData(text) {
    const data = JSON.parse(text);
    if (!Array.isArray(data) || !data.length || data.some(r => !r || typeof r !== 'object' || Array.isArray(r))) {
        throw new Error('JSON data must be a non-empty array of objects, e.g. [{"id": 1}, {"id": 2}]');
    }
    const columns = [...new Set(data.flatMap(Object.keys))];
    const str = v => v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
    return { columns, rows: data.map(r => Object.fromEntries(columns.map(c => [c, str(r[c])]))) };
}

async function loadRunnerData(file) {
    try {
        const text = await file.text();
        const isJson = /\.json$/i.test(file.name) || /^\s*\[/.test(text);
        runner.data = { name: file.name, ...(isJson ? parseJsonData(text) : parseCsv(text)) };
    } catch (e) {
        runner.data = null;
        toast('Could not read data file: ' + e.message, true);
    }
    $('runnerDataFile').value = '';
    renderRunnerData();
}

function clearRunnerData() {
    runner.data = null;
    renderRunnerData();
}

function renderRunnerData() {
    const d = runner.data;
    const iter = $('runnerIterations');
    $('runnerDataName').textContent = d ? d.name : 'Select CSV or JSON…';
    $('runnerDataClear').style.display = d ? '' : 'none';
    document.querySelector('.data-file').classList.toggle('loaded', !!d);
    iter.disabled = !!d;
    if (d) iter.value = d.rows.length;
    iter.removeAttribute('title');
    iter.dataset.tip = d ? 'One iteration per data row' : 'Run the selected requests this many times';
    $('runnerDataInfo').innerHTML = d
        ? `${d.rows.length} row${d.rows.length === 1 ? '' : 's'} · ${d.columns.map(c => `<code>{{${esc(c)}}}</code>`).join(' ')}`
        : '';
    renderRunnerPlan();
}

/** Before a run: what will happen, plus a short look at the data. */
function renderRunnerPlan() {
    if (runner.running || !$('runnerModal').classList.contains('active') && !runner.items.length) return;
    const d = runner.data;
    const selected = document.querySelectorAll('#runnerList [data-run]:checked').length;
    const iterations = d ? d.rows.length : Math.max(1, +$('runnerIterations').value || 1);
    const total = selected * iterations;
    $('runnerSummary').innerHTML = `<span class="muted">${runner.items.length} request${runner.items.length === 1 ? '' : 's'} in this folder</span>`;
    const PREVIEW = 8;
    const preview = d ? `<div class="data-preview">
            <div class="section-title">Data <span class="muted">${esc(d.name)}</span></div>
            <table><thead><tr><th class="idx">#</th>${d.columns.map(c => `<th>${esc(c)}</th>`).join('')}</tr></thead>
            <tbody>${d.rows.slice(0, PREVIEW).map((r, i) => `<tr><td class="idx">${i + 1}</td>${d.columns.map(c => `<td title="${esc(r[c])}">${esc(r[c])}</td>`).join('')}</tr>`).join('')}</tbody></table>
            ${d.rows.length > PREVIEW ? `<div class="more">+ ${d.rows.length - PREVIEW} more row${d.rows.length - PREVIEW === 1 ? '' : 's'}</div>` : ''}
        </div>` : '';
    $('runnerRows').innerHTML = `<div class="run-plan">
            <div class="plan-card">
                <div class="plan-total">${total}</div>
                <div><div class="plan-title">request${total === 1 ? '' : 's'} will be sent</div>
                <div class="muted">${selected} selected × ${iterations} ${d ? `data row${iterations === 1 ? '' : 's'}` : `iteration${iterations === 1 ? '' : 's'}`}</div></div>
            </div>
            ${preview}
        </div>`;
}

/** Data values win over environment values (as in Postman): they're substituted here, before the server applies the environment. */
function applyDataVars(dto, vars) {
    if (!vars || !Object.keys(vars).length) return dto;
    const sub = s => substituteVars(s, vars);
    const subMap = m => m ? Object.fromEntries(Object.entries(m).map(([k, v]) => [sub(k), sub(v)])) : m;
    return { ...dto, url: sub(dto.url), params: subMap(dto.params), paramRows: dto.paramRows?.map(r => ({ ...r, key: sub(r.key), value: sub(r.value) })), headers: subMap(dto.headers), body: sub(dto.body), authConfig: subMap(dto.authConfig), testScript: sub(dto.testScript) };
}

function openRunner(folderId) {
    const f = findFolder(folderId);
    if (runner.folderId !== folderId) runner.data = null;
    runner.folderId = folderId;
    runner.items = [];
    const walk = (folder, prefix) => {
        folder.requests.forEach(r => runner.items.push({ ...r, path: prefix }));
        folder.folders.forEach(c => walk(c, prefix ? `${prefix} / ${c.name}` : c.name));
    };
    walk(f, '');
    $('runnerTitle').textContent = `Run “${f.name}”`;
    $('runnerEnv').innerHTML = $('envSelect').innerHTML;
    $('runnerEnv').value = $('envSelect').value;
    $('runnerAll').checked = true;
    $('runnerList').innerHTML = runner.items.map((r, i) => `<label title="${esc(`${r.path ? r.path + ' / ' : ''}${r.name}\n${r.method} ${r.url || ''}`)}"><input type="checkbox" data-run="${i}" checked><span class="method-badge method-${methodClass(r.method)}">${shortMethod(r.method)}</span><span class="tree-name">${esc(r.name)}</span></label>`).join('')
        || '<div class="hint" style="padding:8px">This folder has no requests</div>';
    $('runnerSummary').innerHTML = `<span class="muted">${runner.items.length} request${runner.items.length === 1 ? '' : 's'} in this folder</span>`;
    $('runnerProgress').style.width = '0';
    setRunnerButton(false);
    renderRunnerData();
    openModal('runnerModal');
}

function setRunnerButton(running) {
    const b = $('runnerStartBtn');
    b.innerHTML = running ? '<span class="spinner"></span>Stop' : `${icon('play')}Run`;
    b.className = 'btn runner-start ' + (running ? 'btn-danger' : 'btn-primary');
}

function closeRunner() {
    runner.stop = true;
    closeModal('runnerModal');
}

async function startRunner() {
    if (runner.running) { runner.stop = true; return; }
    const selected = [...document.querySelectorAll('#runnerList [data-run]:checked')].map(cb => runner.items[+cb.dataset.run]);
    if (!selected.length) return toast('Select at least one request', true);
    const data = runner.data;
    const iterations = data ? data.rows.length : Math.max(1, +$('runnerIterations').value || 1);
    const delay = Math.max(0, +$('runnerDelay').value || 0);
    const parallel = Math.max(1, +$('runnerParallel').value || 1);
    const envId = $('runnerEnv').value;
    const stopOnFail = $('runnerStopOnFail').checked;
    runner.running = true; runner.stop = false;
    runner.report = { folder: findFolder(runner.folderId)?.name, environment: $('runnerEnv').selectedOptions[0]?.textContent, startedAt: new Date().toISOString(), iterations, parallel, dataFile: data?.name || null, results: [] };
    setRunnerButton(true);
    $('runnerReportBtns').style.display = 'none';
    $('runnerRows').innerHTML = '';
    const total = selected.length * iterations;
    const stats = { done: 0, passed: 0, failed: 0, errors: 0, time: 0 };
    const started = Date.now();
    const updateSummary = () => {
        $('runnerSummary').innerHTML = `<span><b>${stats.done}</b> / ${total} run</span><span style="color:var(--green)"><b>${stats.passed}</b> tests passed</span><span style="color:${stats.failed ? 'var(--red)' : 'inherit'}"><b>${stats.failed}</b> failed</span>${stats.errors ? `<span style="color:var(--red)"><b>${stats.errors}</b> errors</span>` : ''}<span class="muted">avg ${stats.done ? formatMs(Math.round(stats.time / stats.done)) : '—'} · total ${formatMs(Date.now() - started)}</span>`;
        $('runnerProgress').style.width = (stats.done * 100 / total) + '%';
    };
    updateSummary();

    const runOne = async (item, it, rowVars) => {
        let result, failed = false;
        try {
            let dto = applyDataVars(await api('GET', `/api/requests/${item.id}`), rowVars);
            const ctx = createScriptContext(dto, { requestName: item.name, iterationData: rowVars, iteration: it - 1, envId });
            if (dto.preRequestScript) dto = await runPreRequest(ctx, dto.preRequestScript);
            result = await api('POST', '/api/execute' + (envId ? `?environmentId=${envId}` : ''), prepareForSend(dto));
            logNetwork(`Runner · ${item.name}`, wireRequest(dto, parseEnvVars(state.environments.find(e => String(e.id) === envId)?.variables)), result);
            if (dto.postResponseScript) await runPostResponse(ctx, dto.postResponseScript, result);
            if (ctx.tests.length) result.testResults = [...(result.testResults || []), ...ctx.tests];
            // the next request in the run must see values captured or set by this one
            if (result.captureEnvironment) await loadEnvironments();
        } catch (e) {
            result = { success: false, error: e.message, testResults: [] };
        }
        const tests = result.testResults || [];
        const passed = tests.filter(t => t.passed).length;
        stats.done++;
        stats.passed += passed;
        stats.failed += tests.length - passed;
        stats.time += result.responseTimeMs || 0;
        if (!result.success) { stats.errors++; failed = true; }
        if (passed < tests.length) failed = true;
        runner.report.results.push({ iteration: it, request: item.name, path: item.path, method: item.method, url: item.url, data: rowVars, status: result.statusCode || null, timeMs: result.responseTimeMs ?? null, error: result.success ? null : result.error, tests: tests.map(t => ({ name: t.testName, passed: t.passed, message: t.message })), captures: (result.captures || []).map(c => ({ name: c.name, ok: c.ok })) });
        const row = document.createElement('div');
        row.className = 'run-row';
        row.innerHTML = `<div class="run-row-head">
                <span class="method-badge method-${methodClass(item.method)}">${shortMethod(item.method)}</span>
                <span class="tree-name">${esc(item.name)}${iterations > 1 ? ` <span class="hint">#${it}</span>` : ''}${item.path ? ` <span class="hint">${esc(item.path)}</span>` : ''}</span>
                ${result.success ? `<span class="status-badge ${statusClass(result.statusCode)}">${result.statusCode} ${STATUS_TEXT[result.statusCode] || ''}</span><span class="hint">${formatMs(result.responseTimeMs)}</span>` : '<span class="status-badge status-err">Error</span>'}
                ${tests.length ? `<span class="test-tag ${passed === tests.length ? 'pass' : 'fail'}">${passed}/${tests.length}</span>` : ''}
                <button class="icon-btn" title="Open request" onclick="closeRunner();openRequest(${item.id})">${icon('chevron')}</button>
            </div>
            ${rowVars ? `<div class="run-iter" title="${esc(Object.entries(rowVars).map(([k, v]) => `${k} = ${v}`).join('\n'))}">row ${it}: ${esc(Object.entries(rowVars).map(([k, v]) => `${k}=${v}`).join(', '))}</div>` : ''}
            ${!result.success ? `<div class="tests"><div style="color:var(--red)">${esc(result.error || 'Request failed')}</div></div>` : ''}
            ${(result.captures || []).length ? `<div class="tests">${result.captures.map(c => `<div style="color:${c.ok ? 'var(--accent)' : 'var(--yellow)'}">${c.ok ? '↧' : '!'} {{${esc(c.name)}}} ${c.ok ? '= ' + esc(displayValue(c.name, c.value)) : esc(c.message || '')}</div>`).join('')}</div>` : ''}
            ${tests.length ? `<div class="tests">${tests.map(t => `<div style="color:${t.passed ? 'var(--green)' : 'var(--red)'}">${t.passed ? '✓' : '✗'} ${esc(t.testName)}${t.passed ? '' : ` <span class="muted">${esc(t.message || '')}</span>`}</div>`).join('')}</div>` : ''}`;
        $('runnerRows').appendChild(row);
        row.scrollIntoView({ block: 'nearest' });
        updateSummary();
        if (failed && stopOnFail) runner.stop = true;
        if (delay) await new Promise(r => setTimeout(r, delay));
    };

    // Each iteration runs its requests in order, or with up to `parallel` in flight at once
    for (let it = 1; it <= iterations && !runner.stop; it++) {
        const rowVars = data ? data.rows[it - 1] : null;
        const queue = [...selected];
        const worker = async () => { while (queue.length && !runner.stop) await runOne(queue.shift(), it, rowVars); };
        await Promise.all(Array.from({ length: Math.min(parallel, queue.length) }, worker));
    }

    runner.running = false;
    runner.report.finishedAt = new Date().toISOString();
    runner.report.summary = { ...stats, durationMs: Date.now() - started, stopped: runner.stop };
    setRunnerButton(false);
    $('runnerReportBtns').style.display = '';
    updateSummary();
    if (runner.stop) toast(stopOnFail && stats.done < total ? 'Stopped at the first failure' : 'Run stopped');
    playSound(!stats.failed && !stats.errors ? 'win' : 'fail');
    if (isScifi()) {
        const win = !runner.stop && !stats.failed && !stats.errors;
        const banner = document.createElement('div');
        banner.className = 'mission-banner ' + (win ? 'win' : 'lose');
        banner.innerHTML = `<b>${runner.stop ? 'Mission aborted' : win ? 'Mission complete' : 'Mission failed'}</b><span>${stats.done} requests · ${stats.passed} tests passed · ${stats.failed} failed${stats.errors ? ` · ${stats.errors} errors` : ''}</span>`;
        $('runnerRows').prepend(banner);
        $('runnerRows').scrollTop = 0;
    }
}

function exportRunnerReport(format) {
    const r = runner.report;
    if (!r) return;
    const stamp = r.startedAt.slice(0, 19).replace(/[T:]/g, '-');
    const base = `reqly-run-${(r.folder || 'collection').replace(/[^\w.-]+/g, '_')}-${stamp}`;
    if (format === 'json') return download(base + '.json', JSON.stringify(r, null, 2), 'application/json');
    const s = r.summary;
    const rows = r.results.map(x => `<tr class="${x.error || x.tests.some(t => !t.passed) ? 'bad' : 'ok'}"><td>${x.iteration}</td><td><b>${esc(x.method)}</b> ${esc(x.request)}<div class="sub">${esc(x.path || '')}</div></td><td>${x.status ?? 'ERR'}</td><td>${x.timeMs ?? ''} ms</td><td>${x.error ? `<div class="f">${esc(x.error)}</div>` : ''}${x.tests.map(t => `<div class="${t.passed ? 'p' : 'f'}">${t.passed ? '✓' : '✗'} ${esc(t.name)}${t.passed ? '' : ` <span class="sub">${esc(t.message || '')}</span>`}</div>`).join('')}</td></tr>`).join('');
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>Reqly run · ${esc(r.folder || '')}</title><style>
        body{font:14px -apple-system,Segoe UI,sans-serif;margin:32px;color:#1e1e2e}h1{font-size:20px;margin:0 0 4px}.meta{color:#6c7086;margin-bottom:18px}
        .cards{display:flex;gap:12px;margin-bottom:20px}.card{border:1px solid #ddd;border-radius:8px;padding:10px 14px}.card b{display:block;font-size:20px}
        table{border-collapse:collapse;width:100%}th,td{text-align:left;padding:8px;border-bottom:1px solid #eee;vertical-align:top}th{font-size:12px;color:#6c7086}
        tr.bad td:first-child{box-shadow:inset 3px 0 #d20f39}tr.ok td:first-child{box-shadow:inset 3px 0 #40a02b}.p{color:#40a02b}.f{color:#d20f39}.sub{color:#8c8fa1;font-size:12px}
        </style></head><body><h1>${esc(r.folder || 'Collection run')}</h1>
        <div class="meta">${new Date(r.startedAt).toLocaleString()} · environment: ${esc(r.environment || 'none')} · ${r.iterations} iteration(s)${r.dataFile ? ` · data: ${esc(r.dataFile)}` : ''}${r.parallel > 1 ? ` · ${r.parallel} in parallel` : ''}${s.stopped ? ' · <b>stopped early</b>' : ''}</div>
        <div class="cards"><div class="card"><b>${s.done}</b>requests</div><div class="card"><b class="p">${s.passed}</b>tests passed</div><div class="card"><b class="f">${s.failed}</b>tests failed</div><div class="card"><b>${s.errors}</b>errors</div><div class="card"><b>${s.done ? Math.round(s.time / s.done) : 0} ms</b>average</div><div class="card"><b>${(s.durationMs / 1000).toFixed(1)} s</b>total</div></div>
        <table><thead><tr><th>#</th><th>Request</th><th>Status</th><th>Time</th><th>Tests</th></tr></thead><tbody>${rows}</tbody></table></body></html>`;
    download(base + '.html', html, 'text/html');
}

// ============================================================
// Layout: resizable sidebar and request/response split
// ============================================================
function initResizers() {
    const layout = lsGet('reqly.layout', {});
    if (layout.sidebar) $('sidebar').style.width = layout.sidebar + 'px';
    if (layout.split) $('requestPanel').style.height = layout.split + '%';
    if (layout.splitX) $('requestPanel').style.width = layout.splitX + '%';
    if (layout.side) $('panels').classList.add('side');
    if (layout.sidebarHidden) document.body.classList.add('sidebar-hidden');
    updateLayoutButtons();

    const drag = (handle, onMove) => handle.addEventListener('mousedown', e => {
        e.preventDefault();
        document.body.classList.add('resizing');
        const move = ev => onMove(ev);
        const up = () => {
            document.body.classList.remove('resizing');
            window.removeEventListener('mousemove', move);
            window.removeEventListener('mouseup', up);
            saveLayout();
        };
        window.addEventListener('mousemove', move);
        window.addEventListener('mouseup', up);
    });
    drag($('sidebarResizer'), ev => { $('sidebar').style.width = Math.min(520, Math.max(200, ev.clientX)) + 'px'; });
    drag($('panelResizer'), ev => {
        const r = $('panels').getBoundingClientRect();
        if ($('panels').classList.contains('side')) $('requestPanel').style.width = Math.min(80, Math.max(20, (ev.clientX - r.left) * 100 / r.width)) + '%';
        else $('requestPanel').style.height = Math.min(85, Math.max(15, (ev.clientY - r.top) * 100 / r.height)) + '%';
    });
    $('panelResizer').addEventListener('dblclick', () => { $('requestPanel').style.height = '50%'; $('requestPanel').style.width = '50%'; saveLayout(); });
}

function saveLayout() {
    lsSet('reqly.layout', {
        sidebar: $('sidebar').offsetWidth || lsGet('reqly.layout', {}).sidebar,
        split: parseFloat($('requestPanel').style.height) || 50,
        splitX: parseFloat($('requestPanel').style.width) || 50,
        side: $('panels').classList.contains('side'),
        sidebarHidden: document.body.classList.contains('sidebar-hidden'),
    });
}

function toggleSidebar() {
    document.body.classList.toggle('sidebar-hidden');
    updateLayoutButtons();
    saveLayout();
}

function toggleLayout() {
    $('panels').classList.toggle('side');
    updateLayoutButtons();
    saveLayout();
}

function updateLayoutButtons() {
    const hidden = document.body.classList.contains('sidebar-hidden');
    const side = $('panels').classList.contains('side');
    $('sidebarToggle').removeAttribute('title');
    $('sidebarToggle').dataset.tip = hidden ? 'Show sidebar' : 'Hide sidebar';
    $('sidebarToggle').classList.toggle('active', hidden);
    const lt = $('layoutToggle');
    lt.removeAttribute('title');
    lt.dataset.tip = side ? 'Response below the request' : 'Response beside the request';
    lt.querySelector('use').setAttribute('href', side ? '#i-rows' : '#i-columns');
}

// ============================================================
// Event wiring
// ============================================================
function initEvents() {
    // Sidebar
    document.querySelectorAll('.sidebar-tab').forEach(t => t.addEventListener('click', () => switchSidebar(t.dataset.side)));
    $('sidebarSearch').addEventListener('input', e => { state.search = e.target.value; renderSidebar(); });
    $('sidebarList').addEventListener('click', e => {
        const hist = e.target.closest('[data-hist]');
        if (hist) return openHistoryItem(state.history[+hist.dataset.hist]);
        const action = e.target.closest('[data-action]');
        const row = e.target.closest('.tree-row');
        if (action?.dataset.action === 'add-request') { e.preventDefault(); return createRequestIn(+(action.dataset.folder || row.dataset.id)); }
        if (!row || e.target.closest('.rename-input')) return;
        const id = +row.dataset.id;
        if (action?.dataset.action === 'menu') return row.dataset.type === 'folder' ? folderMenu(e, id, row) : requestMenu(e, id, row);
        if (row.dataset.type === 'folder') toggleFolder(id); else openRequest(id);
    });
    $('sidebarList').addEventListener('dblclick', e => {
        const row = e.target.closest('.tree-row');
        if (row && e.target.closest('.tree-name')) startRename(row.dataset.type, +row.dataset.id);
    });
    $('sidebarList').addEventListener('contextmenu', e => {
        const row = e.target.closest('.tree-row');
        if (!row) return;
        row.dataset.type === 'folder' ? folderMenu(e, +row.dataset.id, row) : requestMenu(e, +row.dataset.id, row);
    });
    initTreeDnd();

    // Request tabs
    $('reqTabs').addEventListener('click', e => {
        const close = e.target.closest('[data-close]');
        if (close) { e.stopPropagation(); return closeTab(+close.dataset.close); }
        const tab = e.target.closest('.req-tab');
        if (tab) switchToTab(+tab.dataset.tab);
    });
    $('reqTabs').addEventListener('auxclick', e => { const tab = e.target.closest('.req-tab'); if (tab && e.button === 1) closeTab(+tab.dataset.tab); });
    $('reqTabs').addEventListener('contextmenu', e => { const tab = e.target.closest('.req-tab'); if (tab) openTabMenu(e, +tab.dataset.tab); });
    $('reqTabs').addEventListener('dblclick', e => { if (!e.target.closest('.req-tab')) newTab(); });
    $('requestTitle').addEventListener('click', e => { if (e.target.id === 'requestName') startTitleRename(); });

    // Request/response sub-tabs
    ['reqTabsBar', 'resTabsBar'].forEach(id => $(id).addEventListener('click', e => {
        const t = e.target.closest('.tab');
        if (t) selectTab(id, t.dataset.panel);
    }));

    // Editor inputs
    $('urlInput').addEventListener('input', () => { syncParamsFromUrl(); markDirty(); updateIndicators(); renderTabs(); renderUrlMirror(); });
    ['scroll', 'keyup', 'click', 'select', 'focus', 'blur'].forEach(ev => $('urlInput').addEventListener(ev, () => { $('urlMirror').scrollLeft = $('urlInput').scrollLeft; }));
    $('urlInput').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey) sendOrCancel(); });
    $('urlInput').addEventListener('paste', e => {
        const text = (e.clipboardData || window.clipboardData).getData('text').trim();
        if (!/^curl\s/i.test(text)) return;
        e.preventDefault();
        importCurlText(text, true).then(() => toast('Imported cURL')).catch(err => toast('Could not parse cURL: ' + err.message, true));
    });
    $('methodSelect').addEventListener('change', () => { colorMethodSelect(); markDirty(); renderTabs(); });
    $('authTypeSelect').addEventListener('change', e => { renderAuthFields(e.target.value); markDirty(); updateIndicators(); });
    $('authFields').addEventListener('input', markDirty);
    $('bodyTypeGroup').addEventListener('change', e => { setBodyType(e.target.value); markDirty(); updateIndicators(); });
    $('bodyEditor').addEventListener('input', () => { markDirty(); updateIndicators(); });
    $('testEditor').addEventListener('input', () => { markDirty(); updateIndicators(); });
    document.querySelectorAll('[data-bulk]').forEach(b => b.addEventListener('click', () => toggleBulk(b.dataset.bulk)));
    document.querySelectorAll('.snippet').forEach(s => s.addEventListener('click', () => {
        const ed = $('testEditor');
        ed.value = (ed.value.trim() ? ed.value.replace(/\s*$/, '\n') : '') + s.dataset.snippet;
        ed.focus();
        markDirty(); updateIndicators();
    }));
    // Tab key indents inside code editors
    document.addEventListener('keydown', e => {
        if (e.key !== 'Tab' || !e.target.matches('textarea.code')) return;
        e.preventDefault();
        const ta = e.target, s = ta.selectionStart;
        ta.setRangeText('  ', s, ta.selectionEnd, 'end');
        ta.dispatchEvent(new Event('input', { bubbles: true }));
    });
    $('csvFile').addEventListener('change', e => { $('csvFileName').textContent = e.target.files[0]?.name || 'Choose a CSV file…'; });

    // Response view mode
    $('viewModeSeg').addEventListener('click', e => {
        const b = e.target.closest('button');
        if (!b) return;
        state.viewMode = b.dataset.mode;
        const r = activeTab()?.result;
        if (r?.success) renderResponseBody(r);
    });

    // Environments
    $('envSelect').addEventListener('change', e => { lsSet('reqly.env', e.target.value); $('envPopover').classList.remove('active'); renderUrlMirror(); });
    $('envList').addEventListener('click', e => { const it = e.target.closest('[data-env]'); if (it) selectEnv(+it.dataset.env); });

    // Import
    $('importTabs').addEventListener('click', e => { const t = e.target.closest('[data-import]'); if (t) setImportMode(t.dataset.import); });
    $('backupFile').addEventListener('change', e => { $('backupFileName').textContent = e.target.files[0]?.name || 'Choose a reqly-backup-….json file…'; });
    $('postmanFile').addEventListener('change', async e => {
        const f = e.target.files[0];
        if (!f) return;
        $('postmanFileName').textContent = f.name;
        $('postmanInput').value = await f.text();
    });

    // Folder picker
    $('folderPicker').addEventListener('click', e => {
        const opt = e.target.closest('.folder-option');
        if (!opt || opt.classList.contains('disabled')) return;
        picker.selected = opt.dataset.id === '' ? null : +opt.dataset.id;
        renderFolderPicker();
    });
    $('folderPicker').addEventListener('dblclick', e => { if (e.target.closest('.folder-option:not(.disabled)')) picker.onOk(); });
    $('saveModalOk').addEventListener('click', () => picker.onOk());
    $('saveReqName').addEventListener('keydown', e => { if (e.key === 'Enter') picker.onOk(); });

    // Runner
    $('runnerDataFile').addEventListener('change', e => { if (e.target.files[0]) loadRunnerData(e.target.files[0]); });
    $('runnerList').addEventListener('change', renderRunnerPlan);
    $('runnerIterations').addEventListener('input', renderRunnerPlan);
    $('runnerDataClear').addEventListener('click', clearRunnerData);
    $('runnerAll').addEventListener('change', e => { document.querySelectorAll('#runnerList [data-run]').forEach(cb => { cb.checked = e.target.checked; }); renderRunnerPlan(); });

    // Global: dismiss menus, shortcuts
    document.addEventListener('click', e => {
        if (!e.target.closest('#ctxMenu') && !(menuSelect && e.target.closest('select') === menuSelect)) hideMenu();
        if (!e.target.closest('#envPopover') && !e.target.closest('#envQuickLookBtn')) $('envPopover').classList.remove('active');
    });
    document.querySelectorAll('.modal-overlay').forEach(o => o.addEventListener('mousedown', e => {
        if (e.target !== o) return;
        if (o.id === 'dialogModal') dialogResolve?.(false);
        else if (o.id === 'runnerModal') closeRunner();
        else closeModal(o.id);
    }));
    document.addEventListener('keydown', e => {
        const mod = e.metaKey || e.ctrlKey;
        if (e.key === 'Escape') {
            hideMenu();
            $('envPopover').classList.remove('active');
            const open = $('dialogModal').classList.contains('active') ? $('dialogModal') : [...document.querySelectorAll('.modal-overlay.active')].pop();
            if (open) {
                if (open.id === 'dialogModal') dialogResolve?.(open.querySelector('input') ? null : false);
                else if (open.id === 'runnerModal') closeRunner();
                else closeModal(open.id);
            }
            return;
        }
        if (document.querySelector('.modal-overlay.active')) return;
        if (mod && e.key === 'Enter') { e.preventDefault(); sendOrCancel(); }
        else if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); saveCurrentRequest(); }
        else if (e.altKey && e.code === 'KeyT') { e.preventDefault(); newTab(); }
        else if (e.altKey && e.code === 'KeyW') { e.preventDefault(); closeTab(state.activeTabId); }
        else if (e.key === '?' && !e.target.matches('input, textarea, select, [contenteditable]')) { e.preventDefault(); showShortcuts(); }
        else if (mod && e.key.toLowerCase() === 'b') { e.preventDefault(); toggleSidebar(); }
    });
    window.addEventListener('beforeunload', () => persistTabs.flush());
}

// ============================================================
// URL bar: colour {{variables}} (resolved vs. undefined) via a mirror layer behind the input
// ============================================================
function renderUrlMirror() {
    const input = $('urlInput'), mirror = $('urlMirror');
    const vars = currentEnvVars();
    const text = input.value;
    const found = [];
    mirror.innerHTML = esc(text).replace(/\{\{([^{}]+)\}\}/g, (m, name) => {
        const ok = Object.prototype.hasOwnProperty.call(vars, name);
        found.push([name, ok]);
        return `<span class="${ok ? 'var-ok' : 'var-missing'}">${m}</span>`;
    }) + ' ';
    mirror.scrollLeft = input.scrollLeft;
    input.classList.toggle('has-mirror', found.length > 0);
}

/** Hovering a {{variable}} in the URL shows what it resolves to in the active environment. */
function initUrlVarTooltips() {
    const input = $('urlInput');
    let currentVar = null, timer = null;
    const clear = () => { clearTimeout(timer); currentVar = null; tooltip.hide(); };
    input.addEventListener('mousemove', e => {
        const span = [...$('urlMirror').querySelectorAll('span')].find(sp => {
            const r = sp.getBoundingClientRect();
            return e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top - 4 && e.clientY <= r.bottom + 4;
        });
        if (!span) { if (currentVar) clear(); return; }
        if (span === currentVar) return;
        clear();
        currentVar = span;
        timer = setTimeout(() => {
            const name = span.textContent.slice(2, -2);
            const vars = currentEnvVars();
            const env = state.environments.find(x => String(x.id) === $('envSelect').value);
            const html = Object.prototype.hasOwnProperty.call(vars, name)
                ? `<div class="tip-var">{{${esc(name)}}} = <span class="v">${esc(displayValue(name, vars[name])) || '<i>(empty)</i>'}</span></div><div class="tip-sub">From “${esc(env.name)}”${isSecretVar(name) ? ' · secret' : ''}</div>`
                : `<div class="tip-var tip-missing">{{${esc(name)}}} is not defined</div><div class="tip-sub">${env ? `Add it to “${esc(env.name)}” in Environments` : 'No environment selected. Pick one in the header'}</div>`;
            tooltip.showAt(html, span.getBoundingClientRect());
        }, 250);
    });
    input.addEventListener('mouseleave', clear);
    ['keydown', 'scroll'].forEach(ev => input.addEventListener(ev, clear));
}

// ============================================================
// Variables in any field: hover to resolve, type {{ to autocomplete, warn on undefined
// ============================================================
const VAR_FIELDS = '#urlInput, #paramsEditor input[type=text], #headersEditor input[type=text], #formEditor input[type=text], #authFields input, #bodyEditor';

function varsIn(text) { return [...new Set([...String(text || '').matchAll(/\{\{([^{}]+)\}\}/g)].map(m => m[1]))]; }

/** Tooltip text for a field that contains {{variables}}. */
function varTipHtml(text) {
    const vars = currentEnvVars();
    const env = activeEnv();
    const names = varsIn(text);
    if (!names.length) return '';
    return names.slice(0, 8).map(n => Object.prototype.hasOwnProperty.call(vars, n)
        ? `<div class="tip-var">{{${esc(n)}}} = <span class="v">${esc(displayValue(n, vars[n])) || '<i>(empty)</i>'}</span></div>`
        : `<div class="tip-var tip-missing">{{${esc(n)}}} is not defined</div>`).join('')
        + (names.length > 8 ? `<div class="tip-sub">+${names.length - 8} more</div>` : '')
        + `<div class="tip-sub">${env ? `From “${esc(env.name)}”` : 'No environment selected'}</div>`;
}

/** Variables used by the request that the active environment doesn't define. */
function undefinedVars(dto) {
    const vars = currentEnvVars();
    const texts = [dto.url, dto.body, ...queryRows(dto).flatMap(r => [r.key, r.value]), ...Object.keys(dto.headers || {}), ...Object.values(dto.headers || {}), ...Object.values(dto.authConfig || {})];
    return [...new Set(texts.flatMap(varsIn))].filter(n => !Object.prototype.hasOwnProperty.call(vars, n));
}

// Caret pixel position inside an input/textarea, via an off-screen mirror element
function caretCoords(el) {
    const cs = getComputedStyle(el);
    const div = document.createElement('div');
    ['fontFamily', 'fontSize', 'fontWeight', 'letterSpacing', 'lineHeight', 'paddingTop', 'paddingLeft', 'paddingRight', 'borderTopWidth', 'borderLeftWidth', 'boxSizing', 'tabSize'].forEach(p => { div.style[p] = cs[p]; });
    Object.assign(div.style, { position: 'absolute', visibility: 'hidden', top: '0', left: '-9999px', width: el.offsetWidth + 'px', whiteSpace: el.tagName === 'TEXTAREA' ? 'pre-wrap' : 'pre', wordWrap: 'break-word' });
    div.textContent = el.value.slice(0, el.selectionStart);
    const span = document.createElement('span');
    span.textContent = '\u200b';
    div.appendChild(span);
    document.body.appendChild(div);
    const r = el.getBoundingClientRect();
    const x = r.left + span.offsetLeft - el.scrollLeft;
    const y = r.top + span.offsetTop - el.scrollTop + span.offsetHeight;
    div.remove();
    return { x: Math.min(x, r.right - 20), y: Math.min(y, r.bottom) };
}

const suggest = { el: null, items: [], index: 0, start: 0 };

function updateSuggest(el) {
    const before = el.value.slice(0, el.selectionStart);
    const m = before.match(/\{\{([\w.$-]*)$/);
    if (!m) return hideSuggest();
    const prefix = m[1].toLowerCase();
    const vars = currentEnvVars();
    const names = Object.keys(vars);
    suggest.items = names.filter(n => n.toLowerCase().includes(prefix))
        .sort((a, b) => (a.toLowerCase().startsWith(prefix) ? 0 : 1) - (b.toLowerCase().startsWith(prefix) ? 0 : 1) || a.localeCompare(b))
        .slice(0, 12);
    suggest.el = el;
    suggest.start = before.length - m[0].length;
    suggest.index = 0;
    const box = $('varSuggest');
    const env = activeEnv();
    box.innerHTML = suggest.items.length
        ? suggest.items.map((n, i) => `<div class="suggest-item${i === 0 ? ' active' : ''}" data-i="${i}"><span class="name">{{${esc(n)}}}</span><span class="val">${esc(displayValue(n, vars[n]))}</span></div>`).join('')
        : `<div class="suggest-empty">${env ? (names.length ? 'No matching variables' : `“${esc(env.name)}” has no variables yet`) : 'Select an environment to see its variables'}</div>`;
    const c = caretCoords(el);
    box.classList.add('active');
    box.style.left = Math.min(c.x, window.innerWidth - box.offsetWidth - 8) + 'px';
    box.style.top = (c.y + box.offsetHeight + 8 > window.innerHeight ? c.y - box.offsetHeight - 24 : c.y + 4) + 'px';
}

function hideSuggest() { $('varSuggest').classList.remove('active'); suggest.el = null; }

function acceptSuggest(i = suggest.index) {
    const el = suggest.el, name = suggest.items[i];
    if (!el || !name) return hideSuggest();
    const end = el.selectionStart;
    const after = el.value.slice(end).replace(/^[\w.$-]*\}{0,2}/, '');
    el.value = el.value.slice(0, suggest.start) + `{{${name}}}` + after;
    const caret = suggest.start + name.length + 4;
    el.setSelectionRange(caret, caret);
    hideSuggest();
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.focus();
}

function initVariableHelpers() {
    document.addEventListener('input', e => { if (e.target.matches?.(VAR_FIELDS)) updateSuggest(e.target); else if (suggest.el) hideSuggest(); });
    document.addEventListener('keydown', e => {
        if (!suggest.el || !$('varSuggest').classList.contains('active') || e.target !== suggest.el) return;
        const items = $('varSuggest').querySelectorAll('.suggest-item');
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            if (!items.length) return;
            e.preventDefault();
            suggest.index = (suggest.index + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
            items.forEach((it, i) => it.classList.toggle('active', i === suggest.index));
        } else if ((e.key === 'Enter' || e.key === 'Tab') && items.length) {
            e.preventDefault(); e.stopPropagation();
            acceptSuggest();
        } else if (e.key === 'Escape') {
            e.preventDefault(); e.stopPropagation();
            hideSuggest();
        }
    }, true);
    $('varSuggest').addEventListener('mousedown', e => { const it = e.target.closest('.suggest-item'); if (it) { e.preventDefault(); acceptSuggest(+it.dataset.i); } });
    document.addEventListener('focusout', e => { if (e.target === suggest.el) setTimeout(hideSuggest, 120); });
}

// ============================================================
// Command palette (⌘K): jump to any request/folder/environment or run an action
// ============================================================
const palette = { items: [], results: [], index: 0 };

function paletteSources() {
    const items = [];
    const walk = (folders, path) => folders.forEach(f => {
        const p = [...path, f.name];
        items.push({ kind: 'Folder', label: f.name, sub: path.join(' / '), icon: path.length ? 'folder' : 'collection', run: () => revealFolder(f.id) });
        if (!path.length) items.push({ kind: 'Action', label: `Run ${f.name}`, sub: 'Collection runner', icon: 'play', run: () => openRunner(f.id) });
        f.requests.forEach(r => items.push({ kind: 'Request', label: r.name, sub: p.join(' / ') + (r.url ? '  ·  ' + r.url : ''), method: r.method, run: () => openRequest(r.id) }));
        walk(f.folders, p);
    });
    walk(state.tree.collections, []);
    state.tree.requests.forEach(r => items.push({ kind: 'Request', label: r.name, sub: 'Unsorted' + (r.url ? '  ·  ' + r.url : ''), method: r.method, run: () => openRequest(r.id) }));
    state.environments.forEach(e => items.push({ kind: 'Environment', label: `Use ${e.name}`, sub: String(e.id) === $('envSelect').value ? 'Active' : 'Switch environment', icon: 'settings', run: () => { $('envSelect').value = String(e.id); $('envSelect').dispatchEvent(new Event('change', { bubbles: true })); toast(`Environment: ${e.name}`); } }));
    items.push({ kind: 'Environment', label: 'Use no environment', sub: 'Switch environment', icon: 'settings', run: () => { $('envSelect').value = ''; $('envSelect').dispatchEvent(new Event('change', { bubbles: true })); } });
    const actions = [
        ['New request tab', '⌥T', 'plus', () => newTab()],
        ['New collection', '', 'collection', () => createFolder(null)],
        ['Send request', MOD + '↵', 'send', () => sendOrCancel()],
        ['Save request', MOD + 'S', 'file', () => saveCurrentRequest()],
        ['Copy as cURL', '', 'copy', () => copyCurrentAsCurl()],
        ['Code snippet…', '', 'copy', () => openSnippetModal()],
        ['Import cURL / Postman / backup', '', 'import', () => openImportModal()],
        ['Export everything (backup)', '', 'download', () => { location.href = '/api/export/all'; }],
        ['Manage environments', '', 'settings', () => openEnvModal()],
        ['Switch theme', '', 'theme', () => toggleTheme()],
        ['Toggle sidebar', MOD + 'B', 'sidebar', () => toggleSidebar()],
        ['Toggle side-by-side layout', '', 'columns', () => toggleLayout()],
        ['Toggle sound effects (sci-fi)', '', 'sound-on', () => toggleSound()],
        ['Keyboard shortcuts', '?', 'keyboard', () => showShortcuts()],
        ['Toggle console', MOD + '⌥C', 'terminal', () => toggleConsole()],
        ['Clear console', '', 'terminal', () => clearConsole()],
        ['Show history', '', 'history', () => switchSidebar('history')],
    ];
    actions.forEach(([label, key, ic, run]) => items.push({ kind: 'Action', label, sub: '', shortcut: key, icon: ic, run }));
    return items;
}

/** Simple fuzzy score: contiguous matches and word starts rank highest; null = no match. */
function fuzzyScore(text, q) {
    const t = text.toLowerCase();
    if (!q) return 0;
    const at = t.indexOf(q);
    if (at >= 0) return 100 - at + (at === 0 || /[\s/._-]/.test(t[at - 1]) ? 50 : 0);
    let ti = 0, score = 0;
    for (const ch of q) {
        const found = t.indexOf(ch, ti);
        if (found < 0) return null;
        score += found === ti ? 3 : 1;
        ti = found + 1;
    }
    return score;
}

function openPalette() {
    palette.items = paletteSources();
    $('palette').classList.add('active');
    hideMenu(); tooltip.hide();
    const input = $('paletteInput');
    input.value = '';
    input.focus();
    renderPalette();
}
function closePalette() { $('palette').classList.remove('active'); }

function renderPalette() {
    const q = $('paletteInput').value.trim().toLowerCase();
    const kindOrder = { Request: 0, Folder: 1, Environment: 2, Action: 3 };
    palette.results = palette.items
        .map(it => ({ it, score: q ? Math.max(fuzzyScore(it.label, q) ?? -1, (fuzzyScore(it.sub || '', q) ?? -1) - 40) : 0 }))
        .filter(x => x.score >= 0)
        .sort((a, b) => q ? b.score - a.score : kindOrder[a.it.kind] - kindOrder[b.it.kind])
        .slice(0, 60).map(x => x.it);
    if (!q) palette.results = [...palette.results.filter(r => r.kind === 'Action').slice(0, 6), ...palette.results.filter(r => r.kind === 'Request').slice(0, 12)];
    palette.index = 0;
    let last = null;
    $('paletteList').innerHTML = palette.results.map((r, i) => {
        const head = r.kind !== last ? `<div class="palette-section">${r.kind === 'Request' ? 'Requests' : r.kind === 'Folder' ? 'Folders' : r.kind === 'Environment' ? 'Environments' : 'Actions'}</div>` : '';
        last = r.kind;
        const lead = r.method ? `<span class="method-badge method-${methodClass(r.method)}">${shortMethod(r.method)}</span>` : icon(r.icon || 'chevron');
        return `${head}<div class="palette-item${i === 0 ? ' active' : ''}" data-i="${i}">${lead}<span class="palette-label">${hlQuery(r.label, q)}</span><span class="palette-sub">${esc(r.sub || '')}</span>${r.shortcut ? `<span class="kbd">${esc(r.shortcut)}</span>` : ''}</div>`;
    }).join('') || `<div class="palette-empty">Nothing matches “${esc(q)}”</div>`;
}

function hlQuery(text, q) {
    if (!q) return esc(text);
    const i = text.toLowerCase().indexOf(q);
    return i < 0 ? esc(text) : esc(text.slice(0, i)) + '<mark>' + esc(text.slice(i, i + q.length)) + '</mark>' + esc(text.slice(i + q.length));
}

function movePalette(delta) {
    const items = $('paletteList').querySelectorAll('.palette-item');
    if (!items.length) return;
    palette.index = (palette.index + delta + items.length) % items.length;
    items.forEach((el, i) => el.classList.toggle('active', i === palette.index));
    items[palette.index].scrollIntoView({ block: 'nearest' });
}

function runPaletteItem(i) {
    const r = palette.results[i];
    if (!r) return;
    closePalette();
    r.run();
}

function revealFolder(id) {
    if (state.sidebarTab !== 'collections') switchSidebar('collections');
    state.search = ''; $('sidebarSearch').value = '';
    for (let f = findFolder(id); f; f = f.parentId != null ? findFolder(f.parentId) : null) state.expanded.add(f.id);
    saveExpanded();
    renderSidebar();
    const row = document.querySelector(`.tree-row[data-type=folder][data-id="${id}"]`);
    row?.scrollIntoView({ block: 'center' });
    fx(row, 'fx-flash');
    if (!isScifi() && row) { row.classList.add('menu-open'); setTimeout(() => row.classList.remove('menu-open'), 900); }
}

function initPalette() {
    $('paletteInput').addEventListener('input', renderPalette);
    $('paletteInput').addEventListener('keydown', e => {
        if (e.key === 'ArrowDown') { e.preventDefault(); movePalette(1); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); movePalette(-1); }
        else if (e.key === 'Enter') { e.preventDefault(); runPaletteItem(palette.index); }
        else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closePalette(); }
    });
    $('paletteList').addEventListener('mousemove', e => {
        const it = e.target.closest('.palette-item');
        if (!it || +it.dataset.i === palette.index) return;
        palette.index = +it.dataset.i;
        $('paletteList').querySelectorAll('.palette-item').forEach((el, i) => el.classList.toggle('active', i === palette.index));
    });
    $('paletteList').addEventListener('click', e => { const it = e.target.closest('.palette-item'); if (it) runPaletteItem(+it.dataset.i); });
    $('palette').addEventListener('mousedown', e => { if (e.target === $('palette')) closePalette(); });
    document.addEventListener('keydown', e => {
        if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
            e.preventDefault();
            $('palette').classList.contains('active') ? closePalette() : openPalette();
        }
    }, true);
}

// ============================================================
// Theme & shortcuts help
// ============================================================
const THEMES = [['scifi', 'Sci-fi'], ['dark', 'Dark'], ['light', 'Light']];
const isScifi = () => document.documentElement.dataset.theme === 'scifi';

function toggleTheme() {
    const i = THEMES.findIndex(([t]) => t === document.documentElement.dataset.theme);
    const next = THEMES[(i + 1) % THEMES.length][0];
    document.documentElement.dataset.theme = next;
    lsSet('reqly.uiTheme', next);
    updateThemeButton();
    toast(`Theme: ${THEMES.find(([t]) => t === next)[1]}`);
}

function updateThemeButton() {
    const i = THEMES.findIndex(([t]) => t === document.documentElement.dataset.theme);
    const btn = $('themeBtn');
    btn.removeAttribute('title');
    btn.dataset.tip = `Theme: ${THEMES[i][1]}\nClick for ${THEMES[(i + 1) % THEMES.length][1]}`;
}

// ============================================================
// Game feel (sci-fi theme only): boot sequence, HUD telemetry, effects
// ============================================================
const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Restarts a one-shot CSS animation class on an element. */
function fx(el, cls) {
    if (!el || !isScifi() || reducedMotion()) return;
    el.classList.remove(cls);
    void el.offsetWidth;
    el.classList.add(cls);
    setTimeout(() => el.classList.remove(cls), 1000);
}

function ripple(ev) {
    if (!isScifi() || reducedMotion() || !ev?.clientX) return;
    const r = document.createElement('div');
    r.className = 'fx-ripple';
    r.style.left = ev.clientX + 'px';
    r.style.top = ev.clientY + 'px';
    document.body.appendChild(r);
    setTimeout(() => r.remove(), 650);
}

// Synthesised blips (no audio files); sci-fi theme only, off until the user turns them on
let soundOn = lsGet('reqly.sound', false), audioCtx = null;
function toggleSound() {
    soundOn = !soundOn;
    lsSet('reqly.sound', soundOn);
    updateSoundButton();
    if (soundOn) playSound('ok');
}
function updateSoundButton() {
    const b = $('soundBtn');
    b.removeAttribute('title');
    b.dataset.tip = soundOn ? 'Sound effects: on' : 'Sound effects: off';
    b.classList.toggle('active', soundOn);
    b.querySelector('use').setAttribute('href', soundOn ? '#i-sound-on' : '#i-sound-off');
}
function playSound(kind) {
    if (!soundOn || !isScifi()) return;
    try {
        audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
        const t = audioCtx.currentTime;
        const tone = (f, start, dur, type = 'sine', vol = 0.05, f2 = null) => {
            const o = audioCtx.createOscillator(), g = audioCtx.createGain();
            o.type = type;
            o.frequency.setValueAtTime(f, t + start);
            if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + start + dur);
            g.gain.setValueAtTime(0.0001, t + start);
            g.gain.exponentialRampToValueAtTime(vol, t + start + 0.012);
            g.gain.exponentialRampToValueAtTime(0.0001, t + start + dur);
            o.connect(g).connect(audioCtx.destination);
            o.start(t + start);
            o.stop(t + start + dur + 0.03);
        };
        ({
            send: () => tone(380, 0, 0.14, 'square', 0.025, 1100),
            ok: () => { tone(660, 0, 0.09); tone(990, 0.08, 0.16); },
            err: () => tone(190, 0, 0.3, 'sawtooth', 0.035, 80),
            win: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.09, 0.18, 'triangle', 0.05)),
            fail: () => { tone(320, 0, 0.18, 'sawtooth', 0.035, 160); tone(210, 0.16, 0.32, 'sawtooth', 0.035, 90); },
            achieve: () => [784, 988, 1175, 1568].forEach((f, i) => tone(f, i * 0.07, 0.22, 'triangle', 0.045)),
        })[kind]?.();
    } catch (e) { /* audio unavailable */ }
}

const hud = lsGet('reqly.hud', { tx: 0, ok: 0 });
function recordTelemetry(success) {
    hud.tx++;
    if (success) hud.ok++;
    lsSet('reqly.hud', hud);
    renderHud(success);
}
function renderHud(lastOk = true) {
    $('hudTx').textContent = hud.tx;
    $('hudOk').textContent = hud.tx ? Math.round(hud.ok * 100 / hud.tx) + '%' : '—';
    $('hudLink').classList.toggle('err', !lastOk);
}

function bootSequence() {
    let seen = false;
    try { seen = sessionStorage.getItem('reqly.booted') === '1'; sessionStorage.setItem('reqly.booted', '1'); } catch (e) { /* no storage */ }
    if (seen || !isScifi() || reducedMotion()) return;
    const boot = $('boot');
    const lines = ['Initializing request thrusters', 'Linking environments', 'Mapping collections', 'Calibrating response sensors', 'Systems online'];
    $('bootLines').innerHTML = lines.map((l, i) => `<div style="animation-delay:${i * 0.2}s">› ${l} ${'.'.repeat(Math.max(2, 34 - l.length))}<span class="ok">${i === lines.length - 1 ? 'READY' : 'OK'}</span></div>`).join('');
    boot.classList.add('active');
    const finish = () => {
        boot.classList.add('done');
        setTimeout(() => boot.classList.remove('active', 'done'), 480);
        boot.removeEventListener('click', finish);
        document.removeEventListener('keydown', finish, true);
    };
    boot.addEventListener('click', finish);
    document.addEventListener('keydown', finish, true);
    setTimeout(finish, 1500);
}

function showShortcuts() {
    const rows = [[MOD + 'K', 'Search & jump to anything'], [MOD + '↵', 'Send request'], [MOD + 'S', 'Save request'], [MOD + 'F', 'Find in response'], [MOD + 'B', 'Show / hide sidebar'], [MOD + '⌥C', 'Show / hide console'], ['Enter', 'Send (in the URL bar)'], ['⌥T', 'New tab'], ['⌥W', 'Close tab'], ['Esc', 'Close dialog / menu'], ['?', 'Show this list'],
        ['Double-click', 'Rename an item in the sidebar'], ['Right-click', 'Item and tab menus'], ['Middle-click', 'Close a tab'], ['Paste cURL', 'Into the URL bar to import it']];
    uiDialog({
        title: 'Keyboard shortcuts', okText: 'Close', alertOnly: true,
        message: `<table class="shortcut-table">${rows.map(([k, d]) => `<tr><td><span class="kbd">${esc(k)}</span></td><td>${esc(d)}</td></tr>`).join('')}</table>`,
    });
}

// ============================================================
// Tooltips: one styled tooltip for every element with a title (native ones are suppressed)
// ============================================================
const tooltip = { showAt() {}, hide() {} };

function initTooltips() {
    const tip = $('tooltip');
    let timer = null, current = null;
    const hide = () => { clearTimeout(timer); tip.classList.remove('show'); current = null; };
    const place = r => {
        const w = tip.offsetWidth, h = tip.offsetHeight;
        let top = r.bottom + 6;
        if (top + h > window.innerHeight - 6) top = r.top - h - 6;
        tip.style.top = top + 'px';
        tip.style.left = Math.min(Math.max(6, r.left + r.width / 2 - w / 2), window.innerWidth - w - 6) + 'px';
    };
    tooltip.showAt = (html, rect) => { tip.innerHTML = html; tip.classList.add('show'); place(rect); };
    tooltip.hide = hide;
    const show = el => {
        if (!document.body.contains(el) || !el.dataset.tip) return;
        tip.innerHTML = esc(el.dataset.tip) + (el.dataset.tipKey ? `<span class="kbd">${esc(el.dataset.tipKey)}</span>` : '');
        tip.classList.add('show');
        place(el.getBoundingClientRect());
    };
    document.addEventListener('mouseover', e => {
        const varField = e.target.matches?.(VAR_FIELDS) && e.target.id !== 'urlInput' && /\{\{[^{}]+\}\}/.test(e.target.value) ? e.target : null;
        if (varField) {
            if (varField === current) return;
            hide();
            current = varField;
            timer = setTimeout(() => { if (document.activeElement !== varField || !suggest.el) tooltip.showAt(varTipHtml(varField.value), varField.getBoundingClientRect()); }, 400);
            return;
        }
        const el = e.target.closest('[title], [data-tip]');
        if (el === current) return;
        hide();
        if (!el || el.closest('#ctxMenu')) return;
        if (el.hasAttribute('title')) {
            const t = el.getAttribute('title');
            el.removeAttribute('title');
            if (t) el.dataset.tip = t;
        }
        current = el;
        // Show quickly when moving between tooltips, like native UIs do
        timer = setTimeout(() => show(el), tip.dataset.warm === '1' ? 80 : 500);
    });
    tip.addEventListener('transitionend', () => { tip.dataset.warm = tip.classList.contains('show') ? '1' : tip.dataset.warm; });
    let coolTimer;
    document.addEventListener('mouseout', () => { clearTimeout(coolTimer); coolTimer = setTimeout(() => { if (!current) tip.dataset.warm = '0'; }, 600); });
    ['mousedown', 'keydown', 'wheel'].forEach(ev => document.addEventListener(ev, hide, true));
    window.addEventListener('blur', hide);
}

// ============================================================
// Init
// ============================================================
async function init() {
    initKv('paramsEditor', { keyPh: 'Key', valPh: 'Value' });
    initKv('headersEditor', { keyPh: 'Header', valPh: 'Value' });
    initKv('formEditor', { toggle: false, keyPh: 'Key', valPh: 'Value' });
    initEvents();
    initResizers();
    initTooltips();
    initUrlVarTooltips();
    initThemedSelects();
    initPalette();
    initVariableHelpers();
    initResponseTools();
    initFormDataEditor();
    initSnippets();
    ['setTimeout', 'setInsecure', 'setRedirects'].forEach(id => $(id).addEventListener('change', () => { markDirty(); updateIndicators(); }));
    ['gqlQuery', 'gqlVars'].forEach(id => $(id).addEventListener('input', () => { markDirty(); updateIndicators(); }));
    updateThemeButton();
    updateSoundButton();
    renderHud();
    bootSequence();
    $('sendBtn').addEventListener('click', ripple);
    $('runnerStartBtn').addEventListener('click', ripple);
    document.querySelectorAll('.snippet').forEach(s => { s.title = 'Inserts: ' + s.dataset.snippet; });
    await loadEnvironments();
    if (!restoreTabs()) newTab();
    await loadTree();
}

init();
