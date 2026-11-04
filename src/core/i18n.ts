/**
 * Runtime internationalisation for the NEXUS WMS 3D twin.
 *
 * Design notes
 * ------------
 * - **Keys are the Traditional Chinese source strings.** Every call site reads
 *   naturally in the primary locale (`t('揀貨準確率')`), and the English
 *   dictionary can be validated mechanically against the source tree.
 * - **Templates use a tagged template** so the whole sentence stays one key:
 *   `t`模擬時間 ${clock}`` resolves to the key `模擬時間 {0}`, which the
 *   dictionary translates as a natural English sentence rather than a
 *   word-by-word fragment swap.
 * - **Domain messages are lazy descriptors** (`msg()` / `renderMessage()`), so
 *   a task label or an alert created hours ago is re-rendered in the current
 *   language the moment the user switches.
 *
 * This module has no DOM dependency: the domain layer imports it directly and
 * the storage access is guarded so it stays usable in Node (tests, tooling).
 */

import { EN } from './dictionary';

export type Lang = 'zh-TW' | 'en';

export const LANGS: readonly Lang[] = ['zh-TW', 'en'];
export const DEFAULT_LANG: Lang = 'zh-TW';

const LOCALES: Record<Lang, string> = {
  'zh-TW': 'zh-TW',
  en: 'en-US',
};

const HTML_LANG: Record<Lang, string> = {
  'zh-TW': 'zh-Hant',
  en: 'en',
};

/** A value that can be embedded in a translated string. */
export type MessageArg = string | number | (() => string | number);

/** A domain message that is rendered lazily, in whichever language is active. */
export interface Message {
  readonly key: string;
  readonly args: readonly MessageArg[];
}

/** A translation may be a plain string or a formatter that receives the resolved args. */
export type Translation = string | ((args: string[]) => string);

type Dictionary = Record<string, Translation>;

const DICTIONARIES: Record<Lang, Dictionary> = {
  // zh-TW is the source language: a key *is* its own translation.
  'zh-TW': {},
  en: EN,
};

const STORAGE_KEY = 'nexus-wms-lang';

let currentLang: Lang = DEFAULT_LANG;
const listeners = new Set<(lang: Lang) => void>();

/* ------------------------------------------------------------------ state */

export function getLang(): Lang {
  return currentLang;
}

/** BCP-47 tag for the `<html lang>` attribute. */
export function htmlLang(lang: Lang = currentLang): string {
  return HTML_LANG[lang];
}

/** Intl locale for the active language. */
export function locale(lang: Lang = currentLang): string {
  return LOCALES[lang];
}

export function isLang(value: unknown): value is Lang {
  return typeof value === 'string' && (LANGS as readonly string[]).includes(value);
}

/**
 * Switch the active language, persist it and notify listeners.
 * Returns true when the language actually changed.
 */
export function setLang(lang: Lang): boolean {
  if (!isLang(lang) || lang === currentLang) return false;
  currentLang = lang;
  persist(lang);
  for (const listener of [...listeners]) listener(lang);
  return true;
}

/** Subscribe to language changes. Returns an unsubscribe function. */
export function onLangChange(listener: (lang: Lang) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Restore the persisted language. Safe to call before the DOM exists. */
export function loadPersistedLang(): Lang {
  try {
    if (typeof localStorage === 'undefined') return currentLang;
    const stored = localStorage.getItem(STORAGE_KEY);
    if (isLang(stored) && stored !== currentLang) {
      currentLang = stored;
    }
  } catch {
    /* storage unavailable (private mode, sandboxed iframe) */
  }
  return currentLang;
}

function persist(lang: Lang): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    /* storage unavailable — the choice simply does not survive a reload */
  }
}

/* --------------------------------------------------------------- lookups */

/** Resolve a single argument, invoking it when it is a lazy accessor. */
function resolveArg(arg: MessageArg): string {
  const value = typeof arg === 'function' ? arg() : arg;
  return typeof value === 'number' ? formatNumber(value) : String(value);
}

/** Replace `{0}`, `{1}` … placeholders with the resolved arguments. */
function substitute(template: string, args: string[]): string {
  if (args.length === 0) return template;
  return template.replace(/\{(\d+)\}/g, (match, digits: string) => {
    const index = Number(digits);
    return index < args.length ? args[index]! : match;
  });
}

/**
 * Look a key up in the active dictionary and render it.
 * Unknown keys fall back to the source text so the UI never shows a blank.
 */
export function translate(key: string, args: MessageArg[] = []): string {
  const dictionary = DICTIONARIES[currentLang];
  const entry = dictionary[key];
  const template: Translation = entry === undefined ? key : entry;
  const resolved = args.map(resolveArg);
  if (typeof template === 'function') return template(resolved);
  return substitute(template, resolved);
}

/**
 * Build the dictionary key for a tagged template.
 * `t`a ${b} c`` → `a {0} c`.
 */
export function templateKey(strings: readonly string[]): string {
  let key = strings[0] ?? '';
  for (let i = 1; i < strings.length; i++) key += `{${i - 1}}${strings[i]}`;
  return key;
}

/**
 * Translate a literal string.
 *
 *   t('揀貨準確率')            → '揀貨準確率' | 'Pick accuracy'
 *   t('裝車 {0}', orderId)     → '裝車 ORD-1'  | 'Load ORD-1'
 *   t`模擬時間 ${clock}`       → '模擬時間 08:30' | 'Simulated time 08:30'
 */
export function t(key: string, ...args: MessageArg[]): string;
export function t(strings: TemplateStringsArray, ...args: MessageArg[]): string;
export function t(keyOrStrings: string | TemplateStringsArray, ...args: MessageArg[]): string {
  if (typeof keyOrStrings === 'string') return translate(keyOrStrings, args);
  return translate(templateKey(keyOrStrings), args);
}

/**
 * Create a lazy domain message. The arguments are resolved at render time, so
 * a message created before a language switch still renders in the new language.
 */
export function msg(key: string, ...args: MessageArg[]): Message {
  return { key, args };
}

/** Render a domain message in the active language. */
export function renderMessage(message: Message): string {
  return translate(message.key, [...message.args]);
}

/**
 * Pick between two business-data strings (Chinese source and English variant).
 * Used for data records — SKUs, customers, zones — that exist in both languages.
 */
export function localize(zh: string, en: string): string {
  return currentLang === 'en' ? en : zh;
}

/** A lookup that always answers in the active language. */
export type LabelLookup = (key: string) => string;

/**
 * Build a label table from Traditional Chinese source strings.
 *
 * The table stores the *source* text and translates on lookup, so a table
 * declared at module scope stays correct after a language switch:
 *
 *   const TASK_LABEL = labelTable({ pick: '揀貨' });
 *   TASK_LABEL('pick')  // → '揀貨' | 'Picking'
 */
export function labelTable(table: Record<string, string>): LabelLookup {
  return (key: string) => {
    const source = table[key];
    return source === undefined ? key : t(source);
  };
}

/* -------------------------------------------------------------- formatting */

const numberFormats = new Map<string, Intl.NumberFormat>();

function numberFormat(options: Intl.NumberFormatOptions): Intl.NumberFormat {
  const tag = locale() + JSON.stringify(options);
  let format = numberFormats.get(tag);
  if (!format) {
    format = new Intl.NumberFormat(locale(), options);
    numberFormats.set(tag, format);
  }
  return format;
}

/** Locale-aware integer formatting. */
export function formatNumber(value: number): string {
  return numberFormat({ maximumFractionDigits: 0 }).format(value);
}

/** Locale-aware decimal formatting. */
export function formatDecimal(value: number, digits = 1): string {
  return numberFormat({ maximumFractionDigits: digits }).format(value);
}

/** Locale-aware compact formatting (1.2K / 1.2M). */
export function formatCompact(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${formatDecimal(value / 1_000_000)}M`;
  if (abs >= 10_000) return `${formatDecimal(value / 1000)}K`;
  return formatNumber(value);
}
