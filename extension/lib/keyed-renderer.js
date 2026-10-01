// Store the source markup separately: selection, expansion and favicon fallbacks
// alter the live DOM and must survive a refresh whose underlying data is unchanged.
const sourceMarkup = new WeakMap();
const motionAnimations = new WeakMap();

// Temporary editors must be reconciled even when the stored record is unchanged.
export function invalidateKeyedMarkup(element) { sourceMarkup.delete(element); }

export function renderKeyedMarkup(container, markup, keyAttribute, { motion = true } = {}) {
  const document = container.ownerDocument;
  const template = document.createElement('template');
  template.innerHTML = markup;
  const previous = new Map([...container.children].map(el => [el.getAttribute(keyAttribute), el]));
  const focused = document.activeElement;
  const focusedCard = focused?.closest?.(`[${keyAttribute}]`);
  const focusKey = container.contains(focusedCard) ? focusedCard.getAttribute(keyAttribute) : null;
  const focusIndex = focusKey === null ? -1 : [...focusedCard.querySelectorAll('button, a, input, [tabindex]')].indexOf(focused);
  const focusIdentity = focusKey === null ? [] : ['data-action', 'data-tab-id', 'data-tab-url', 'data-deferred-id', 'href'].map(name => [name, focused.getAttribute(name)]).filter(([, value]) => value !== null);
  const before = motion ? new Map([...container.children].map(el => [el, el.getBoundingClientRect()])) : new Map();
  const next = [];
  for (const candidate of template.content.children) {
    const key = candidate.getAttribute(keyAttribute);
    const current = key === null ? null : previous.get(key);
    const html = candidate.outerHTML;
    const element = current && sourceMarkup.get(current) === html ? current : candidate;
    sourceMarkup.set(element, html);
    next.push(element);
  }
  // Move only nodes whose position changed. replaceChildren would detach the
  // focused control even when every node could be reused.
  next.forEach((el, index) => {
    if (container.children[index] !== el) container.insertBefore(el, container.children[index] || null);
  });
  while (container.children.length > next.length) container.lastElementChild.remove();
  if (focusKey !== null && document.activeElement !== focused) {
    const replacement = next.find(el => el.getAttribute(keyAttribute) === focusKey);
    const controls = [...(replacement?.querySelectorAll('button, a, input, [tabindex]') || [])];
    const sameControl = focusIdentity.length ? controls.find(el => el.tagName === focused.tagName && focusIdentity.every(([name, value]) => el.getAttribute(name) === value)) : controls[focusIndex];
    (sameControl || replacement?.querySelector('.chip-focus, a, button'))?.focus({ preventScroll: true });
  }
  if (!motion) {
    next.forEach(el => motionAnimations.get(el)?.cancel());
    return;
  }
  // Animate bounded changes, using the on-screen position if a previous move
  // is interrupted. No layout properties are animated and input stays available.
  next.slice(0, 24).forEach(el => {
    if (!el.animate) return;
    const old = before.get(el);
    motionAnimations.get(el)?.cancel();
    const rect = el.getBoundingClientRect();
    if (old) {
      const x = old.left - rect.left;
      const y = old.top - rect.top;
      if (Math.abs(x) + Math.abs(y) < 1 || Math.abs(y) > 240) return;
      motionAnimations.set(el, el.animate([{ transform: `translate(${x}px, ${y}px)` }, { transform: 'translate(0, 0)' }], {
        duration: 220, easing: 'cubic-bezier(.2,.8,.2,1)',
      }));
    } else if (before.size) {
      motionAnimations.set(el, el.animate([{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'translateY(0)' }], {
        duration: 160, easing: 'ease-out',
      }));
    }
  });
}
