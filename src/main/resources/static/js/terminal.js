'use strict';
/*
 * Reqly terminal: a command line inside the app (not a system shell).
 * Runs curl commands and quick requests through Reqly, and drives environments, collections
 * and the runner. Everything it can do, the UI can do too. Loaded after app.js and scripting.js.
 */

const term = { history: lsGet('reqly.termHistory', []), hIndex: -1, draft: '', busy: false, cancel: false, ctrl: null, last: null };

const TERM_HELP = [
    ['curl …', 'Run a curl command through Reqly (paste it straight in)'],
    ['get|post|put|patch|delete <url> [body]', 'Quick request, e.g. post {{baseUrl}}/anything {"a":1}'],
    ['send', 'Send the request in the active tab'],
    ['body | headers', 'Show the full body / headers of the last response'],
    ['jp <path>', 'JSONPath on the last response, e.g. jp $..id'],
    ['open <name>', 'Open a saved request in a tab'],
    ['ls [folder]', 'List collections and requests'],
    ['run <folder> [-n N] [--env NAME]', 'Run a collection or folder (scripts and tests included)'],
    ['env', 'Show the active environment'],
    ['env ls | use <name|none> | get <key> | set <key> <value> | unset <key>', 'Work with environments'],
    ['echo <text>', 'Print text with {{variables}} filled in'],
    ['history [n]', 'Recently sent requests'],
    ['theme [scifi|dark|light]', 'Switch theme'],
    ['export', 'Download a backup of everything'],
    ['clear', 'Clear the terminal (also Ctrl+L)'],
];
const TERM_COMMANDS = ['help', 'curl', 'get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'send', 'body', 'headers', 'jp', 'open', 'ls', 'run', 'env', 'echo', 'history', 'theme', 'export', 'clear'];

// ---------- Output ----------
function termPrint(html, cls = '') {
    const line = document.createElement('div');
    line.className = 'term-line ' + cls;
    line.innerHTML = html;
    $('termOut').appendChild(line);
    while ($('termOut').children.length > 3000) $('termOut').firstElementChild.remove();
    termScrollToEnd();
    return line;
}
const termText = (text, cls = '') => termPrint(esc(text), cls);
const termOk = text => termPrint(`<span class="t-ok">✓</span> ${esc(text)}`);
const termErr = text => termPrint(`<span class="t-err">✗ ${esc(text)}</span>`);
const termDim = text => termPrint(`<span class="t-dim">${esc(text)}</span>`);

function termScrollToEnd() { const o = $('termOut'); o.scrollTop = o.scrollHeight; }
function termClear() { $('termOut').innerHTML = ''; }

function termBanner() {
    termPrint(`<span class="t-brand">REQLY</span> <span class="t-dim">terminal</span>`);
    termDim('Paste a curl command, or type help. ↑/↓ history · Tab completes · Ctrl+C cancels · Ctrl+L clears');
}

/** Prints a response the way a shell would: status line, then the (pretty) body, truncated. */
function termPrintResult(result, maxLines = 60) {
    if (!result.success) return termErr(result.error || 'Request failed');
    const c = result.statusCode;
    termPrint(`<span class="status-badge ${statusClass(c)}">${c} ${esc(STATUS_TEXT[c] || '')}</span> <span class="t-dim">${formatMs(result.responseTimeMs)} · ${formatBytes(result.responseSizeBytes)}</span>`);
    printBody(result.responseBody || '', maxLines);
    const tests = result.testResults || [];
    if (tests.length) {
        const passed = tests.filter(t => t.passed).length;
        termPrint(`<span class="${passed === tests.length ? 't-ok' : 't-err'}">${passed}/${tests.length} tests passed</span>`);
        tests.filter(t => !t.passed).forEach(t => termErr(`${t.testName}: ${t.message}`));
    }
}

function printBody(body, maxLines) {
    if (!body) return termDim('(empty body)');
    let text = body, isJson = false;
    try { JSON.parse(body); text = prettyJson(body); isJson = true; } catch (e) { /* plain text */ }
    const lines = text.split('\n');
    const shown = maxLines ? lines.slice(0, maxLines) : lines;
    termPrint(`<pre class="term-pre">${isJson ? highlightJson(shown.join('\n')) : esc(shown.join('\n'))}</pre>`);
    if (shown.length < lines.length) termDim(`… ${lines.length - shown.length} more lines. Type "body" to see everything`);
}

// ---------- Parsing ----------
/** Splits like a shell: quotes group words, backslash escapes. */
function termSplit(line) {
    const out = [];
    let cur = '', q = null, has = false;
    for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (q) {
            if (c === q) q = null;
            else if (c === '\\' && q === '"' && i + 1 < line.length) cur += line[++i];
            else cur += c;
        } else if (c === '"' || c === "'") { q = c; has = true; }
        else if (c === '\\' && i + 1 < line.length) cur += line[++i];
        else if (/\s/.test(c)) { if (cur || has) out.push(cur); cur = ''; has = false; }
        else cur += c;
    }
    if (cur || has) out.push(cur);
    return out;
}

function takeFlag(args, ...names) {
    const i = args.findIndex(a => names.includes(a));
    if (i < 0) return null;
    const v = args[i + 1];
    args.splice(i, 2);
    return v ?? '';
}

function bestMatch(items, query, label = x => x.name) {
    const q = query.toLowerCase().trim();
    return items.map(it => ({ it, s: fuzzyScore(label(it), q) })).filter(x => x.s != null).sort((a, b) => b.s - a.s)[0]?.it || null;
}

function allRequests() {
    const out = [];
    const walk = (folders, path) => folders.forEach(f => {
        f.requests.forEach(r => out.push({ ...r, path: [...path, f.name].join(' / ') }));
        walk(f.folders, [...path, f.name]);
    });
    walk(state.tree.collections, []);
    state.tree.requests.forEach(r => out.push({ ...r, path: 'Unsorted' }));
    return out;
}

// ---------- Running requests ----------
async function termExecute(dto, label) {
    const ctrl = new AbortController();
    term.ctrl = ctrl;
    const shown = wireRequest(dto, currentEnvVars());
    termPrint(`<span class="t-dim">→</span> <span class="method-badge method-${methodClass(shown.method)}">${shortMethod(shown.method)}</span> ${esc(shown.url)}`);
    const spin = termPrint('<span class="spinner"></span> <span class="t-dim">waiting for response… (Ctrl+C to cancel)</span>');
    try {
        const result = await api('POST', '/api/execute' + envQuery(), prepareForSend(dto), { signal: ctrl.signal });
        spin.remove();
        logNetwork(label, shown, result);
        recordTelemetry(result.success && result.statusCode < 400);
        term.last = result;
        termPrintResult(result);
        if (result.captureEnvironment) await loadEnvironments();
        return result;
    } catch (e) {
        spin.remove();
        termErr(e.name === 'AbortError' ? 'Cancelled' : e.message);
    } finally {
        term.ctrl = null;
    }
}

async function cmdCurl(line) {
    const dto = await api('POST', '/api/import/curl', { curl: line });
    if (!dto.url) return termErr('Could not find a URL in that curl command');
    await termExecute(dto, 'Terminal · curl');
}

async function cmdQuick(method, args) {
    const [url, ...rest] = args;
    if (!url) return termErr(`usage: ${method.toLowerCase()} <url> [body]`);
    const body = rest.join(' ') || null;
    let isJson = false;
    if (body) { try { JSON.parse(body); isJson = true; } catch (e) { /* text */ } }
    const { base, query } = splitUrl(url);
    const rows = parseQuery(query);
    await termExecute({ method, url: base, paramRows: rows, params: rowsToMap(rows, true), headers: {}, body, bodyType: body ? (isJson ? 'raw' : 'text') : 'none' }, `Terminal · ${method}`);
}

async function cmdSend() {
    const tab = activeTab();
    if (!buildRequestDto().url) return termErr('The active tab has no URL');
    termDim(`Sending "${tabTitle(tab)}" from the active tab…`);
    await sendRequest();
    if (tab.result) { term.last = tab.result; termPrintResult(tab.result); }
}

function cmdLs(args) {
    const q = args.join(' ');
    let roots = state.tree.collections;
    if (q) {
        const f = bestMatch(allFolders(), q);
        if (!f) return termErr(`No folder matches "${q}"`);
        roots = [f];
    }
    const walk = (f, depth) => {
        termPrint(`${'  '.repeat(depth)}<span class="t-folder">${depth ? '▸' : '■'} ${esc(f.name)}</span> <span class="t-dim">${countRequests(f)}</span>`);
        f.folders.forEach(c => walk(c, depth + 1));
        f.requests.forEach(r => termPrint(`${'  '.repeat(depth + 1)}<span class="method-badge method-${methodClass(r.method)}">${shortMethod(r.method)}</span> ${esc(r.name)}`));
    };
    roots.forEach(f => walk(f, 0));
    if (!q && state.tree.requests.length) {
        termPrint('<span class="t-folder">■ Unsorted</span>');
        state.tree.requests.forEach(r => termPrint(`  <span class="method-badge method-${methodClass(r.method)}">${shortMethod(r.method)}</span> ${esc(r.name)}`));
    }
    if (!roots.length) termDim('No collections yet');
}

async function cmdOpen(args) {
    const q = args.join(' ');
    if (!q) return termErr('usage: open <request name>');
    const r = bestMatch(allRequests(), q);
    if (!r) return termErr(`No request matches "${q}"`);
    await openRequest(r.id);
    termOk(`Opened ${r.name}  (${r.path})`);
}

async function cmdEnv(args) {
    const sub = args[0];
    const env = activeEnv();
    if (!sub) {
        if (!env) return termDim('No environment selected. Try: env use <name>');
        termPrint(`<span class="t-ok">●</span> <b>${esc(env.name)}</b>`);
        const vars = Object.entries(parseEnvVars(env.variables));
        if (!vars.length) return termDim('(no variables)');
        const w = Math.min(28, Math.max(...vars.map(([k]) => k.length)));
        vars.forEach(([k, v]) => termPrint(`  <span class="j-key">${esc(k.padEnd(w))}</span>  ${esc(displayValue(k, v, env))}`));
        return;
    }
    if (sub === 'ls') {
        if (!state.environments.length) return termDim('No environments yet');
        state.environments.forEach(e => termPrint(`${e.id === env?.id ? '<span class="t-ok">●</span>' : ' '} ${esc(e.name)} <span class="t-dim">${Object.keys(parseEnvVars(e.variables)).length} vars</span>`));
        return;
    }
    if (sub === 'use') {
        const q = args.slice(1).join(' ');
        const target = q.toLowerCase() === 'none' ? null : bestMatch(state.environments, q);
        if (q.toLowerCase() !== 'none' && !target) return termErr(`No environment matches "${q}"`);
        $('envSelect').value = target ? String(target.id) : '';
        $('envSelect').dispatchEvent(new Event('change', { bubbles: true }));
        return termOk(target ? `Active environment: ${target.name}` : 'No environment');
    }
    if (!env) return termErr('Select an environment first: env use <name>');
    const vars = parseEnvVars(env.variables);
    const key = args[1];
    if (sub === 'get') {
        if (!key) return termErr('usage: env get <key>');
        return key in vars ? termText(displayValue(key, vars[key], env)) : termErr(`${key} is not defined in ${env.name}`);
    }
    if (sub === 'set' || sub === 'unset') {
        if (!key) return termErr(`usage: env ${sub} <key>${sub === 'set' ? ' <value>' : ''}`);
        if (sub === 'set') vars[key] = args.slice(2).join(' ');
        else delete vars[key];
        await api('POST', '/api/environments', { id: env.id, name: env.name, variables: JSON.stringify(vars), secrets: env.secrets || '[]' });
        await loadEnvironments();
        return termOk(sub === 'set' ? `${key} saved to ${env.name}` : `${key} removed from ${env.name}`);
    }
    termErr(`Unknown: env ${sub}. Try env ls | use | get | set | unset`);
}

async function cmdRun(args) {
    const n = Math.max(1, parseInt(takeFlag(args, '-n', '--iterations') || '1', 10) || 1);
    const envName = takeFlag(args, '--env', '-e');
    const q = args.join(' ');
    if (!q) return termErr('usage: run <folder> [-n N] [--env NAME]');
    const folder = bestMatch(allFolders(), q);
    if (!folder) return termErr(`No folder matches "${q}"`);
    let env = activeEnv();
    if (envName != null) {
        env = envName.toLowerCase() === 'none' ? null : bestMatch(state.environments, envName);
        if (envName.toLowerCase() !== 'none' && !env) return termErr(`No environment matches "${envName}"`);
    }
    const items = [];
    const walk = (f, path) => { f.requests.forEach(r => items.push({ ...r, path })); f.folders.forEach(c => walk(c, path ? `${path} / ${c.name}` : c.name)); };
    walk(folder, '');
    if (!items.length) return termErr(`${folder.name} has no requests`);
    termPrint(`<span class="t-accent">▶ Running ${esc(folder.name)}</span> <span class="t-dim">${items.length} request${items.length === 1 ? '' : 's'} × ${n} · env: ${esc(env?.name || 'none')}</span>`);
    const envId = env ? String(env.id) : '';
    const stats = { done: 0, passed: 0, failed: 0, errors: 0 };
    const started = Date.now();
    term.cancel = false;
    for (let it = 1; it <= n && !term.cancel; it++) {
        for (const item of items) {
            if (term.cancel) break;
            let result;
            try {
                let dto = await api('GET', `/api/requests/${item.id}`);
                const ctx = createScriptContext(dto, { requestName: item.name, iteration: it - 1, envId });
                if (dto.preRequestScript) dto = await runPreRequest(ctx, dto.preRequestScript);
                result = await api('POST', '/api/execute' + (envId ? `?environmentId=${envId}` : ''), prepareForSend(dto));
                logNetwork(`Terminal run · ${item.name}`, wireRequest(dto, parseEnvVars(env?.variables)), result);
                if (dto.postResponseScript) await runPostResponse(ctx, dto.postResponseScript, result);
                if (ctx.tests.length) result.testResults = [...(result.testResults || []), ...ctx.tests];
                if (result.captureEnvironment) await loadEnvironments();
            } catch (e) {
                result = { success: false, error: e.message, testResults: [] };
            }
            const tests = result.testResults || [];
            const passed = tests.filter(t => t.passed).length;
            stats.done++; stats.passed += passed; stats.failed += tests.length - passed;
            if (!result.success) stats.errors++;
            const good = result.success && passed === tests.length && result.statusCode < 400;
            termPrint(`<span class="${good ? 't-ok' : 't-err'}">${good ? '✓' : '✗'}</span> ${result.success ? `<span class="status-badge ${statusClass(result.statusCode)}">${result.statusCode}</span>` : '<span class="status-badge status-err">ERR</span>'} <span class="method-badge method-${methodClass(item.method)}">${shortMethod(item.method)}</span> ${esc(item.name)}${n > 1 ? ` <span class="t-dim">#${it}</span>` : ''} <span class="t-dim">${result.success ? formatMs(result.responseTimeMs) : esc(result.error || '')}${tests.length ? ` · ${passed}/${tests.length} tests` : ''}</span>`);
            tests.filter(t => !t.passed).forEach(t => termPrint(`    <span class="t-err">✗ ${esc(t.testName)}</span> <span class="t-dim">${esc(t.message || '')}</span>`));
            (result.captures || []).filter(c => c.ok).forEach(c => termPrint(`    <span class="t-accent">↧ {{${esc(c.name)}}}</span> <span class="t-dim">= ${esc(displayValue(c.name, c.value))}</span>`));
        }
    }
    const win = !term.cancel && !stats.failed && !stats.errors;
    termPrint(`<span class="${win ? 't-ok' : 't-err'}">${term.cancel ? '■ Stopped' : win ? '★ All good' : '✗ Problems found'}</span> <span class="t-dim">${stats.done} requests · ${stats.passed} tests passed · ${stats.failed} failed${stats.errors ? ` · ${stats.errors} errors` : ''} · ${formatMs(Date.now() - started)}</span>`);
    playSound(win ? 'win' : 'fail');
}

async function cmdHistory(args) {
    const n = Math.min(100, parseInt(args[0] || '15', 10) || 15);
    const items = (await api('GET', '/api/history')).slice(0, n);
    if (!items.length) return termDim('No history yet');
    items.forEach(h => termPrint(`<span class="t-dim">${new Date(h.executedAt).toLocaleTimeString(undefined, { hour12: false })}</span> ${h.statusCode ? `<span class="status-badge ${statusClass(h.statusCode)}">${h.statusCode}</span>` : '<span class="status-badge status-err">ERR</span>'} <span class="method-badge method-${methodClass(h.method)}">${shortMethod(h.method)}</span> ${esc(h.url)}`));
}

function cmdJp(args) {
    if (!term.last?.success) return termErr('No response yet. Send something first');
    const expr = args.join(' ');
    if (!expr) return termErr('usage: jp <path>, e.g. jp $..id');
    try {
        const tree = parseJsonLossless(term.last.responseBody);
        const found = jsonPath(tree, expr);
        termDim(`${found.length} match${found.length === 1 ? '' : 'es'}`);
        found.slice(0, 200).forEach(n => termPrint(`<pre class="term-pre">${highlightJson(prettyJson(nodeToJson(n)))}</pre>`));
    } catch (e) {
        termErr(e.message.includes('JSON') ? 'The last response is not JSON' : `Invalid path: ${e.message}`);
    }
}

/** Lossless tree node back to compact JSON text (numbers keep their original digits). */
function nodeToJson(n) {
    if (n.t === 'o') return '{' + n.e.map(([, raw, v]) => raw + ':' + nodeToJson(v)).join(',') + '}';
    if (n.t === 'a') return '[' + n.items.map(nodeToJson).join(',') + ']';
    return n.raw;
}

// ---------- Dispatch ----------
async function termRun(raw) {
    const line = raw.trim();
    termPrint(`<span class="term-prompt">reqly ❯</span> ${esc(line)}`, 'term-echo');
    if (!line) return;
    if (term.history[term.history.length - 1] !== line) {
        term.history.push(line);
        if (term.history.length > 200) term.history.shift();
        lsSet('reqly.termHistory', term.history);
    }
    term.hIndex = -1;
    term.busy = true;
    $('terminalPane').classList.add('busy');
    try {
        if (/^curl\s/i.test(line)) return await cmdCurl(line);
        const [cmd, ...args] = termSplit(line);
        const c = cmd.toLowerCase();
        switch (c) {
            case 'help': case '?':
                TERM_HELP.forEach(([u, d]) => termPrint(`<span class="t-accent">${esc(u)}</span><span class="t-dim"> · ${esc(d)}</span>`));
                break;
            case 'clear': case 'cls': termClear(); break;
            case 'get': case 'post': case 'put': case 'patch': case 'delete': case 'head': case 'options':
                await cmdQuick(c.toUpperCase(), args); break;
            case 'send': await cmdSend(); break;
            case 'body': term.last?.success ? printBody(term.last.responseBody || '', 0) : termErr('No response yet'); break;
            case 'headers':
                if (!term.last?.success) { termErr('No response yet'); break; }
                Object.entries(term.last.responseHeaders || {}).forEach(([k, v]) => termPrint(`<span class="j-key">${esc(k)}</span>: ${esc(v)}`));
                break;
            case 'jp': case 'jsonpath': cmdJp(args); break;
            case 'ls': await loadTree(); cmdLs(args); break;
            case 'open': await cmdOpen(args); break;
            case 'run': await loadTree(); await cmdRun(args); break;
            case 'env': await cmdEnv(args); break;
            case 'echo': termText(substituteVars(args.join(' '), currentEnvVars())); break;
            case 'history': await cmdHistory(args); break;
            case 'theme': {
                const t = (args[0] || '').toLowerCase().replace('sci-fi', 'scifi');
                if (t && !THEMES.some(([k]) => k === t)) { termErr('Themes: scifi, dark, light'); break; }
                if (t) { document.documentElement.dataset.theme = t; lsSet('reqly.uiTheme', t); updateThemeButton(); }
                else toggleTheme();
                termOk(`Theme: ${document.documentElement.dataset.theme}`);
                break;
            }
            case 'export': location.href = '/api/export/all'; termOk('Downloading backup…'); break;
            default: {
                const near = TERM_COMMANDS.filter(k => c.startsWith(k) || k.startsWith(c) || fuzzyScore(k, c) != null).slice(0, 3);
                termErr(`Unknown command: ${cmd}${near.length ? `. Did you mean ${near.join(', ')}?` : ''} (type help)`);
            }
        }
    } catch (e) {
        termErr(e.message || String(e));
    } finally {
        term.busy = false;
        term.cancel = false;
        $('terminalPane').classList.remove('busy');
        termScrollToEnd();
    }
}

// ---------- Completion ----------
function termComplete(input) {
    const v = input.value;
    const words = termSplit(v);
    const endsWithSpace = /\s$/.test(v);
    let candidates = [], prefix = '', head = '';
    if (words.length <= 1 && !endsWithSpace) {
        prefix = words[0] || '';
        candidates = TERM_COMMANDS;
    } else {
        const cmd = words[0].toLowerCase();
        const rest = endsWithSpace ? '' : words[words.length - 1];
        const argText = v.slice(v.indexOf(' ') + 1);
        if (cmd === 'env' && words.length >= 2 && words[1] === 'use') {
            head = 'env use '; prefix = v.slice(head.length); candidates = state.environments.map(e => e.name);
        } else if (cmd === 'env') {
            head = 'env '; prefix = rest; candidates = ['ls', 'use', 'get', 'set', 'unset'];
        } else if (cmd === 'open') {
            head = 'open '; prefix = argText; candidates = allRequests().map(r => r.name);
        } else if (cmd === 'run' || cmd === 'ls') {
            head = cmd + ' '; prefix = argText; candidates = allFolders().map(f => f.name);
        } else if (cmd === 'theme') {
            head = 'theme '; prefix = rest; candidates = THEMES.map(([t]) => t);
        }
    }
    const matches = [...new Set(candidates)].filter(c => c.toLowerCase().startsWith(prefix.toLowerCase()));
    if (matches.length === 1) {
        input.value = (head || '') + (head ? matches[0] : matches[0] + ' ');
    } else if (matches.length > 1) {
        let common = matches[0];
        matches.forEach(m => { while (!m.toLowerCase().startsWith(common.toLowerCase())) common = common.slice(0, -1); });
        if (common.length > prefix.length) input.value = (head || '') + common;
        else termPrint(matches.slice(0, 40).map(m => `<span class="t-accent">${esc(m)}</span>`).join('   '), 't-dim');
    }
}

// ---------- Wiring ----------
function initTerminal() {
    termBanner();
    const input = $('termInput');
    input.addEventListener('keydown', e => {
        if (e.key === 'Enter') {
            e.preventDefault();
            if (term.busy) return;
            const v = input.value;
            input.value = '';
            termRun(v);
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            if (!term.history.length) return;
            if (term.hIndex === -1) { term.draft = input.value; term.hIndex = term.history.length; }
            term.hIndex = Math.max(0, term.hIndex - 1);
            input.value = term.history[term.hIndex];
        } else if (e.key === 'ArrowDown') {
            e.preventDefault();
            if (term.hIndex === -1) return;
            term.hIndex++;
            if (term.hIndex >= term.history.length) { term.hIndex = -1; input.value = term.draft; }
            else input.value = term.history[term.hIndex];
        } else if (e.key === 'Tab') {
            e.preventDefault();
            termComplete(input);
        } else if (e.ctrlKey && !e.metaKey && e.key.toLowerCase() === 'c') {
            // Ctrl+C cancels a running command or discards the line; with a selection it still copies
            if (input.selectionStart !== input.selectionEnd) return;
            e.preventDefault();
            if (term.busy) {
                term.cancel = true;
                term.ctrl?.abort();
                termPrint('<span class="t-err">^C</span>');
            } else if (input.value) {
                termPrint(`<span class="term-prompt">reqly ❯</span> ${esc(input.value)}<span class="t-err">^C</span>`, 'term-echo');
                input.value = '';
            }
        } else if (e.ctrlKey && e.key.toLowerCase() === 'l') {
            e.preventDefault();
            termClear();
        }
    });
    // Multi-line curl commands (with trailing backslashes) paste as one line
    input.addEventListener('paste', e => {
        const text = (e.clipboardData || window.clipboardData).getData('text');
        if (!/\n/.test(text)) return;
        e.preventDefault();
        const joined = text.replace(/\\\r?\n\s*/g, ' ').replace(/\r?\n/g, ' ').trim();
        input.setRangeText(joined, input.selectionStart, input.selectionEnd, 'end');
    });
    // Clicking anywhere in the terminal focuses the prompt (unless selecting output)
    $('terminalPane').addEventListener('mouseup', () => { if (!window.getSelection().toString()) input.focus(); });
}
