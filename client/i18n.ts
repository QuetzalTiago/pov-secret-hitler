// English / Spanish. Call sites write both languages inline: tr({ en: 'Leave', es: 'Salir' }).
export type Lang = 'en' | 'es';

const KEY = 'sh-lang';

export function detectLang(stored: string | null, navLang: string | undefined): Lang {
  if (stored === 'en' || stored === 'es') return stored;
  return navLang && navLang.toLowerCase().startsWith('es') ? 'es' : 'en';
}

let current: Lang | null = null;
const listeners = new Set<(l: Lang) => void>();

export function lang(): Lang {
  if (!current) {
    try {
      current = detectLang(localStorage.getItem(KEY), navigator.language);
    } catch {
      current = 'en';
    }
  }
  return current;
}

export function setLang(l: Lang): void {
  current = l;
  try {
    localStorage.setItem(KEY, l);
  } catch {
    // Private mode: the choice just lasts for this visit.
  }
  for (const fn of [...listeners]) fn(l);
}

export function onLangChange(fn: (l: Lang) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function tr(s: { en: string; es: string }): string {
  return s[lang()];
}

// Swap static markup: each data-es* attribute holds the Spanish, the English original is kept in data-en*.
const ATTRS: { es: string; en: string; prop: string | null }[] = [
  { es: 'data-es', en: 'data-en', prop: null },
  { es: 'data-es-title', en: 'data-en-title', prop: 'title' },
  { es: 'data-es-placeholder', en: 'data-en-placeholder', prop: 'placeholder' },
  { es: 'data-es-aria-label', en: 'data-en-aria-label', prop: 'aria-label' },
];

export function applyStatic(root: ParentNode): void {
  const l = lang();
  for (const { es, en, prop } of ATTRS) {
    root.querySelectorAll(`[${es}]`).forEach((el) => {
      if (!el.hasAttribute(en)) el.setAttribute(en, (prop ? el.getAttribute(prop) : el.innerHTML) ?? '');
      const text = el.getAttribute(l === 'es' ? es : en) ?? '';
      if (prop) el.setAttribute(prop, text);
      else el.innerHTML = text;
    });
  }
  if (typeof document !== 'undefined') document.documentElement.lang = l;
}
