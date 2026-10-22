'use strict';
/*
 * Postman-style scripting for Reqly.
 *
 * Pre-request and post-response scripts are JavaScript that runs in this browser tab with a
 * `pm` object (environment, variables, request, response, test, expect, sendRequest) and a
 * `console` whose output goes to the Console panel. Scripts are the user's own code (or come
 * from collections they import), the same trust model as Postman.
 *
 * Loaded after app.js and uses its helpers ($, esc, api, state, ...).
 */

// ============================================================
// Console panel
// ============================================================
const reqlyConsole = { entries: [], filter: 'all', unread: 0, errors: 0, seq: 0 };
const CONSOLE_MAX = 1000;

function logToConsole(level, source, args) {
    reqlyConsole.entries.push({ id: ++reqlyConsole.seq, level, source, args, time: new Date() });
    if (reqlyConsole.entries.length > CONSOLE_MAX) reqlyConsole.entries.shift();
    const open = $('consolePanel').classList.contains('active') && dockTab === 'console';
    if (!open) {
        reqlyConsole.unread++;
        if (level === 'error') reqlyConsole.errors++;
    }
    updateConsoleBadge();
    if (open) appendConsoleEntry(reqlyConsole.entries[reqlyConsole.entries.length - 1], true);
}

/** One line per request/response, expandable to the full details (like Postman's console). */
function logNetwork(source, wire, result) {
    logToConsole(result && result.success ? (result.statusCode >= 400 ? 'warn' : 'net') : 'error', source, [{ __net: true, wire, result }]);
}

function updateConsoleBadge() {
    const b = $('consoleBadge');
    b.textContent = reqlyConsole.unread > 99 ? '99+' : reqlyConsole.unread || '';
    b.classList.toggle('err', reqlyConsole.errors > 0);
}

function fmtValue(v, depth = 0) {
    if (v === null) return '<span class="j-null">null</span>';
    if (v === undefined) return '<span class="j-null">undefined</span>';
    if (typeof v === 'string') return depth ? `<span class="j-str">${esc(JSON.stringify(v))}</span>` : esc(v);
    if (typeof v === 'number' || typeof v === 'bigint') return `<span class="j-num">${esc(String(v))}</span>`;
    if (typeof v === 'boolean') return `<span class="j-bool">${v}</span>`;
    if (v instanceof Error) return `<span class="c-err-text">${esc(v.name)}: ${esc(v.message)}</span>`;
    if (typeof v === 'function') return `<span class="muted">ƒ ${esc(v.name || 'anonymous')}()</span>`;
    let json;
    try { json = JSON.stringify(v, null, 2); } catch (e) { json = String(v); }
    const short = (() => { try { return JSON.stringify(v); } catch (e) { return String(v); } })();
    if (short.length <= 90) return `<span class="c-obj">${highlightJson(short)}</span>`;
    return `<details class="c-details"><summary>${esc(short.slice(0, 90))}…</summary><pre>${highlightJson(json)}</pre></details>`;
}

function netEntryHtml({ wire, result }) {
    const ok = result && result.success;
    const status = ok ? `<span class="status-badge ${statusClass(result.statusCode)}">${result.statusCode} ${STATUS_TEXT[result.statusCode] || ''}</span>` : '<span class="status-badge status-err">Error</span>';
    const reqHeaders = Object.entries(wire.headers || {}).map(([k, v]) => `<div><span class="j-key">${esc(k)}</span>: ${esc(isSensitiveHeader(k) ? '••••••' : v)}</div>`).join('');
    const resHeaders = ok ? Object.entries(result.responseHeaders || {}).map(([k, v]) => `<div><span class="j-key">${esc(k)}</span>: ${esc(v)}</div>`).join('') : '';
    const body = ok ? (result.responseBody || '') : '';
    let bodyHtml = esc(body.slice(0, 20000));
    try { JSON.parse(body); bodyHtml = highlightJson(prettyJson(body.slice(0, 20000))); } catch (e) { /* not JSON */ }
    return `<details class="c-details c-net"><summary><span class="method-badge method-${methodClass(wire.method)}">${shortMethod(wire.method)}</span> <span class="c-url">${esc(wire.url)}</span> ${status}${ok ? `<span class="muted">${formatMs(result.responseTimeMs)} · ${formatBytes(result.responseSizeBytes)}</span>` : ''}</summary>
        <div class="c-net-body">
            ${!ok ? `<div class="c-err-text">${esc(result?.error || 'Request failed')}</div>` : ''}
            <div class="c-sec">Request headers</div>${reqHeaders || '<div class="muted">none</div>'}
            ${wire.body ? `<div class="c-sec">Request body</div><pre>${esc(String(wire.body).slice(0, 20000))}</pre>` : ''}
            ${ok ? `<div class="c-sec">Response headers</div>${resHeaders}<div class="c-sec">Response body${body.length > 20000 ? ' (first 20 KB)' : ''}</div><pre>${bodyHtml}</pre>` : ''}
        </div></details>`;
}

const isSensitiveHeader = k => /authorization|cookie|token|secret|password|api[-_]?key/i.test(k);

function consoleEntryHtml(e) {
    const time = e.time.toLocaleTimeString(undefined, { hour12: false }) + '.' + String(e.time.getMilliseconds()).padStart(3, '0');
    const content = e.args.length === 1 && e.args[0]?.__net ? netEntryHtml(e.args[0]) : e.args.map(a => fmtValue(a)).join(' ');
    return `<div class="c-row c-${e.level}" data-level="${e.level}"><span class="c-time">${time}</span><span class="c-src" title="${esc(e.source)}">${esc(e.source)}</span><div class="c-msg">${content}</div></div>`;
}

function consoleVisible(e) {
    const f = reqlyConsole.filter;
    return f === 'all' || (f === 'log' && ['log', 'info', 'debug'].includes(e.level)) || (f === 'net' && e.args[0]?.__net) || (f === 'error' && ['error', 'warn'].includes(e.level));
}

function renderConsole() {
    const list = $('consoleList');
    const shown = reqlyConsole.entries.filter(consoleVisible);
    list.innerHTML = shown.length ? shown.map(consoleEntryHtml).join('') : `<div class="c-empty">${reqlyConsole.entries.length ? 'Nothing matches this filter' : 'Logs from <code>console.log()</code> in scripts, and every request you send, show up here.'}</div>`;
    list.scrollTop = list.scrollHeight;
    document.querySelectorAll('#consoleFilters button').forEach(b => b.classList.toggle('active', b.dataset.filter === reqlyConsole.filter));
}

function appendConsoleEntry(e, scroll) {
    if (!consoleVisible(e)) return;
    const list = $('consoleList');
    list.querySelector('.c-empty')?.remove();
    const atBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 40;
    list.insertAdjacentHTML('beforeend', consoleEntryHtml(e));
    while (list.children.length > CONSOLE_MAX) list.firstElementChild.remove();
    if (scroll && atBottom) list.scrollTop = list.scrollHeight;
}

// ---------- Bottom dock: Console and Terminal share one resizable panel ----------
let dockTab = 'console';

function showDock(tab) {
    dockTab = tab;
    const panel = $('consolePanel');
    panel.classList.add('active');
    panel.dataset.tab = tab;
    document.querySelectorAll('#dockTabs .dock-tab').forEach(b => b.classList.toggle('active', b.dataset.dock === tab));
    $('consoleToggle').classList.toggle('active', tab === 'console');
    $('terminalToggle').classList.toggle('active', tab === 'terminal');
    lsSet('reqly.dock', tab);
    if (tab === 'console') {
        reqlyConsole.unread = 0; reqlyConsole.errors = 0;
        updateConsoleBadge();
        renderConsole();
    } else {
        setTimeout(() => $('termInput').focus(), 0);
        termScrollToEnd();
    }
}

function closeDock() {
    $('consolePanel').classList.remove('active');
    $('consoleToggle').classList.remove('active');
    $('terminalToggle').classList.remove('active');
    lsSet('reqly.dock', null);
}

/** Status-bar buttons: open that tab, or close the panel if it's already showing. */
function toggleDock(tab) {
    if ($('consolePanel').classList.contains('active') && dockTab === tab) closeDock();
    else showDock(tab);
}

function toggleConsole(force) {
    if (force === false) return closeDock();
    if (force === true) return showDock('console');
    toggleDock('console');
}

function dockClear() { if (dockTab === 'terminal') termClear(); else clearConsole(); }

function clearConsole() {
    reqlyConsole.entries = [];
    reqlyConsole.unread = 0; reqlyConsole.errors = 0;
    updateConsoleBadge();
    renderConsole();
}

function initConsole() {
    $('consoleFilters').addEventListener('click', e => {
        const b = e.target.closest('[data-filter]');
        if (!b) return;
        reqlyConsole.filter = b.dataset.filter;
        renderConsole();
    });
    // drag the top edge to resize
    const panel = $('consolePanel');
    const h = lsGet('reqly.consoleHeight', 240);
    panel.style.height = h + 'px';
    $('consoleResizer').addEventListener('mousedown', e => {
        e.preventDefault();
        document.body.classList.add('resizing');
        const move = ev => { panel.style.height = Math.min(window.innerHeight * 0.75, Math.max(120, window.innerHeight - ev.clientY)) + 'px'; };
        const up = () => {
            document.body.classList.remove('resizing');
            window.removeEventListener('mousemove', move);
            window.removeEventListener('mouseup', up);
            lsSet('reqly.consoleHeight', panel.offsetHeight);
        };
        window.addEventListener('mousemove', move);
        window.addEventListener('mouseup', up);
    });
    document.addEventListener('keydown', e => {
        // ⌘⌥C / Ctrl+Alt+C opens the console (as in Postman); Ctrl+` the terminal (as in VS Code)
        if ((e.metaKey || e.ctrlKey) && e.altKey && e.code === 'KeyC') { e.preventDefault(); toggleDock('console'); }
        if (e.ctrlKey && e.code === 'Backquote') { e.preventDefault(); toggleDock('terminal'); }
    });
    $('dockTabs').addEventListener('click', e => { const b = e.target.closest('[data-dock]'); if (b) showDock(b.dataset.dock); });
    const last = lsGet('reqly.dock', null);
    if (last) showDock(last);
    renderConsole();
}

// ============================================================
// expect(): a small chai-style assertion helper
// ============================================================
class AssertionError extends Error { constructor(m) { super(m); this.name = 'AssertionError'; } }

function deepEqual(a, b) {
    if (a === b) return true;
    if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') return Number.isNaN(a) && Number.isNaN(b);
    if (Array.isArray(a) !== Array.isArray(b)) return false;
    const ka = Object.keys(a), kb = Object.keys(b);
    return ka.length === kb.length && ka.every(k => deepEqual(a[k], b[k]));
}

function makeExpect(actual) {
    let negate = false;
    const show = v => { try { return JSON.stringify(v); } catch (e) { return String(v); } };
    const check = (cond, msg, negMsg) => {
        if (negate ? cond : !cond) throw new AssertionError(negate ? negMsg : msg);
        return chain;
    };
    const typeOf = v => v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v;
    const chain = {};
    ['to', 'be', 'been', 'is', 'that', 'which', 'and', 'has', 'have', 'with', 'at', 'of', 'same', 'does', 'still'].forEach(w => Object.defineProperty(chain, w, { get: () => chain }));
    Object.defineProperty(chain, 'not', { get: () => { negate = !negate; return chain; } });
    Object.defineProperty(chain, 'deep', { get: () => chain });
    const flag = (name, cond, desc) => Object.defineProperty(chain, name, { get: () => check(cond(), `expected ${show(actual)} to be ${desc}`, `expected ${show(actual)} not to be ${desc}`) });
    flag('ok', () => !!actual, 'truthy');
    flag('true', () => actual === true, 'true');
    flag('false', () => actual === false, 'false');
    flag('null', () => actual === null, 'null');
    flag('undefined', () => actual === undefined, 'undefined');
    flag('exist', () => actual != null, 'defined');
    flag('empty', () => actual != null && (typeof actual === 'string' || Array.isArray(actual) ? actual.length === 0 : Object.keys(actual).length === 0), 'empty');
    Object.assign(chain, {
        equal: v => check(actual === v, `expected ${show(actual)} to equal ${show(v)}`, `expected ${show(actual)} not to equal ${show(v)}`),
        eql: v => check(deepEqual(actual, v), `expected ${show(actual)} to deeply equal ${show(v)}`, `expected ${show(actual)} not to deeply equal ${show(v)}`),
        include: v => check(typeof actual === 'string' ? actual.includes(v) : Array.isArray(actual) ? actual.some(x => deepEqual(x, v)) : actual && typeof v === 'object' ? Object.entries(v).every(([k, x]) => deepEqual(actual[k], x)) : false,
            `expected ${show(actual)} to include ${show(v)}`, `expected ${show(actual)} not to include ${show(v)}`),
        above: n => check(actual > n, `expected ${show(actual)} to be above ${n}`, `expected ${show(actual)} not to be above ${n}`),
        below: n => check(actual < n, `expected ${show(actual)} to be below ${n}`, `expected ${show(actual)} not to be below ${n}`),
        least: n => check(actual >= n, `expected ${show(actual)} to be at least ${n}`, `expected ${show(actual)} to be below ${n}`),
        most: n => check(actual <= n, `expected ${show(actual)} to be at most ${n}`, `expected ${show(actual)} to be above ${n}`),
        a: t => check(typeOf(actual) === t.toLowerCase(), `expected ${show(actual)} to be a ${t}`, `expected ${show(actual)} not to be a ${t}`),
        oneOf: list => check(list.some(x => deepEqual(x, actual)), `expected ${show(actual)} to be one of ${show(list)}`, `expected ${show(actual)} not to be one of ${show(list)}`),
        match: re => check(re.test(String(actual)), `expected ${show(actual)} to match ${re}`, `expected ${show(actual)} not to match ${re}`),
        property: (name, ...val) => {
            const has = actual != null && Object.prototype.hasOwnProperty.call(Object(actual), name);
            if (!val.length) return check(has, `expected ${show(actual)} to have property "${name}"`, `expected ${show(actual)} not to have property "${name}"`);
            return check(has && deepEqual(actual[name], val[0]), `expected property "${name}" to be ${show(val[0])} but got ${show(actual?.[name])}`, `expected property "${name}" not to be ${show(val[0])}`);
        },
        lengthOf: n => check(actual?.length === n, `expected length ${n} but got ${actual?.length}`, `expected length not to be ${n}`),
        keys: (...k) => { const keys = k.flat(); return check(actual && keys.every(x => x in actual), `expected ${show(actual)} to have keys ${show(keys)}`, `expected ${show(actual)} not to have keys ${show(keys)}`); },
    });
    chain.an = chain.a; chain.contain = chain.include; chain.includes = chain.include; chain.contains = chain.include;
    chain.equals = chain.equal; chain.eq = chain.equal; chain.greaterThan = chain.above; chain.gt = chain.above; chain.lessThan = chain.below; chain.lt = chain.below;
    chain.length = chain.lengthOf;
    return chain;
}

// ============================================================
// pm sandbox
// ============================================================
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

/**
 * Context shared by a request's pre-request and post-response scripts:
 *   dto            request being sent (pre-request scripts may change it)
 *   envId/envVars  active environment and a working copy of its variables
 *   localVars      pm.variables.set values, applied to this request only
 *   iterationData  current runner data row (or {})
 *   tests          pm.test results
 */
function createScriptContext(dto, { requestName, iterationData, iteration, envId } = {}) {
    const env = state.environments.find(e => String(e.id) === String(envId ?? $('envSelect').value));
    return {
        dto, env,
        envVars: { ...parseEnvVars(env?.variables) },
        envDirty: false,
        envChanges: new Map(), // key -> value, or undefined for unset
        localVars: {},
        iterationData: iterationData || {},
        iteration: iteration ?? 0,
        requestName: requestName || dto.name || 'Untitled Request',
        tests: [],
        pending: [],
    };
}

function headerApi(getObj, setObj) {
    const find = k => Object.keys(getObj()).find(h => h.toLowerCase() === String(k).toLowerCase());
    return {
        get: k => { const h = find(k); return h ? getObj()[h] : undefined; },
        has: k => !!find(k),
        add: ({ key, value }) => { const o = { ...getObj() }; o[key] = String(value ?? ''); setObj(o); },
        upsert: ({ key, value }) => { const o = { ...getObj() }; const h = find(key); if (h) delete o[h]; o[key] = String(value ?? ''); setObj(o); },
        remove: k => { const o = { ...getObj() }; const h = find(k); if (h) { delete o[h]; setObj(o); } },
        toObject: () => ({ ...getObj() }),
        all: () => Object.entries(getObj()).map(([key, value]) => ({ key, value })),
    };
}

function responseApi(result) {
    const body = result.responseBody ?? '';
    let parsed;
    const json = () => {
        if (parsed === undefined) {
            try { parsed = JSON.parse(body); } catch (e) { throw new Error('The response body is not valid JSON'); }
        }
        return parsed;
    };
    const headers = headerApi(() => result.responseHeaders || {}, () => {});
    const res = {
        code: result.statusCode,
        status: STATUS_TEXT[result.statusCode] || '',
        responseTime: result.responseTimeMs,
        responseSize: result.responseSizeBytes,
        headers,
        json, text: () => body,
    };
    const expectStatus = c => { if (result.statusCode !== c) throw new AssertionError(`expected response to have status ${c} but got ${result.statusCode}`); };
    res.to = {
        have: {
            status: c => typeof c === 'number' ? expectStatus(c) : (res.status.toLowerCase() === String(c).toLowerCase() || (() => { throw new AssertionError(`expected status "${c}" but got "${res.status}"`); })()),
            header: (k, v) => {
                if (!headers.has(k)) throw new AssertionError(`expected response to have header "${k}"`);
                if (v !== undefined && headers.get(k) !== v) throw new AssertionError(`expected header "${k}" to be "${v}" but got "${headers.get(k)}"`);
            },
            body: v => { if (v !== undefined && !body.includes(v)) throw new AssertionError(`expected body to contain "${v}"`); },
            jsonBody: (path, v) => { const j = json(); if (path !== undefined) { const got = String(path).split('.').reduce((o, k) => o?.[k], j); if (v !== undefined ? !deepEqual(got, v) : got === undefined) throw new AssertionError(`expected JSON ${path}${v !== undefined ? ` to be ${JSON.stringify(v)}` : ' to exist'}`); } },
        },
        be: {},
    };
    const range = (name, lo, hi) => Object.defineProperty(res.to.be, name, { get: () => { if (!(result.statusCode >= lo && result.statusCode < hi)) throw new AssertionError(`expected response to be ${name} but got ${result.statusCode}`); return true; } });
    range('ok', 200, 300); range('success', 200, 300); range('redirection', 300, 400); range('clientError', 400, 500); range('serverError', 500, 600); range('error', 400, 600);
    res.to.be.json = undefined;
    Object.defineProperty(res.to.be, 'json', { get: () => { json(); return true; } });
    return res;
}

function buildPm(ctx, eventName, result) {
    const envApi = {
        get name() { return ctx.env?.name; },
        get: k => ctx.envVars[k],
        set: (k, v) => {
            if (!ctx.env) { logToConsole('warn', 'pm.environment', [`pm.environment.set("${k}") ignored: no environment is selected`]); return; }
            ctx.envVars[k] = typeof v === 'string' ? v : JSON.stringify(v);
            ctx.envChanges.set(k, ctx.envVars[k]);
            ctx.envDirty = true;
        },
        unset: k => { if (k in ctx.envVars) { delete ctx.envVars[k]; ctx.envChanges.set(k, undefined); ctx.envDirty = true; } },
        has: k => Object.prototype.hasOwnProperty.call(ctx.envVars, k),
        toObject: () => ({ ...ctx.envVars }),
        replaceIn: s => substituteVars(s, ctx.envVars),
    };
    const lookup = k => ctx.localVars[k] ?? ctx.iterationData[k] ?? ctx.envVars[k];
    const pm = {
        info: { eventName, requestName: ctx.requestName, iteration: ctx.iteration, requestId: ctx.dto.id ?? null },
        environment: envApi,
        // collection variables and globals share the environment here, so imported Postman scripts keep working
        collectionVariables: envApi,
        globals: envApi,
        variables: {
            get: lookup,
            set: (k, v) => { ctx.localVars[k] = typeof v === 'string' ? v : JSON.stringify(v); },
            has: k => lookup(k) !== undefined,
            replaceIn: s => String(s).replace(/\{\{([^{}]+)\}\}/g, (m, k) => lookup(k) ?? m),
            toObject: () => ({ ...ctx.envVars, ...ctx.iterationData, ...ctx.localVars }),
        },
        iterationData: { get: k => ctx.iterationData[k], has: k => k in ctx.iterationData, toObject: () => ({ ...ctx.iterationData }) },
        request: {
            get url() { return composeUrl(ctx.dto.url || '', queryRows(ctx.dto)); },
            set url(v) {
                const { base, query } = splitUrl(String(v));
                ctx.dto.url = base;
                ctx.dto.paramRows = parseQuery(query);
                ctx.dto.params = rowsToMap(ctx.dto.paramRows, true);
            },
            get method() { return ctx.dto.method; },
            set method(v) { ctx.dto.method = String(v).toUpperCase(); },
            headers: headerApi(() => ctx.dto.headers || {}, o => { ctx.dto.headers = o; }),
            body: {
                get raw() { return ctx.dto.body ?? ''; },
                set raw(v) { ctx.dto.body = typeof v === 'string' ? v : JSON.stringify(v); },
                toString() { return ctx.dto.body ?? ''; },
            },
        },
        expect: makeExpect,
        // Results keep the order tests were declared in; async test bodies are awaited before reporting
        test: (name, fn) => {
            const entry = { testName: name, passed: true, message: 'Passed' };
            ctx.tests.push(entry);
            const fail = e => { entry.passed = false; entry.message = e?.message || String(e); };
            try {
                const r = fn();
                if (r && typeof r.then === 'function') ctx.pending.push(Promise.resolve(r).catch(fail));
            } catch (e) { fail(e); }
        },
        sendRequest: (req, cb) => scriptSendRequest(req, ctx, cb),
    };
    if (result) pm.response = responseApi(result);
    pm.test.skip = name => ctx.tests.push({ testName: name, passed: true, message: 'Skipped' });
    return pm;
}

/** pm.sendRequest(urlOrRequest[, callback]) → Promise<response> */
async function scriptSendRequest(req, ctx, cb) {
    const r = typeof req === 'string' ? { url: req } : req || {};
    const headers = {};
    (Array.isArray(r.header) ? r.header : Object.entries(r.header || r.headers || {}).map(([key, value]) => ({ key, value })))
        .forEach(h => { headers[h.key] = String(h.value); });
    const dto = { method: (r.method || 'GET').toUpperCase(), url: String(r.url), headers, body: r.body?.raw ?? (typeof r.body === 'string' ? r.body : r.body ? JSON.stringify(r.body) : null), bodyType: 'text' };
    const source = `${ctx.requestName} · pm.sendRequest`;
    try {
        const result = await api('POST', '/api/execute' + (ctx.env ? `?environmentId=${ctx.env.id}` : ''), dto);
        logNetwork(source, dto, result);
        const res = responseApi(result);
        if (!result.success) throw new Error(result.error || 'Request failed');
        cb?.(null, res);
        return res;
    } catch (e) {
        cb?.(e, null);
        if (!cb) throw e;
    }
}

function scriptConsole(source) {
    const mk = level => (...args) => logToConsole(level, source, args);
    return { log: mk('log'), info: mk('info'), warn: mk('warn'), error: mk('error'), debug: mk('debug'), table: mk('log'), dir: mk('log') };
}

/** Runs one script; errors are logged and (for post-response) reported as a failed test. */
async function runScript(kind, code, ctx, result = null) {
    if (!code || !code.trim()) return;
    const label = kind === 'prerequest' ? 'Pre-request' : 'Post-response';
    const source = `${ctx.requestName} · ${label}`;
    const pm = buildPm(ctx, kind, result);
    const require = name => { throw new Error(`require("${name}") is not available in Reqly scripts`); };
    try {
        const fn = new AsyncFunction('pm', 'console', 'postman', 'require', '"use strict";\n' + code);
        await fn(pm, scriptConsole(source), { setEnvironmentVariable: pm.environment.set, getEnvironmentVariable: pm.environment.get }, require);
        await Promise.all(ctx.pending.splice(0));
    } catch (e) {
        logToConsole('error', source, [`${e.name || 'Error'}: ${e.message}`]);
        ctx.tests.push({ testName: `${label} script`, passed: false, message: `Script error: ${e.message}` });
    }
    if (ctx.envDirty) await persistScriptEnv(ctx);
}

/**
 * pm.environment.set/unset are saved right away so the server substitutes the new values.
 * Only the keys the script changed are applied, on top of the latest saved environment, so values
 * captured by the server (`json.x -> name`) in the meantime are not overwritten.
 */
async function persistScriptEnv(ctx) {
    ctx.envDirty = false;
    if (!ctx.env) return;
    const latest = (await api('GET', '/api/environments')).find(e => e.id === ctx.env.id) || ctx.env;
    const vars = parseEnvVars(latest.variables);
    ctx.envChanges.forEach((v, k) => { if (v === undefined) delete vars[k]; else vars[k] = v; });
    ctx.envChanges.clear();
    Object.assign(ctx.envVars, vars);
    const saved = await api('POST', '/api/environments', { id: latest.id, name: latest.name, variables: JSON.stringify(vars), secrets: latest.secrets || '[]' });
    Object.assign(ctx.env, saved);
    const local = state.environments.find(e => e.id === saved.id);
    if (local) Object.assign(local, saved);
    renderUrlMirror();
}

/** Pre-request: may edit the request; pm.variables values are filled in before sending. */
async function runPreRequest(ctx, code) {
    await runScript('prerequest', code, ctx);
    if (Object.keys(ctx.localVars).length) ctx.dto = applyDataVars(ctx.dto, ctx.localVars);
    return ctx.dto;
}

async function runPostResponse(ctx, code, result) {
    if (!result.success) return;
    await runScript('test', code, ctx, result);
}

// ============================================================
// Script editor snippets
// ============================================================
const SCRIPT_SNIPPETS = {
    prerequest: [
        ['Log a message', 'console.log("Sending", pm.request.method, pm.request.url);'],
        ['Set an environment variable', 'pm.environment.set("timestamp", Date.now().toString());'],
        ['Set a request-only variable', 'pm.variables.set("requestId", crypto.randomUUID());'],
        ['Add a header', 'pm.request.headers.upsert({ key: "X-Request-Id", value: crypto.randomUUID() });'],
        ['Fetch a token first', 'const res = await pm.sendRequest({\n    url: pm.environment.get("baseUrl") + "/anything",\n    method: "POST",\n    body: { raw: JSON.stringify({ token: "demo" }) }\n});\npm.environment.set("token", res.json().json.token);'],
    ],
    test: [
        ['Log the response', 'console.log(pm.response.code, pm.response.json());'],
        ['Status code is 200', 'pm.test("Status code is 200", () => {\n    pm.response.to.have.status(200);\n});'],
        ['Response time below 500ms', 'pm.test("Response time is below 500ms", () => {\n    pm.expect(pm.response.responseTime).to.be.below(500);\n});'],
        ['JSON value check', 'pm.test("Has an id", () => {\n    const json = pm.response.json();\n    pm.expect(json).to.have.property("id");\n});'],
        ['Save value to environment', 'const json = pm.response.json();\npm.environment.set("token", json.token);\nconsole.log("Saved token", json.token);'],
        ['Header check', 'pm.test("Content-Type is JSON", () => {\n    pm.expect(pm.response.headers.get("Content-Type")).to.include("application/json");\n});'],
    ],
};
