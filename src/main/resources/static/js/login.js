'use strict';
(() => {
    const $ = id => document.getElementById(id);
    let mode = 'signin';

    function setMode(m) {
        mode = m;
        document.body.dataset.mode = m;
        ['tabSignin', 'tabSignup'].forEach(id => {
            const on = $(id).dataset.mode === m;
            $(id).classList.toggle('active', on);
            $(id).setAttribute('aria-selected', on);
        });
        $('authTitle').textContent = m === 'signin' ? 'Welcome back' : 'Create your account';
        $('authSub').textContent = m === 'signin' ? 'Sign in to open your workspace.' : 'Your workspace, your data, on this computer.';
        $('authSubmit').querySelector('span').textContent = m === 'signin' ? 'Sign in' : 'Create account';
        $('password').autocomplete = m === 'signin' ? 'current-password' : 'new-password';
        showError('');
        (m === 'signup' ? $('name') : $('email')).focus();
    }

    function showError(msg) {
        $('authError').textContent = msg;
        $('authCard').classList.toggle('has-error', !!msg);
        if (msg) { $('authCard').classList.remove('shake'); void $('authCard').offsetWidth; $('authCard').classList.add('shake'); }
    }

    // Rough strength: length plus character variety
    function strength(pw) {
        if (!pw) return [0, 'Use at least 8 characters'];
        let score = Math.min(4, Math.floor(pw.length / 4));
        [/[a-z]/, /[A-Z]/, /\d/, /[^\w]/].forEach(r => { if (r.test(pw)) score++; });
        if (pw.length < 8) return [1, `${8 - pw.length} more character${pw.length === 7 ? '' : 's'}`];
        return score >= 7 ? [4, 'Strong password'] : score >= 5 ? [3, 'Good password'] : [2, 'Okay, longer is stronger'];
    }
    $('password').addEventListener('input', () => {
        const [s, text] = strength($('password').value);
        $('strengthBar').style.width = (s * 25) + '%';
        $('strengthBar').dataset.level = s;
        $('strengthText').textContent = text;
    });

    $('pwToggle').addEventListener('click', () => {
        const show = $('password').type === 'password';
        $('password').type = show ? 'text' : 'password';
        $('pwToggle').setAttribute('aria-label', show ? 'Hide password' : 'Show password');
        $('pwToggle').classList.toggle('on', show);
    });

    document.querySelectorAll('.auth-tabs [data-mode]').forEach(b => b.addEventListener('click', () => setMode(b.dataset.mode)));

    $('authForm').addEventListener('submit', async e => {
        e.preventDefault();
        const email = $('email').value.trim(), password = $('password').value;
        if (mode === 'signup') {
            if (!$('name').value.trim()) return showError('Please enter your name');
            if (password.length < 8) return showError('Use at least 8 characters for your password');
            if (password !== $('password2').value) return showError("The passwords don't match");
        }
        if (!email || !password) return showError('Enter your email and password');
        const btn = $('authSubmit');
        btn.disabled = true;
        btn.classList.add('loading');
        try {
            const res = await fetch(`/api/auth/${mode}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: $('name').value, email, password, remember: $('remember').checked }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data.error || 'Something went wrong. Please try again');
            document.body.classList.add('auth-success');
            setTimeout(() => { location.href = '/'; }, 450);
        } catch (err) {
            showError(err.message);
            btn.disabled = false;
            btn.classList.remove('loading');
        }
    });

    $('forgotLink').addEventListener('click', e => {
        e.preventDefault();
        const email = $('email').value.trim() || 'you@company.com';
        $('resetCmd').textContent = `./gradlew bootRun --args='--reqly.reset-password=${email}'`;
        $('forgotModal').classList.add('active');
        $('forgotClose').focus();
    });
    $('forgotClose').addEventListener('click', () => $('forgotModal').classList.remove('active'));
    document.addEventListener('keydown', e => { if (e.key === 'Escape') $('forgotModal').classList.remove('active'); });

    const THEMES = ['scifi', 'dark', 'light'];
    $('authTheme').addEventListener('click', () => {
        const next = THEMES[(THEMES.indexOf(document.documentElement.dataset.theme) + 1) % THEMES.length];
        document.documentElement.dataset.theme = next;
        try { localStorage.setItem('reqly.uiTheme', JSON.stringify(next)); } catch (e) { /* private mode */ }
    });

    fetch('/api/auth/status').then(r => r.json()).then(s => {
        if (s.user) { location.href = '/'; return; }
        if (!s.hasUsers) { $('firstRunNote').hidden = false; setMode('signup'); }
        else setMode('signin');
    }).catch(() => setMode('signin'));
})();
