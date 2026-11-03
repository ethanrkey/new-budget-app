import { usePageScrollLock } from "../shared/scrollLock.js";

// THE ONE PLACE A MODAL LOCKS THE PAGE. Every full-window scrim on the
// web is this component, so a new modal cannot forget to.
//
// 2026-11-03: with Settings → Account open, the mouse wheel scrolled
// the page behind it. None of the `fixed inset-0` overlays locked
// anything. tests/modal-lock.test.mjs fails the build on a scrim that
// is not this component; scripts/drive_modal_lock.mjs proves the lock
// in a browser. The lock itself, and why it is counted:
// src/shared/scrollLock.js.

/**
 * The full-window scrim. Takes the className the old <div> had (it
 * adds `fixed inset-0` itself) and everything else a div takes.
 *
 * `data-modal` marks it for the rule in index.css that keeps a
 * scrolling panel inside it from handing its scroll on to the page
 * when it reaches the end (overscroll-behavior: contain).
 */
export default function ModalBackdrop({ className = "", children, ...rest }) {
  usePageScrollLock();
  return (
    <div data-modal="" className={`fixed inset-0 ${className}`} {...rest}>
      {children}
    </div>
  );
}

