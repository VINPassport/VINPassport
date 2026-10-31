/**
 * The manufacturer application form: deliver it, say what happened, and never
 * pretend it went somewhere it did not.
 *
 * Two ways out, chosen from the markup rather than here:
 *
 *   mail     The default while no form service is connected. The form writes
 *            the application into an email in the applicant's own mail app,
 *            addressed to the form's `data-contact`, and they send it. Nothing
 *            leaves this page and no third party sees it. A copy button covers
 *            applicants whose mail lives in a browser tab, where a mailto link
 *            opens nothing.
 *   service  When the form's `action` is a form service we accept (and, for
 *            Web3Forms, its public `access_key` is filled in), the application
 *            is posted there and emailed on. The body goes as
 *            application/x-www-form-urlencoded with only an Accept header, so
 *            the request stays CORS-simple: no preflight, and both Web3Forms
 *            and an Apps Script web app parse it.
 *
 * FAILS CLOSED. The button is disabled in the markup and only this script
 * enables it, and only when one of the two ways out is valid. That also closes
 * a race: a module waits for the page's stylesheets, Google Fonts included, so
 * on a slow connection an enabled button could be pressed before this ran and
 * the browser would post the form natively, around everything below.
 *
 * SPDX-License-Identifier: Apache-2.0
 */
const form = document.getElementById('apply-form');
const done = document.getElementById('apply-done');
const status = document.getElementById('apply-status');
const button = form?.querySelector('button[type="submit"]');
const copy = document.getElementById('apply-copy');

const ALLOWED = ['https://api.web3forms.com/submit', 'https://script.google.com/macros/s/'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL = /^[^\s@<>"]+@[^\s@<>"]+\.[a-z]{2,}$/i;
// Form plumbing, never part of what the applicant wrote.
const PLUMBING = new Set(['access_key', 'subject', 'from_name', 'botcheck']);

const say = (text, tone = '') => {
    status.textContent = text;
    if (tone) status.dataset.tone = tone; else delete status.dataset.tone;
};

const showDone = () => {
    form.hidden = true;
    done.hidden = false;
    done.focus();
};

/** Where the form posts, or null when it is not wired to anything we accept. */
function endpoint() {
    const url = form.getAttribute('action') || '';
    if (!ALLOWED.some((a) => url.startsWith(a))) return null;
    if (url.startsWith(ALLOWED[0]) && !UUID.test(form.elements.access_key?.value || '')) return null;
    return url;
}

const contact = () => (EMAIL.test(form.dataset.contact || '') ? form.dataset.contact : null);

/** The subject line is what the inbox shows, so it names the organisation. */
const subjectOf = (data) => {
    const org = String(data.get('Organisation') || '').trim();
    return org ? `VINPassport manufacturer application: ${org}` : 'VINPassport manufacturer application';
};

/** The application as plain text: one line per answer, ticked boxes grouped. */
function letterOf(data) {
    const lines = ['VINPassport manufacturer application', ''];
    const groups = { 'Vehicle categories': [], 'Interests': [] };
    let message = '';
    for (const [name, raw] of data) {
        const value = String(raw).trim();
        if (PLUMBING.has(name) || !value) continue;
        if (name.startsWith('Category ')) groups['Vehicle categories'].push(name.slice(9));
        else if (name.startsWith('Interest: ')) groups.Interests.push(name.slice(10));
        else if (name === 'Message') message = value;
        else lines.push(`${name === 'email' ? 'Email' : name}: ${value}`);
    }
    for (const [label, items] of Object.entries(groups)) if (items.length) lines.push(`${label}: ${items.join(', ')}`);
    if (message) lines.push('', 'Message:', message);
    return lines.join('\n');
}

/** Hand the letter to the applicant's mail app. A link click, because that is
 *  what a mail app is registered to answer. */
function openMail(to, data) {
    const crlf = (s) => s.replace(/\r?\n/g, '\r\n');      // RFC 6068: line breaks are CRLF
    const a = document.createElement('a');
    a.href = `mailto:${to}?subject=${encodeURIComponent(subjectOf(data))}&body=${encodeURIComponent(crlf(letterOf(data)))}`;
    a.hidden = true;
    document.body.append(a);
    a.click();
    a.remove();
}

async function post(url, data) {
    data.set('subject', subjectOf(data));
    button.disabled = true;
    say('Sending…');
    try {
        const res = await fetch(url, {
            method: 'POST',
            headers: { Accept: 'application/json' },
            body: new URLSearchParams(data)
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok || body.success !== true) throw new Error(body.message || `HTTP ${res.status}`);
        say('');
        showDone();
    } catch {
        button.disabled = false;
        const to = contact();
        say(`Nothing was sent. Check your connection and try again.${to ? ` If it keeps failing, write to ${to}.` : ''}`, 'error');
    }
}

if (form && done && status && button) {
    const MODE = endpoint() ? 'service' : (contact() ? 'mail' : null);
    if (MODE) button.disabled = false;
    else say('Applications are not connected yet, so this form sends nothing.', 'error');
    if (MODE === 'mail') {
        button.textContent = 'EMAIL YOUR APPLICATION';
        if (copy) copy.hidden = false;
    }

    form.addEventListener('submit', (event) => {
        event.preventDefault();
        const data = new FormData(form);
        if (data.get('botcheck')) return;                   // the honeypot was ticked
        if (MODE === 'service') return post(endpoint(), data);
        if (MODE !== 'mail') return;
        openMail(contact(), data);
        say(`Your email app should now be open with the application addressed to ${contact()}. Send it from there. If nothing opened, use COPY IT INSTEAD and paste it into an email.`);
    });

    copy?.addEventListener('click', async () => {
        if (!form.reportValidity()) return;                 // the same checks as sending
        const data = new FormData(form);
        try {
            await navigator.clipboard.writeText(`To: ${contact()}\nSubject: ${subjectOf(data)}\n\n${letterOf(data)}`);
            say(`Copied. Paste it into a new email to ${contact()}.`);
        } catch {
            say(`Copying was blocked by the browser. Write to ${contact()} instead.`, 'error');
        }
    });
}
