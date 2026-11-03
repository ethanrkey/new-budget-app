import { useLayoutEffect } from "react";

// THE PAGE'S SCROLL LOCK, for the web's modals. Rendered through
// <ModalBackdrop> (src/components/ModalBackdrop.jsx); the one thing
// that should ever call this directly is that component.
//
// THE LOCK IS COUNTED, not on/off. A confirm opens on top of Settings,
// so two backdrops are mounted at once; closing the confirm must leave
// the page locked until Settings goes too. The first lock takes the
// page's state and the last unlock gives it back.
//
// HOW: `overflow: hidden` on <html>, which stops the wheel, trackpad,
// keyboard and (iOS 16+) touch from scrolling the document while
// leaving its scroll position where it was. The scrollbar that
// disappears is paid back as padding on <body>, so the page does not
// shift sideways by its width. On close the inline styles we replaced
// are restored and the page is put back at exactly where it was, in
// case anything (focus moving, a resize) nudged it while locked.
let locks = 0;
let saved = null;

export function lockPageScroll() {
  locks += 1;
  if (locks > 1) return;
  const html = document.documentElement;
  const body = document.body;
  const gutter = window.innerWidth - html.clientWidth;
  saved = {
    x: window.scrollX,
    y: window.scrollY,
    htmlOverflow: html.style.overflow,
    bodyPadding: body.style.paddingRight,
  };
  if (gutter > 0) {
    const current = parseFloat(getComputedStyle(body).paddingRight) || 0;
    body.style.paddingRight = `${current + gutter}px`;
  }
  html.style.overflow = "hidden";
}

export function unlockPageScroll() {
  if (locks === 0) return;
  locks -= 1;
  if (locks > 0 || !saved) return;
  const { x, y, htmlOverflow, bodyPadding } = saved;
  saved = null;
  document.documentElement.style.overflow = htmlOverflow;
  document.body.style.paddingRight = bodyPadding;
  // "instant", so a page-wide smooth-scroll rule cannot animate it.
  window.scrollTo({ left: x, top: y, behavior: "instant" });
}

/** For a modal that draws its own scrim. Prefer <ModalBackdrop>. */
export function usePageScrollLock() {
  // Layout effect: locked before the first paint, so the page cannot
  // move between the modal appearing and the lock landing.
  useLayoutEffect(() => {
    lockPageScroll();
    return unlockPageScroll;
  }, []);
}
