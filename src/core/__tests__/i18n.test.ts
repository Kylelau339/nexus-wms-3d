import { describe, expect, it, afterEach } from 'vitest';
import {
  DEFAULT_LANG,
  labelTable,
  msg,
  onLangChange,
  renderMessage,
  setLang,
  t,
  templateKey,
  translate,
} from '../i18n';
import { EN } from '../dictionary';
import { collectFiles, placeholders, readDictionary, scanFiles } from '../../../scripts/i18n-scan.mjs';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const CJK = /[\u4e00-\u9fff]/;

afterEach(() => {
  setLang(DEFAULT_LANG);
});

describe('i18n runtime', () => {
  it('returns the Chinese source in the default locale', () => {
    setLang('zh-TW');
    expect(t('揀貨準確率')).toBe('揀貨準確率');
  });

  it('returns the English translation when the locale is switched', () => {
    setLang('en');
    expect(t('揀貨準確率')).toBe('Pick accuracy');
  });

  it('substitutes numbered placeholders', () => {
    setLang('en');
    expect(t('{0} 卸貨 · {1}', 'ASN-1', 'Chaoyang')).toBe('ASN-1 unloading · Chaoyang');
    setLang('zh-TW');
    expect(t('{0} 卸貨 · {1}', 'ASN-1', '朝陽工業')).toBe('ASN-1 卸貨 · 朝陽工業');
  });

  it('builds a template key from a tagged template', () => {
    expect(templateKey(['模擬時間 ', ''])).toBe('模擬時間 {0}');
  });

  it('translates a tagged template', () => {
    setLang('en');
    expect(t`${'A'} 區`).toBe('Zone A');
    setLang('zh-TW');
    expect(t`${'A'} 區`).toBe('A 區');
  });

  it('falls back to the source text for an unknown key', () => {
    setLang('en');
    expect(t('這個字串不存在')).toBe('這個字串不存在');
  });

  it('re-renders a domain message in the active language', () => {
    const message = msg('{0} 卸貨 · {1}', 'ASN-1', () => 'Chaoyang Industrial');
    setLang('zh-TW');
    expect(renderMessage(message)).toBe('ASN-1 卸貨 · Chaoyang Industrial');
    setLang('en');
    expect(renderMessage(message)).toBe('ASN-1 unloading · Chaoyang Industrial');
  });

  it('resolves lazy arguments at render time', () => {
    let name = 'A';
    const message = msg('揀取 {0}', () => name);
    expect(renderMessage(message)).toBe('揀取 A');
    name = 'B';
    expect(renderMessage(message)).toBe('揀取 B');
  });

  it('translates label tables on lookup', () => {
    const table = labelTable({ pick: '揀貨' });
    setLang('zh-TW');
    expect(table('pick')).toBe('揀貨');
    setLang('en');
    expect(table('pick')).toBe('Picking');
    expect(table('unknown')).toBe('unknown');
  });

  it('notifies listeners when the language changes', () => {
    const seen: string[] = [];
    const stop = onLangChange((lang) => seen.push(lang));
    setLang('en');
    stop();
    setLang('zh-TW');
    expect(seen).toEqual(['en']);
  });
});

describe('dictionary integrity', () => {
  const root = join(process.cwd(), 'src');
  const files = collectFiles(root);
  const { keys, violations } = scanFiles(files);
  const dictionary = readDictionary(join(root, 'core/dictionary.ts'));

  it('has a translation for every key used in the source', () => {
    const missing = [...keys.keys()].filter((key) => !dictionary.has(key));
    expect(missing).toEqual([]);
  });

  it('has no unused translations', () => {
    const html = readFileSync(join(process.cwd(), 'index.html'), 'utf8');
    const htmlKeys = new Set(
      [...html.matchAll(/data-i18n(?:-aria|-title)?="([^"]+)"/g)].map((m) => m[1]!),
    );
    const unused = [...dictionary.keys()].filter(
      (key) => !keys.has(key) && !htmlKeys.has(key),
    );
    expect(unused).toEqual([]);
  });

  it('never leaves Chinese in a translation', () => {
    const untranslated = [...dictionary.entries()]
      .filter(([key, value]) => value !== key && value !== null && CJK.test(value))
      .map(([key]) => key);
    expect(untranslated).toEqual([]);
  });

  it('keeps the placeholders of source and translation in sync', () => {
    const mismatched = [...dictionary.entries()]
      .filter(([key, value]) => value !== null && value !== key)
      .filter(
        ([key, value]) =>
          placeholders(key).sort().join(',') !== placeholders(value!).sort().join(','),
      )
      .map(([key]) => key);
    expect(mismatched).toEqual([]);
  });

  it('has no untranslated string literals in the source tree', () => {
    expect(violations).toEqual([]);
  });

  it('exposes every translation through the runtime', () => {
    setLang('en');
    for (const [key, value] of Object.entries(EN)) {
      expect(translate(key)).toBe(value);
    }
  });

  it('translates the static HTML shell', () => {
    const html = readFileSync(join(process.cwd(), 'index.html'), 'utf8');
    const htmlKeys = [...html.matchAll(/data-i18n(?:-aria|-title)?="([^"]+)"/g)].map((m) => m[1]!);
    expect(htmlKeys.length).toBeGreaterThan(0);
    for (const key of htmlKeys) {
      expect(dictionary.has(key)).toBe(true);
    }
  });
});
