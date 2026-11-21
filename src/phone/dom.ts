// Small DOM helpers for the phone's screens. Text from the network is only ever set with textContent.

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

/** Inserts fixed markup from our own generators (portraits, island emblems, clouds), never network text. */
export function svg(markup: string, cls?: string): HTMLSpanElement {
  const s = el('span', cls);
  s.innerHTML = markup;
  return s;
}

export function button(label: string, cls: string, onPress: () => void): HTMLButtonElement {
  const b = el('button', cls, label);
  b.type = 'button';
  b.addEventListener('click', onPress);
  return b;
}

/** Restarts a one-shot CSS animation class. */
export function flashClass(e: HTMLElement, cls: string): void {
  e.classList.remove(cls);
  void e.offsetWidth;
  e.classList.add(cls);
}

// ------------------------------------------------------------------ icons

/** Our own line icons (24 px grid, drawn with the text colour). No emoji: the phone speaks the TV's visual language. */
const ICONS = {
  tap: '<circle cx="12" cy="12" r="3.2" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="8.5"/>',
  pump: '<path d="M12 3v18M7 8l5-5 5 5M7 16l5 5 5-5"/>',
  tilt: '<path d="M3 11 21 4l-6 17-3.5-7z"/><path d="M11.5 14 21 4"/>',
  secret: '<path d="M3 12s3.5-6 9-6 9 6 9 6-3.5 6-9 6-9-6-9-6z"/><circle cx="12" cy="12" r="2.5"/><path d="M4 4l16 16"/>',
  still: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="2.6" fill="currentColor" stroke="none"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3"/>',
  hold: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4.5" fill="currentColor" stroke="none"/>',
  stick: '<circle cx="12" cy="6.5" r="3.6" fill="currentColor" stroke="none"/><path d="M12 9v7"/><path d="M4.5 20.5c0-2.6 3.2-4.5 7.5-4.5s7.5 1.9 7.5 4.5z"/>',
  buttons: '<rect x="3" y="3" width="8" height="8" rx="2.5"/><rect x="13" y="3" width="8" height="8" rx="2.5"/><rect x="3" y="13" width="8" height="8" rx="2.5"/><rect x="13" y="13" width="8" height="8" rx="2.5"/>',
  rhythm: '<path d="M9 18V5l11-2v13"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="17.5" cy="16" r="2.5"/>',
  swipe: '<circle cx="4.5" cy="12" r="1.6" fill="currentColor" stroke="none"/><path d="M9 12h11M15 7l5 5-5 5"/>',
  aim: '<circle cx="12" cy="12" r="7"/><path d="M12 2v5M12 17v5M2 12h5M17 12h5"/><circle cx="12" cy="12" r="1.3" fill="currentColor" stroke="none"/>',
  spin: '<path d="M20 12a8 8 0 1 1-2.6-5.9"/><path d="M20 4v5h-5"/>',
  slider: '<path d="M6 3v18M12 3v18M18 3v18"/><rect x="3.5" y="13" width="5" height="3.6" rx="1.2" fill="currentColor"/><rect x="9.5" y="6" width="5" height="3.6" rx="1.2" fill="currentColor"/><rect x="15.5" y="10" width="5" height="3.6" rx="1.2" fill="currentColor"/>',
  draw: '<path d="M4 20l1-5L16 4l4 4L9 19z"/><path d="M14 6l4 4"/>',
  number: '<rect x="4" y="3" width="16" height="18" rx="3"/><path d="M8 7.5h8"/><path d="M8.5 12h.01M12 12h.01M15.5 12h.01M8.5 16h.01M12 16h.01M15.5 16h.01" stroke-width="2.4"/>',
  table: '<rect x="6" y="2.5" width="12" height="19" rx="2.6"/><circle cx="12" cy="13" r="2" fill="currentColor" stroke="none"/><path d="M10.5 5.5h3"/>',
  shake: '<rect x="8" y="4" width="8" height="16" rx="2" transform="rotate(-12 12 12)"/><path d="M3.5 8.5c-1 2-1 5 0 7M20.5 8.5c1 2 1 5 0 7"/>',
  chevron: '<path d="M9 5l7 7-7 7"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  arrow: '<path d="M12 20V5M5.5 11 12 4.5 18.5 11"/>',
  back: '<path d="M9 5h11a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H9l-6-7z"/><path d="M12 9.5l5 5M17 9.5l-5 5"/>',
  smile: '<circle cx="12" cy="12" r="9"/><path d="M8.5 14.5a4.5 4.5 0 0 0 7 0"/><path d="M9 10h.01M15 10h.01" stroke-width="2.4"/>',
  coin: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5.2"/>',
  lock: '<rect x="5" y="10.5" width="14" height="10" rx="2.5"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/>',
  bag: '<path d="M5 8h14l-1 12.5H6z"/><path d="M9 8V7a3 3 0 0 1 6 0v1"/>',
} as const;

export type IconName = keyof typeof ICONS;

export function icon(name: IconName, size = 24): HTMLSpanElement {
  return svg(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`,
    `icon icon--${name}`,
  );
}

// ------------------------------------------------------------------ the die

const PIPS: Record<number, number[]> = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };
/** Where each number sits on the cube (opposite faces add up to seven, like a real die). */
const FACES: [number, string][] = [[1, 'front'], [6, 'back'], [3, 'right'], [4, 'left'], [5, 'top'], [2, 'bottom']];

/**
 * A die built from six CSS faces, so it can tumble in 3D like the one on the TV. With `show` it lands on that
 * number; without, it floats and waits to be rolled. Numbers a die doesn't have are shown as a numeral.
 */
export function die3d(show?: number): HTMLSpanElement {
  const die = el('span', 'die3d');
  if (show !== undefined && !PIPS[show]) {
    die.classList.add('die3d--flat');
    die.textContent = String(show);
    return die;
  }
  const cube = el('span', 'die3d__cube');
  for (const [value, side] of FACES) {
    const face = el('span', `die3d__face die3d__face--${side}`);
    for (let i = 0; i < 9; i++) face.append(el('i', PIPS[value]?.includes(i) ? 'pip' : ''));
    cube.append(face);
  }
  // Three planes through the middle, so the rounded corners never show a gap.
  for (const axis of ['x', 'y', 'z']) cube.append(el('span', `die3d__core die3d__core--${axis}`));
  if (show !== undefined) cube.dataset.show = String(show);
  const tilt = el('span', 'die3d__tilt');
  tilt.append(cube);
  die.append(tilt);
  die.setAttribute('aria-hidden', 'true');
  return die;
}

/** Dark or light text, whichever reads better on `color` (#rgb or #rrggbb). */
export function inkOn(color: string): string {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim());
  if (!m) return '#ffffff';
  const hex = (m[1] as string).length === 3 ? [...(m[1] as string)].map((c) => c + c).join('') : (m[1] as string);
  const lin = (i: number) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(0) + 0.7152 * lin(2) + 0.0722 * lin(4) > 0.3 ? '#1a1320' : '#ffffff';
}
