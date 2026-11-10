/**
 * The site's three forms (pilot request, contact, lifestyle interest): deliver
 * what was written, say what happened, and never pretend it went somewhere it
 * did not. Generalised from the first manufacturer form (manufacturers/apply.js).
 *
 * Two ways out, chosen by the markup:
 *
 *   mail     The default (decided 10 Nov 2026). The form writes the message into
 *            an email in the visitor's own mail app, addressed to the form's
 *            `data-contact`, and they send it. Nothing leaves this page and no
 *            third party sees it. Until they press send nothing has reached us,
 *            so the confirmation says the email is ready, never that it arrived.
 *            A copy button covers mail that lives in a browser tab, where a
 *            mailto link opens nothing.
 *   service  When the form's `action` is a form service we accept (and, for
 *            Web3Forms, its public `access_key` is filled in), the message is
 *            posted there. CORS-simple: urlencoded body, Accept header only.
 *            Success is read from the reply, never assumed.
 *
 * FAILS CLOSED: the submit button is disabled in the markup and only this
 * module enables it, and only when a way out is valid. Once enabled it stays
 * enabled; a form with mistakes keeps it enabled and says, under each field and
 * in plain words, what to fix (spec section 9).
 *
 * Markup contract:
 *   <form data-mail-form data-contact="…" data-title="…" data-subject="…"
 *         data-subject-field="<field name>" action="" method="POST" novalidate>
 *   fields: name = the label the letter uses; `required`, `data-error`,
 *           `data-error-format` (email); an error <p class="field__error"
 *           id="<input id>-err" hidden> after each control
 *   chips:  <div data-chip-group="<label>"> of <button aria-pressed>
 *   trap:   <div class="vp-trap" aria-hidden="true"> with name="botcheck"
 *   status: [data-form-status] (aria-live); done: [data-form-done] holding
 *           [data-done-when="mail"] and [data-done-when="service"],
 *           [data-done-list] for chosen chips, [data-form-copy]
 *
 * SPDX-License-Identifier: Apache-2.0
 */

export const ALLOWED = ['https://api.web3forms.com/submit', 'https://script.google.com/macros/s/'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const EMAIL = /^[^\s@<>"]+@[^\s@<>"]+\.[a-z]{2,}$/i;
/** Form plumbing, never part of what the visitor wrote. */
export const PLUMBING = new Set(['access_key', 'subject', 'from_name', 'botcheck']);

/** The subject line names the sender's organisation or name when there is one. */
export function subjectOf(base, value) {
    const v = String(value ?? '').trim();
    return v ? `${base}: ${v}` : base;
}

/**
 * The message as plain text: a heading, one line per answer, and long answers
 * (`long` names) as their own block at the end.
 * @param {string} title
 * @param {Iterable<[string, string]>} pairs
 * @param {string[]} long
 */
export function letterOf(title, pairs, long = []) {
    const lines = [title, ''];
    const blocks = [];
    for (const [name, raw] of pairs) {
        const value = String(raw).trim();
        if (PLUMBING.has(name) || !value) continue;
        if (long.includes(name)) blocks.push('', `${name}:`, value);
        else lines.push(`${name === 'email' ? 'Email' : name}: ${value}`);
    }
    return [...lines, ...blocks].join('\n');
}

/** RFC 6068: line breaks in a mailto body are CRLF. */
export function mailtoOf(to, subject, body) {
    const crlf = (s) => s.replace(/\r?\n/g, '\r\n');
    return `mailto:${to}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(crlf(body))}`;
}

/** Where the form posts, or null when it is not wired to a service we accept. */
export function endpointOf(action, accessKey) {
    const url = action || '';
    if (!ALLOWED.some((a) => url.startsWith(a))) return null;
    if (url.startsWith(ALLOWED[0]) && !UUID.test(accessKey || '')) return null;
    return url;
}

function wire(form) {
    const button = form.querySelector('button[type="submit"]');
    const status = form.parentElement.querySelector('[data-form-status]');
    const done = form.parentElement.querySelector('[data-form-done]');
    const copy = done?.querySelector('[data-form-copy]');
    if (!button || !status || !done) return;

    const contact = EMAIL.test(form.dataset.contact || '') ? form.dataset.contact : null;
    const endpoint = endpointOf(form.getAttribute('action'), form.elements.access_key?.value);
    const MODE = endpoint ? 'service' : (contact ? 'mail' : null);
    const say = (text) => { status.textContent = text; };
    if (MODE) button.disabled = false;
    else say('This form is not connected yet, so it sends nothing.');

    const long = [...form.querySelectorAll('textarea')].map((t) => t.name);
    const groups = [...form.querySelectorAll('[data-chip-group]')];
    for (const g of groups) {
        g.addEventListener('click', (e) => {
            const chip = e.target.closest('button[aria-pressed]');
            if (chip) chip.setAttribute('aria-pressed', String(chip.getAttribute('aria-pressed') !== 'true'));
        });
    }

    const fields = [...form.querySelectorAll('input, select, textarea')]
        .filter((f) => f.type !== 'hidden' && f.name !== 'botcheck');
    const showError = (f, message) => {
        const err = form.querySelector(`#${CSS.escape(f.id)}-err`);
        if (message) f.setAttribute('aria-invalid', 'true'); else f.removeAttribute('aria-invalid');
        if (err) { err.textContent = message || ''; err.hidden = !message; }
    };
    const check = (f) => {
        const value = f.type === 'checkbox' ? (f.checked ? 'yes' : '') : f.value.trim();
        if (f.required && !value) return f.dataset.error || 'This is needed so we can reply.';
        if (f.type === 'email' && value && !EMAIL.test(value)) return f.dataset.errorFormat || 'That email address looks incomplete.';
        return '';
    };
    for (const f of fields) f.addEventListener(f.type === 'checkbox' ? 'change' : 'input', () => {
        if (f.getAttribute('aria-invalid')) showError(f, check(f));
    });

    const collect = () => {
        const data = new FormData(form);
        for (const g of groups) {
            for (const chip of g.querySelectorAll('button[aria-pressed="true"]')) data.append(g.dataset.chipGroup, chip.textContent.trim());
        }
        return data;
    };
    const pairsOf = (data) => {
        // Chips of one group read as one line: "Vehicles: Boats, Jet skis".
        const out = new Map();
        for (const [k, v] of data) out.set(k, out.has(k) ? `${out.get(k)}, ${v}` : String(v));
        return [...out];
    };
    const title = form.dataset.title || 'Message from passport.vin';
    const subject = (data) => subjectOf(form.dataset.subject || title, data.get(form.dataset.subjectField || ''));

    const showDone = (mode, data) => {
        for (const v of done.querySelectorAll('[data-done-when]')) v.hidden = v.dataset.doneWhen !== mode;
        const chosen = groups[0] ? (data.getAll(groups[0].dataset.chipGroup).join(', ') || 'none chosen') : '';
        for (const list of done.querySelectorAll('[data-done-list]')) list.textContent = chosen;
        form.hidden = true;
        done.hidden = false;
        done.focus();
    };

    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const data = collect();
        if (data.get('botcheck')) return;
        const problems = fields.map((f) => [f, check(f)]);
        for (const [f, m] of problems) showError(f, m);
        const first = problems.find(([, m]) => m);
        if (first) { first[0].focus(); say(''); return; }
        if (MODE === 'service') {
            data.set('subject', subject(data));
            button.disabled = true;
            say('Sending…');
            try {
                const res = await fetch(endpoint, { method: 'POST', headers: { Accept: 'application/json' }, body: new URLSearchParams(data) });
                const body = await res.json().catch(() => ({}));
                if (!res.ok || body.success !== true) throw new Error(body.message || `HTTP ${res.status}`);
                say('');
                showDone('service', data);
            } catch {
                button.disabled = false;
                say(`Nothing was sent. Check your connection and try again.${contact ? ` If it keeps failing, write to ${contact}.` : ''}`);
            }
            return;
        }
        if (MODE !== 'mail') return;
        const a = document.createElement('a');
        a.href = mailtoOf(contact, subject(data), letterOf(title, pairsOf(data), long));
        a.hidden = true;
        document.body.append(a);
        a.click();
        a.remove();
        showDone('mail', data);
        copy?.addEventListener('click', async () => {
            const live = done.querySelector('[data-done-status]');
            try {
                await navigator.clipboard.writeText(`To: ${contact}\nSubject: ${subject(data)}\n\n${letterOf(title, pairsOf(data), long)}`);
                if (live) live.textContent = `Copied. Paste it into a new email to ${contact}.`;
            } catch {
                if (live) live.textContent = `Copying was blocked by the browser. Write to ${contact} instead.`;
            }
        });
    });
}

if (typeof document !== 'undefined') {
    for (const form of document.querySelectorAll('form[data-mail-form]')) wire(form);
}
