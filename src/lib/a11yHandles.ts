/**
 * Svelte Flow gives every connection handle `role="button"` with no accessible
 * name — 141 of them against 12 real buttons on a typical plan, so anything
 * enumerating the page's controls hits the noise first. The component takes no
 * extra attributes (no rest props), and handles are recreated on every replan,
 * so the fix has to be applied to the DOM as it appears.
 */
const HANDLE_SELECTOR = '.svelte-flow__handle';

function hide(el: Element) {
  if (el.getAttribute('aria-hidden') === 'true') return;
  el.setAttribute('aria-hidden', 'true');
  el.removeAttribute('role');
}

export function hideFlowHandles(root: HTMLElement): () => void {
  root.querySelectorAll(HANDLE_SELECTOR).forEach(hide);

  const observer = new MutationObserver(records => {
    for (const record of records) {
      for (const added of record.addedNodes) {
        if (!(added instanceof Element)) continue;
        if (added.matches(HANDLE_SELECTOR)) hide(added);
        added.querySelectorAll?.(HANDLE_SELECTOR).forEach(hide);
      }
    }
  });
  observer.observe(root, { childList: true, subtree: true });
  return () => observer.disconnect();
}
