/**
 * Copy buttons: `<button data-copy-target="<id>">` copies the text of the
 * element with that id and says so in the nearest [data-copy-status]
 * (aria-live). The Clipboard API needs a secure context, which passport.vin
 * is; where it is refused, the button says so instead of pretending.
 *
 * SPDX-License-Identifier: Apache-2.0
 */
if (typeof document !== 'undefined') {
    for (const button of document.querySelectorAll('[data-copy-target]')) {
        const source = document.getElementById(button.dataset.copyTarget);
        const status = button.parentElement.querySelector('[data-copy-status]');
        if (!source) continue;
        button.addEventListener('click', async () => {
            try {
                await navigator.clipboard.writeText(source.textContent.trim());
                if (status) status.textContent = 'Copied.';
            } catch {
                if (status) status.textContent = 'Copying was blocked by the browser. Select the text and copy it instead.';
            }
        });
    }
}
