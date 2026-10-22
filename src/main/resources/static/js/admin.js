'use strict';
/* Reqly admin dashboard: overview, users, table browser, read-only SQL console, backups. */

const $ = id => document.getElementById(id);
const esc = s => s == null ? '' : String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const fmtBytes = b => b == null ? '—' : b < 1024 ? `${b} B` : b < 1048576 ? `${(b / 1024).toFixed(1)} KB` : `${(b / 1048576).toFixed(1)} MB`;
const fmtDate = s => s ? new Date(s).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '—';
const fmtNum = n => n == null ? '—' : Number(n).toLocaleString();
function fmtUptime(ms) {
    const m = Math.floor(ms / 60000), h = Math.floor(m / 60), d = Math.floor(h / 24);
    return d ? `${d}d ${h % 24}h` : h ? `${h}h ${m % 60}m` : `${m}m`;
}

async function api(method, url, body) {
    const res = await fetch(url, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
    if (res.status === 401) { location.href = '/login'; throw new Error('Please sign in'); }
    const text = await res.text();
    const data = text ? JSON.parse(text) : null;
    if (!res.ok) throw new Error(data?.error || `${res.status} ${res.statusText}`);
    return data;
}

let toastTimer;
function toast(msg, isError = false) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.toggle('error', isError);
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), isError ? 4000 : 2200);
}

/** Small promise-based dialog. `html` is trusted markup built here. */
function dialog({ title, html, okText = 'OK', danger = false, cancel = true }) {
    $('adminDialogTitle').textContent = title;
    $('adminDialogBody').innerHTML = html;
    const ok = $('adminDialogOk');
    ok.textContent = okText;
    ok.className = 'btn ' + (danger ? 'btn-danger' : 'btn-primary');
    $('adminDialogCancel').style.display = cancel ? '' : 'none';
    $('adminDialog').classList.add('active');
    setTimeout(() => ($('adminDialogBody').querySelector('input') || ok).focus(), 30);
    return new Promise(resolve => {
        const close = v => { $('adminDialog').classList.remove('active'); resolve(v); };
        ok.onclick = () => close($('adminDialogBody').querySelector('input')?.value ?? true);
        $('adminDialogCancel').onclick = () => close(null);
        $('adminDialog').onkeydown = e => { if (e.key === 'Escape') close(null); if (e.key === 'Enter' && e.target.tagName === 'INPUT') ok.click(); };
    });
}

function cell(v) {
    if (v === null || v === undefined) return '<span class="null">null</span>';
    if (typeof v === 'object' && v.masked) return `<span class="masked">🔒 ${v.masked === 'hash' ? 'hash' : 'encrypted'}</span>`;
    if (typeof v === 'boolean') return `<span class="${v ? 'bool-t' : 'bool-f'}">${v}</span>`;
    return esc(v);
}

const state = { tables: [], view: null, table: null, page: 0, size: 50, q: '', sort: null, dir: 'asc', lastRows: [], lastColumns: [] };

// ---------- Router ----------
function route() {
    const [view, arg] = (location.hash.slice(1) || 'overview').split('/');
    state.view = view;
    document.querySelectorAll('.admin-nav > a').forEach(a => a.classList.toggle('active', a.dataset.view === view));
    document.querySelectorAll('.nav-tables a').forEach(a => a.classList.toggle('active', view === 'tables' && a.dataset.table === arg));
    closeDrawer();
    const main = $('adminMain');
    main.innerHTML = '<div class="hint">Loading…</div>';
    const views = { overview: renderOverview, users: renderUsers, tables: arg ? () => openTable(decodeURIComponent(arg)) : renderTableList, sql: renderSql, backups: renderBackups };
    (views[view] || renderOverview)().catch(e => { main.innerHTML = `<div class="error-box">${esc(e.message)}</div>`; });
    main.focus({ preventScroll: true });
}

async function loadTables() {
    state.tables = await api('GET', '/api/admin/tables');
    $('navTables').innerHTML = state.tables.map(t => `<a href="#tables/${encodeURIComponent(t.name)}" data-table="${esc(t.name)}"><span>${esc(t.name.toLowerCase())}</span><span>${fmtNum(t.rows)}</span></a>`).join('');
}

// ---------- Overview ----------
async function renderOverview() {
    const o = await api('GET', '/api/admin/overview');
    const c = o.counts;
    $('adminMain').innerHTML = `
        <div class="view-head"><h1>Overview</h1><button class="btn" onclick="route()">Refresh</button></div>
        <div class="stat-grid">
            ${[['Users', c.users], ['Collections', c.collections], ['Requests', c.requests], ['Environments', c.environments], ['History', c.history], ['Active sessions', c.sessions]]
                .map(([k, v]) => `<div class="stat"><div class="k">${k}</div><div class="v">${fmtNum(v)}</div></div>`).join('')}
        </div>
        <div class="cards">
            <div class="card"><h2>Database</h2><div class="kv">
                <span>Engine</span><span>${esc(o.database.product)}</span>
                <span>File</span><span>${esc(o.database.file || '—')}</span>
                <span>Size</span><span>${fmtBytes(o.database.sizeBytes)}</span>
                <span>Schema version</span><span>${esc(o.database.schemaVersion || '—')}</span>
            </div></div>
            <div class="card"><h2>Server</h2><div class="kv">
                <span>Started</span><span>${fmtDate(o.server.startedAt)} (up ${fmtUptime(o.server.uptimeMs)})</span>
                <span>Java</span><span>${esc(o.server.java)}</span>
                <span>Memory</span><span>${o.server.memoryUsedMb} MB of ${o.server.memoryMaxMb} MB</span>
                <span>Data folder</span><span>${esc(o.server.dataDir)}</span>
            </div></div>
        </div>
        <div class="cards">
            <div class="card"><h2>Migrations</h2>
                <table class="grid users-table"><thead><tr><th>Version</th><th>Description</th><th>Applied</th><th>OK</th></tr></thead>
                <tbody>${o.migrations.map(m => `<tr><td>${esc(m.version)}</td><td>${esc(m.description)}</td><td>${fmtDate(m.installedOn)}</td><td>${m.success ? '<span class="bool-t">✓</span>' : '<span class="t-err">✗</span>'}</td></tr>`).join('') || '<tr><td colspan="4" class="hint">Flyway is not enabled</td></tr>'}</tbody></table>
            </div>
            <div class="card"><h2>Latest backups <a href="#backups" class="hint">All backups →</a></h2>
                ${o.backups.slice(0, 4).map(b => `<div class="kv" style="grid-template-columns:1fr auto;margin-bottom:4px"><span style="font-family:var(--mono);color:var(--text-primary)">${esc(b.name)}</span><span>${fmtBytes(b.sizeBytes)}</span></div>`).join('') || '<div class="hint">No backups yet</div>'}
            </div>
        </div>`;
}

// ---------- Users ----------
async function renderUsers() {
    const users = await api('GET', '/api/admin/users');
    $('adminMain').innerHTML = `
        <div class="view-head"><h1>Users <small>${users.length}</small></h1></div>
        <div class="grid-wrap"><table class="grid users-table">
            <thead><tr><th>User</th><th>Created</th><th>Last sign-in</th><th>Workspace</th><th>Sessions</th><th>Actions</th></tr></thead>
            <tbody>${users.map(u => `<tr>
                <td><b>${esc(u.name)}</b>${u.admin ? '<span class="badge admin">admin</span>' : ''}${u.you ? '<span class="badge you">you</span>' : ''}<div class="hint">${esc(u.email)}</div></td>
                <td>${fmtDate(u.createdAt)}</td>
                <td>${fmtDate(u.lastLoginAt)}</td>
                <td class="hint">${u.collections} collections · ${u.requests} requests<br>${u.environments} environments · ${u.history} history</td>
                <td>${u.activeSessions}</td>
                <td><div class="row-actions-inline">
                    <button class="btn btn-sm" data-act="admin" data-id="${u.id}" data-admin="${!u.admin}">${u.admin ? 'Remove admin' : 'Make admin'}</button>
                    <button class="btn btn-sm" data-act="signout" data-id="${u.id}" ${u.activeSessions ? '' : 'disabled'}>Sign out</button>
                    <button class="btn btn-sm" data-act="reset" data-id="${u.id}" data-email="${esc(u.email)}">Reset password</button>
                    ${u.you ? '' : `<button class="btn btn-sm" style="color:var(--red)" data-act="delete" data-id="${u.id}" data-email="${esc(u.email)}">Delete</button>`}
                </div></td></tr>`).join('')}</tbody></table></div>`;
    $('adminMain').querySelector('tbody').addEventListener('click', onUserAction);
}

async function onUserAction(e) {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const id = b.dataset.id;
    try {
        if (b.dataset.act === 'admin') {
            await api('POST', `/api/admin/users/${id}/admin`, { admin: b.dataset.admin === 'true' });
            toast('Updated');
        } else if (b.dataset.act === 'signout') {
            const r = await api('POST', `/api/admin/users/${id}/signout`);
            toast(`Ended ${r.sessionsEnded} session${r.sessionsEnded === 1 ? '' : 's'}`);
        } else if (b.dataset.act === 'reset') {
            if (!(await dialog({ title: 'Reset password?', html: `<p>${esc(b.dataset.email)} gets a temporary password and is signed out everywhere.</p>`, okText: 'Reset', danger: true }))) return;
            const r = await api('POST', `/api/admin/users/${id}/reset-password`);
            await dialog({ title: 'Temporary password', html: `<p>Give this to ${esc(b.dataset.email)}. It's shown only once.</p><div class="temp-pw">${esc(r.temporaryPassword)}</div>`, okText: 'Done', cancel: false });
        } else if (b.dataset.act === 'delete') {
            const typed = await dialog({ title: 'Delete account?', html: `<p>This permanently deletes <b>${esc(b.dataset.email)}</b> and everything in their workspace. Type the email to confirm.</p><input class="input" placeholder="${esc(b.dataset.email)}">`, okText: 'Delete account', danger: true });
            if (typed == null) return;
            if (typed.trim().toLowerCase() !== b.dataset.email.toLowerCase()) return toast("The email didn't match. Nothing was deleted", true);
            await api('DELETE', `/api/admin/users/${id}`);
            toast('Account deleted');
            await loadTables();
        }
        renderUsers();
    } catch (err) { toast(err.message, true); }
}

// ---------- Tables ----------
async function renderTableList() {
    await loadTables();
    $('adminMain').innerHTML = `
        <div class="view-head"><h1>Tables <small>${state.tables.length}</small></h1></div>
        <div class="cards">${state.tables.map(t => `<a class="card" href="#tables/${encodeURIComponent(t.name)}" style="text-decoration:none;color:inherit">
            <h2><span style="font-family:var(--mono)">${esc(t.name.toLowerCase())}</span><span class="hint">${fmtNum(t.rows)} rows</span></h2>
            <div class="hint" style="font-family:var(--mono);line-height:1.6">${t.columns.map(c => esc(c.name.toLowerCase()) + (c.secret ? ' 🔒' : '')).join(' · ')}</div></a>`).join('')}</div>`;
}

async function openTable(name) {
    if (state.table !== name) Object.assign(state, { table: name, page: 0, q: '', sort: null, dir: 'asc' });
    const params = new URLSearchParams({ page: state.page, size: state.size });
    if (state.q) params.set('q', state.q);
    if (state.sort) { params.set('sort', state.sort); params.set('dir', state.dir); }
    const d = await api('GET', `/api/admin/tables/${encodeURIComponent(name)}?${params}`);
    state.lastRows = d.rows; state.lastColumns = d.columns;
    const pages = Math.max(1, Math.ceil(d.total / d.size));
    $('adminMain').innerHTML = `
        <div class="view-head">
            <h1>${esc(name.toLowerCase())} <small>${fmtNum(d.total)} rows</small></h1>
            <input class="input search-input" id="tableSearch" placeholder="Search all columns" value="${esc(state.q)}" aria-label="Search rows">
            <button class="btn" id="exportCsv" title="Download this page as CSV">Export CSV</button>
            <button class="btn" onclick="location.hash='#sql';setTimeout(()=>{const e=document.getElementById('sqlInput');e.value='SELECT * FROM ${esc(name)} LIMIT 100';e.focus()},50)">Query in SQL</button>
        </div>
        <div class="grid-wrap"><table class="grid">
            <thead><tr>${d.columns.map(c => `<th data-col="${esc(c.name)}" class="${state.sort === c.name ? 'sorted ' + state.dir : ''}" title="Sort by ${esc(c.name)}">${esc(c.name.toLowerCase())}${c.secret ? ' 🔒' : ''}<small>${esc(c.type.toLowerCase())}${c.nullable ? '' : ' · required'}</small></th>`).join('')}</tr></thead>
            <tbody>${d.rows.map((r, i) => `<tr data-i="${i}">${d.columns.map(c => `<td>${cell(r[c.name])}</td>`).join('')}</tr>`).join('') || `<tr><td colspan="${d.columns.length}" class="hint" style="text-align:center;padding:24px">${state.q ? 'No rows match your search' : 'This table is empty'}</td></tr>`}</tbody>
        </table></div>
        <div class="pager">
            <span>Rows ${d.total ? d.page * d.size + 1 : 0}–${Math.min(d.total, (d.page + 1) * d.size)} of ${fmtNum(d.total)}</span>
            <span class="spacer"></span>
            <label>Per page <select class="select" id="pageSize" style="width:80px;height:28px;display:inline-block">${[25, 50, 100, 250].map(n => `<option ${n === d.size ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
            <button class="btn btn-sm" id="prevPage" ${d.page === 0 ? 'disabled' : ''}>← Prev</button>
            <span>Page ${d.page + 1} / ${pages}</span>
            <button class="btn btn-sm" id="nextPage" ${d.page + 1 >= pages ? 'disabled' : ''}>Next →</button>
        </div>`;
    let t;
    $('tableSearch').addEventListener('input', e => { clearTimeout(t); t = setTimeout(() => { state.q = e.target.value; state.page = 0; openTable(name).then(() => { const s = $('tableSearch'); s.focus(); s.setSelectionRange(s.value.length, s.value.length); }); }, 300); });
    $('prevPage').onclick = () => { state.page--; openTable(name); };
    $('nextPage').onclick = () => { state.page++; openTable(name); };
    $('pageSize').onchange = e => { state.size = +e.target.value; state.page = 0; openTable(name); };
    $('exportCsv').onclick = () => exportCsv(name, d.columns.map(c => c.name), d.rows);
    $('adminMain').querySelector('thead').onclick = e => {
        const th = e.target.closest('th');
        if (!th) return;
        state.dir = state.sort === th.dataset.col && state.dir === 'asc' ? 'desc' : 'asc';
        state.sort = th.dataset.col;
        openTable(name);
    };
    $('adminMain').querySelector('tbody').onclick = e => {
        const tr = e.target.closest('tr[data-i]');
        if (tr) openDrawer(`${name.toLowerCase()} · row`, d.columns.map(c => c.name), d.rows[+tr.dataset.i]);
    };
}

function exportCsv(name, cols, rows) {
    const q = v => {
        const s = v == null ? '' : typeof v === 'object' && v.masked ? `[${v.masked}]` : String(v);
        return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const csv = [cols.join(','), ...rows.map(r => cols.map(c => q(r[c])).join(','))].join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = `${name.toLowerCase()}-page${state.page + 1}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ---------- Row drawer ----------
function openDrawer(title, cols, row) {
    $('drawerTitle').textContent = title;
    $('drawerBody').innerHTML = cols.map(c => {
        const v = row[c];
        let shown;
        if (v && typeof v === 'object' && v.masked) shown = `<span class="masked">🔒 ${v.masked === 'hash' ? 'hash (never shown)' : 'encrypted at rest'}</span>`;
        else if (v == null) shown = '<span class="null">null</span>';
        else {
            let text = String(v);
            try { const j = JSON.parse(text); if (typeof j === 'object') text = JSON.stringify(j, null, 2); } catch (e) { /* not JSON */ }
            shown = `<pre>${esc(text)}</pre>`;
        }
        return `<div class="field-row"><div class="fk">${esc(c.toLowerCase())}</div>${shown}</div>`;
    }).join('');
    $('rowDrawer').classList.add('open');
    $('drawerClose').focus();
}
function closeDrawer() { $('rowDrawer').classList.remove('open'); }

// ---------- SQL console ----------
const EXAMPLES = [
    'SELECT * FROM app_users',
    "SELECT name, method, url FROM api_requests ORDER BY id DESC LIMIT 20",
    'SELECT status_code, COUNT(*) AS n FROM request_history GROUP BY status_code ORDER BY n DESC',
    'SELECT c.name, COUNT(r.id) AS requests FROM collections c LEFT JOIN api_requests r ON r.collection_id = c.id GROUP BY c.name',
    'SHOW TABLES',
];

async function renderSql() {
    const history = (() => { try { return JSON.parse(localStorage.getItem('reqly.adminSql') || '[]'); } catch (e) { return []; } })();
    $('adminMain').innerHTML = `
        <div class="view-head"><h1>SQL console <small>read-only</small></h1><button class="btn btn-primary" id="runSql" title="Run (⌘↵)">Run ⌘↵</button></div>
        <textarea class="code sql-editor" id="sqlInput" spellcheck="false" aria-label="SQL query" placeholder="SELECT * FROM api_requests LIMIT 50">${esc(history[0] || '')}</textarea>
        <div class="chips">${EXAMPLES.map(e => `<button class="chip" data-sql="${esc(e)}">${esc(e.length > 60 ? e.slice(0, 57) + '…' : e)}</button>`).join('')}</div>
        <p class="hint">One SELECT / WITH / EXPLAIN / SHOW statement at a time, max 1,000 rows, 10 s timeout. Nothing can be changed from here; hashes and encrypted values stay masked.</p>
        <div id="sqlResult"></div>`;
    const input = $('sqlInput');
    $('runSql').onclick = () => runSql(input.value);
    input.addEventListener('keydown', e => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); runSql(input.value); } });
    $('adminMain').querySelector('.chips').onclick = e => { const c = e.target.closest('[data-sql]'); if (c) { input.value = c.dataset.sql; runSql(c.dataset.sql); } };
    input.focus();
}

async function runSql(sql) {
    const out = $('sqlResult');
    out.innerHTML = '<div class="hint">Running…</div>';
    try {
        const r = await api('POST', '/api/admin/query', { sql });
        try {
            const h = JSON.parse(localStorage.getItem('reqly.adminSql') || '[]').filter(x => x !== sql);
            localStorage.setItem('reqly.adminSql', JSON.stringify([sql, ...h].slice(0, 20)));
        } catch (e) { /* storage unavailable */ }
        const cols = r.columns.map(c => c.name);
        out.innerHTML = `<div class="sql-meta"><span>${r.rows.length} row${r.rows.length === 1 ? '' : 's'}${r.truncated ? ' (first 1,000 shown)' : ''}</span><span>${r.ms} ms</span><a href="#" id="sqlCsv">Export CSV</a></div>
            <div class="grid-wrap"><table class="grid"><thead><tr>${r.columns.map(c => `<th>${esc(c.name.toLowerCase())}${c.secret ? ' 🔒' : ''}</th>`).join('')}</tr></thead>
            <tbody>${r.rows.map((row, i) => `<tr data-i="${i}">${cols.map(c => `<td>${cell(row[c])}</td>`).join('')}</tr>`).join('') || `<tr><td colspan="${cols.length}" class="hint">No rows</td></tr>`}</tbody></table></div>`;
        out.querySelector('tbody').onclick = e => { const tr = e.target.closest('tr[data-i]'); if (tr) openDrawer('Query result', cols, r.rows[+tr.dataset.i]); };
        $('sqlCsv').onclick = e => { e.preventDefault(); exportCsv('query', cols, r.rows); };
    } catch (err) {
        out.innerHTML = `<div class="error-box">${esc(err.message)}</div>`;
    }
}

// ---------- Backups ----------
async function renderBackups() {
    const list = await api('GET', '/api/admin/backups');
    $('adminMain').innerHTML = `
        <div class="view-head"><h1>Backups <small>${list.length}</small></h1><button class="btn btn-primary" id="backupNow">Back up now</button></div>
        <p class="hint" style="margin-bottom:12px">Reqly backs up the database at every start (the newest 10 are kept) and before any schema migration.
            To restore: quit Reqly, unzip the backup over <code>~/reqly-data/reqly.mv.db</code>, start Reqly.</p>
        <div class="grid-wrap"><table class="grid users-table"><thead><tr><th>File</th><th>Size</th><th>Created</th><th></th></tr></thead>
        <tbody>${list.map(b => `<tr><td style="font-family:var(--mono)">${esc(b.name)}</td><td>${fmtBytes(b.sizeBytes)}</td><td>${fmtDate(b.modified)}</td>
            <td><a class="btn btn-sm" href="/api/admin/backups/${encodeURIComponent(b.name)}" download>Download</a></td></tr>`).join('') || '<tr><td colspan="4" class="hint">No backups yet</td></tr>'}</tbody></table></div>`;
    $('backupNow').onclick = async () => {
        try { const r = await api('POST', '/api/admin/backups'); toast(`Backed up: ${r.name}`); renderBackups(); }
        catch (err) { toast(err.message, true); }
    };
}

// ---------- Init ----------
(async () => {
    try {
        const me = await api('GET', '/api/auth/me');
        $('adminWho').textContent = `${me.name} · ${me.email}`;
        if (!me.admin) { location.href = '/'; return; }
    } catch (e) { return; }
    $('drawerClose').onclick = closeDrawer;
    document.addEventListener('keydown', e => { if (e.key === 'Escape') closeDrawer(); });
    window.addEventListener('hashchange', route);
    await loadTables();
    route();
})();
