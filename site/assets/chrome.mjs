/**
 * The redesign's header: the phone menu and the notice band's tense.
 *
 * Everything visual is in vp.css, so a page renders correctly before this
 * module arrives. Without it the phone menu does not open, and every link in
 * it is still reachable from the footer.
 *
 *   menu   under 1,200 px the bar is the logo, a scan button and a menu button
 *          (vp.css says why it is not the spec's 900 px).
 *          The button reports its state (aria-expanded, and its name changes
 *          between Open menu and Close menu); opening moves focus to the first
 *          link, Tab and Shift+Tab stay inside the menu and its button while it
 *          is open, Escape closes it and returns focus to the button, and
 *          growing past the breakpoint closes it (spec section 5).
 *   band   Euro 7 applies to new types from 29 November 2026. From that moment
 *          the band shows its second text instead of announcing a date that
 *          has passed (Reg (EU) 2024/1257, Art. 21).
 *
 * SPDX-License-Identifier: Apache-2.0
 */

/** True once `now` (ms) has reached the band's switch time (ISO 8601). */
export function bandIsAfter(now, switchAt) {
    const at = Date.parse(switchAt);
    return Number.isFinite(at) && now >= at;
}

const BREAKPOINT = '(min-width: 1200px)';

function wireMenu(header) {
    const burger = header.querySelector('.vp-burger');
    const menu = header.querySelector('#vp-menu');
    if (!burger || !menu) return;
    const items = () => [...menu.querySelectorAll('a[href], button:not([disabled])')];
    const isOpen = () => header.classList.contains('is-open');

    const set = (open, { returnFocus = false } = {}) => {
        header.classList.toggle('is-open', open);
        burger.setAttribute('aria-expanded', String(open));
        burger.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
        if (open) items()[0]?.focus();
        else if (returnFocus) burger.focus();
    };

    burger.addEventListener('click', () => set(!isOpen()));

    // A tap on a link navigates; a same-page anchor does not, and the menu
    // should not stay over the section the reader just asked for.
    menu.addEventListener('click', (e) => { if (e.target.closest('a')) set(false); });

    header.addEventListener('keydown', (e) => {
        if (!isOpen()) return;
        if (e.key === 'Escape') {
            e.preventDefault();
            set(false, { returnFocus: true });
            return;
        }
        if (e.key !== 'Tab') return;
        const ring = [burger, ...items()];
        const at = ring.indexOf(document.activeElement);
        if (at < 0) return;
        const next = e.shiftKey ? (at === 0 ? ring.length - 1 : at - 1) : (at === ring.length - 1 ? 0 : at + 1);
        e.preventDefault();
        ring[next].focus();
    });

    matchMedia(BREAKPOINT).addEventListener('change', (e) => { if (e.matches && isOpen()) set(false); });
}

if (typeof document !== 'undefined') {
    const header = document.querySelector('.vp-header');
    if (header) wireMenu(header);
    // The band and any sentence written in two tenses (a .vp-when-before and a .vp-when-after
    // inside an element carrying data-switch-at) show the second from the switch time. Without
    // the script the first shows, which is right until then.
    for (const el of document.querySelectorAll('[data-switch-at]')) {
        if (bandIsAfter(Date.now(), el.dataset.switchAt)) el.classList.add('is-after');
    }
}
