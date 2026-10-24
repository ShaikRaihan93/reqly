// Reqly website: shared header/footer, small interactions, and the settings you will want to change.
const SITE = {
    version: '1.1.0',               // fallback; replaced by the latest GitHub release's version when the page loads
    released: 'October 2026',
    github: 'https://github.com/ShaikRaihan93/reqly',
    // Always the newest release: every release attaches its installer as Reqly.dmg, so this link never changes
    get macDownload() { return `${this.github}/releases/latest/download/Reqly.dmg`; },
    releases: 'https://github.com/ShaikRaihan93/reqly/releases',
    email: 'hello@reqly.app',        // TODO: replace with the inbox you want people to write to
    owner: 'Shaik Raihan',
    prices: { pro: { monthly: 8, yearly: 6 }, team: { monthly: 15, yearly: 12 } }, // USD per user per month
};

const ICONS = {
    menu: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 7h16M4 12h16M4 17h16"/></svg>',
    close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    download: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12m0 0l-5-5m5 5l5-5M4 19h16"/></svg>',
};

const NAV = [['index.html#features', 'Features', 'features'], ['download.html', 'Download', 'download'], ['pricing.html', 'Pricing', 'pricing'],
    ['about.html', 'About', 'about'], ['contact.html', 'Contact', 'contact']];

function renderHeader() {
    const page = document.body.dataset.page;
    const el = document.querySelector('[data-site-header]');
    if (!el) return;
    el.outerHTML = `<header class="site-header">
      <div class="wrap">
        <a class="brand" href="index.html" aria-label="Reqly home"><img src="favicon.svg" alt="" width="30" height="30"><span>REQLY</span></a>
        <nav class="nav" id="siteNav" aria-label="Main">${NAV.map(([href, label, key]) =>
            `<a href="${href}"${key === page ? ' aria-current="page"' : ''}>${label}</a>`).join('')}</nav>
        <div class="header-cta">
          <a class="btn btn-ghost btn-sm" href="${SITE.github}" rel="noopener">GitHub</a>
          <a class="btn btn-primary btn-sm" href="download.html">${ICONS.download}Download</a>
        </div>
        <button class="menu-btn" aria-label="Open menu" aria-expanded="false" aria-controls="siteNav">${ICONS.menu}</button>
      </div>
    </header>`;
    const header = document.querySelector('.site-header');
    const btn = header.querySelector('.menu-btn');
    btn.addEventListener('click', () => {
        const open = header.classList.toggle('open');
        btn.setAttribute('aria-expanded', open);
        btn.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
        btn.innerHTML = open ? ICONS.close : ICONS.menu;
    });
    header.querySelectorAll('.nav a').forEach(a => a.addEventListener('click', () => header.classList.remove('open')));
}

function renderFooter() {
    const el = document.querySelector('[data-site-footer]');
    if (!el) return;
    el.outerHTML = `<footer class="site-footer">
      <div class="wrap">
        <div class="foot">
          <div>
            <a class="brand" href="index.html"><img src="favicon.svg" alt="" width="30" height="30"><span>REQLY</span></a>
            <p>The API client that stays on your machine. Build, test and automate APIs without sending your data to anyone's cloud.</p>
          </div>
          <div><h4>Product</h4><ul>
            <li><a href="index.html#features">Features</a></li><li><a href="download.html">Download</a></li>
            <li><a href="pricing.html">Pricing</a></li><li><a href="${SITE.releases}" rel="noopener">Release notes</a></li></ul></div>
          <div><h4>Company</h4><ul>
            <li><a href="about.html">About</a></li><li><a href="contact.html">Contact</a></li>
            <li><a href="${SITE.github}" rel="noopener">GitHub</a></li></ul></div>
          <div><h4>Legal</h4><ul>
            <li><a href="privacy.html">Privacy Policy</a></li><li><a href="terms.html">Terms &amp; Conditions</a></li>
            <li><a href="${SITE.github}/blob/main/THIRD_PARTY_NOTICES.md" rel="noopener">Open-source licenses</a></li></ul></div>
        </div>
        <div class="legal-bar"><span>© ${new Date().getFullYear()} ${SITE.owner}. All rights reserved.</span><span><span data-site-footer-version>Reqly v${SITE.version}</span> · Made for people who test APIs</span></div>
      </div>
    </footer>`;
}

/** Fills [data-site="key"] text and [data-href="key"] links from SITE, so the values live in one place. */
function fillSiteValues() {
    document.querySelectorAll('[data-site]').forEach(el => { el.textContent = SITE[el.dataset.site]; });
    document.querySelectorAll('[data-href]').forEach(el => {
        const key = el.dataset.href;
        el.href = key === 'email' ? `mailto:${SITE.email}` : SITE[key];
    });
}

function initReveal() {
    const items = document.querySelectorAll('.reveal');
    if (!('IntersectionObserver' in window)) { items.forEach(i => i.classList.add('in')); return; }
    const io = new IntersectionObserver(entries => entries.forEach(e => {
        if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
    }), { rootMargin: '0px 0px -60px 0px' });
    items.forEach(i => io.observe(i));
}

/** Accessible tabs: buttons [role=tab][aria-controls] switch [role=tabpanel] siblings; arrow keys move between tabs. */
function initTabs() {
    document.querySelectorAll('[role=tablist]').forEach(list => {
        const tabs = [...list.querySelectorAll('[role=tab]')];
        const select = t => tabs.forEach(x => {
            const on = x === t;
            x.setAttribute('aria-selected', on);
            x.tabIndex = on ? 0 : -1;
            document.getElementById(x.getAttribute('aria-controls')).hidden = !on;
        });
        tabs.forEach((t, i) => {
            t.addEventListener('click', () => select(t));
            t.addEventListener('keydown', e => {
                const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
                if (!d) return;
                const next = tabs[(i + d + tabs.length) % tabs.length];
                select(next); next.focus();
            });
        });
    });
}

function initPricing() {
    const toggle = document.querySelector('.billing');
    if (!toggle) return;
    const set = period => {
        toggle.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', b.dataset.period === period));
        document.querySelectorAll('[data-price]').forEach(el => { el.textContent = '$' + SITE.prices[el.dataset.price][period]; });
        document.querySelectorAll('[data-price-note]').forEach(el => {
            const p = SITE.prices[el.dataset.priceNote];
            el.textContent = period === 'yearly' ? `per user / month, billed $${p.yearly * 12} yearly` : 'per user / month, billed monthly';
        });
    };
    toggle.querySelectorAll('button').forEach(b => b.addEventListener('click', () => set(b.dataset.period)));
    set('yearly');
}

/** No backend: the form composes an email in the visitor's mail app. */
function initContactForm() {
    const form = document.querySelector('form.contact');
    if (!form) return;
    const topic = new URLSearchParams(location.search).get('topic');
    if (topic && [...form.topic.options].some(o => o.value === topic)) form.topic.value = topic;
    form.addEventListener('submit', e => {
        e.preventDefault();
        if (!form.reportValidity()) return;
        const subject = `[Reqly] ${form.topic.value}: ${form.name.value}`;
        const body = `${form.message.value}\n\n— ${form.name.value} <${form.email.value}>${form.company.value ? `\n${form.company.value}` : ''}`;
        location.href = `mailto:${SITE.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
        form.querySelector('.form-note').textContent = 'Your email app should open with the message ready to send. If it does not, write to ' + SITE.email + '.';
    });
}

/** Shows the version of the newest release, so publishing a release is all it takes to update the site. */
async function loadLatestVersion() {
    try {
        const r = await fetch('https://api.github.com/repos/ShaikRaihan93/reqly/releases/latest', { headers: { Accept: 'application/vnd.github+json' } });
        if (!r.ok) return;
        const rel = await r.json();
        const v = String(rel.tag_name || '').replace(/^v/, '');
        if (!/^\d+\.\d+\.\d+$/.test(v)) return;
        SITE.version = v;
        if (rel.published_at) SITE.released = new Date(rel.published_at).toLocaleDateString('en', { month: 'long', year: 'numeric' });
        document.querySelectorAll('[data-site="version"], [data-site="released"]').forEach(el => { el.textContent = SITE[el.dataset.site]; });
        document.querySelectorAll('[data-site-footer-version]').forEach(el => { el.textContent = `Reqly v${v}`; });
    } catch (e) { /* offline or rate-limited: keep the built-in values */ }
}

renderHeader();
renderFooter();
fillSiteValues();
loadLatestVersion();
initReveal();
initTabs();
initPricing();
initContactForm();
