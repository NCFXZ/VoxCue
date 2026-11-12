import { afterEach, describe, expect, it, vi } from 'vitest';
import { isUILanguage, systemUILanguage, translateUI } from '../../electron/contracts/uiLanguage';
import { uiMessages } from '../../electron/contracts/uiMessages';
import { createAuthCallbackPage } from '../../electron/backend/auth/callbackPage';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('interface language', () => {
  it('provides translations for literal UI keys used by renderers and native dialogs', () => {
    const files: string[] = [];
    const visitDirectory = (directory: string) => {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const file = path.join(directory, entry.name);
        if (entry.isDirectory()) visitDirectory(file);
        else if (/\.tsx?$/.test(file)) files.push(file);
      }
    };
    visitDirectory(path.resolve('../shared/src'));
    files.push(
      path.resolve('../shared/electron/main.ts'),
      path.resolve('../shared/electron/backend/auth/callbackPage.ts'),
    );
    const missing: string[] = [];
    for (const file of files) {
      const source = ts.createSourceFile(
        file,
        fs.readFileSync(file, 'utf8'),
        ts.ScriptTarget.Latest,
        true,
      );
      const visit = (node: ts.Node) => {
        if (
          ts.isCallExpression(node) &&
          ['t', 'nativeText'].includes(node.expression.getText(source))
        ) {
          const key = node.arguments[0];
          if (
            key &&
            ts.isStringLiteral(key) &&
            /\p{Script=Han}/u.test(key.text) &&
            !Object.hasOwn(uiMessages, key.text) &&
            !Object.hasOwn(uiMessages, key.text.trim())
          )
            missing.push(path.basename(file) + ': ' + key.text);
        }
        ts.forEachChild(node, visit);
      };
      visit(source);
    }
    expect(missing).toEqual([]);
  });
  it('uses Simplified Chinese only for a Simplified Chinese system language', () => {
    for (const value of ['zh-CN', 'zh-Hans', 'zh-Hans-SG', 'zh-SG', 'zh'])
      expect(systemUILanguage(value), value).toBe('zh-CN');
    for (const value of [
      'en-US',
      'en-GB',
      'fr-FR',
      'ja',
      'zh-TW',
      'zh-HK',
      'zh-Hant-CN',
      '',
      'invalid_locale',
      undefined,
    ])
      expect(systemUILanguage(value), String(value)).toBe('en');
    expect(isUILanguage('en')).toBe(true);
    for (const value of ['en-US', 'zh', 'fr', null, {}, 0]) expect(isUILanguage(value)).toBe(false);
  });

  it('translates interface copy and preserves supplied user data and unknown errors', () => {
    expect(translateUI('面试设置', 'en')).toBe('Interview settings');
    expect(translateUI('面试设置', 'zh-CN')).toBe('面试设置');
    expect(translateUI('问题：{0}', 'en', ['保存 <b>{1}</b>'])).toBe('Question: 保存 <b>{1}</b>');
    expect(translateUI('查看面试记录：保存', 'en')).toBe('View interview: 保存');
    expect(translateUI('不支持的文件格式：slides.pptx, sheet.xlsx', 'en')).toBe(
      'Unsupported files: slides.pptx, sheet.xlsx',
    );
    expect(translateUI('不支持的文件格式：保留、原名, original.zip', 'en')).toBe(
      'Unsupported files: 保留、原名, original.zip',
    );
    expect(translateUI('服务原始异常: 保存', 'en')).toBe('服务原始异常: 保存');
    expect(translateUI('  语言\n', 'en')).toBe('  Language\n');
  });

  it('matches application templates without generic punctuation captures or regex backtracking', () => {
    expect(translateUI('任意内容：用户原文', 'en')).toBe('任意内容：用户原文');
    expect(translateUI('Engine error: 用户原文', 'en')).toBe('Engine error: 用户原文');
    expect(translateUI('已用 4 字节，总容量 10 字节', 'en')).toBe('4 bytes used out of 10 bytes');
    expect(translateUI('正在重试 2/3', 'en')).toBe('Retrying 2/3');
    expect(translateUI('密码需要8至64个字符。', 'en')).toBe(
      'Your password must contain 8–64 characters.',
    );
    const repeated = '密码需要' + '至'.repeat(10_000) + '个字符X';
    expect(translateUI(repeated, 'en')).toBe(repeated);
    const long = '用户原文：'.repeat(20_000);
    expect(translateUI('查看面试记录：' + long, 'en')).toBe('查看面试记录：' + long);
    expect(translateUI('查看面试记录：{0}', 'en', [long])).toBe('View interview: ' + long);
  });

  it('has English copy with matching placeholder indices', () => {
    const slots = (value: string) =>
      [...value.matchAll(/\{(\d+)\}/g)].map((match) => match[1]).sort();
    for (const [source, english] of Object.entries(uiMessages)) {
      expect(english.trim(), source).not.toBe('');
      expect(slots(english), source).toEqual(slots(source));
      if (source !== '简体中文') expect(english, source).not.toMatch(/\p{Script=Han}/u);
    }
  });

  it('localizes the OAuth callback without exposing authorization details', () => {
    for (const language of ['en', 'zh-CN'] as const) {
      const page = createAuthCallbackPage(undefined, language);
      for (const state of ['received', 'invalid', 'used', 'not-found'] as const) {
        const html = page.render(state);
        expect(html).toContain(`lang="${language}"`);
        if (language === 'en') expect(html).not.toMatch(/\p{Script=Han}/u);
        expect(page.headers['Content-Security-Policy']).toContain("default-src 'none'");
      }
    }
  });

  it('keeps an explicit preference across restarts and system language changes', async () => {
    const saved = new Map<string, string>();
    const localStorage = {
      getItem: (key: string) => saved.get(key) ?? null,
      setItem: (key: string, value: string) => saved.set(key, value),
    };
    const target = new EventTarget();
    const desktop = { systemLanguage: 'en' };
    vi.stubGlobal('localStorage', localStorage);
    vi.stubGlobal('window', {
      desktop,
      addEventListener: target.addEventListener.bind(target),
      removeEventListener: target.removeEventListener.bind(target),
    });
    let store = (await import('../../src/stores/generalSettings')).useGeneralSettings;
    expect(store.getState().language).toBe('en');
    expect(saved.size).toBe(0);
    store.getState().setLanguage('zh-CN');
    expect(saved.get('voxcue-language-v1')).toBe('zh-CN');
    vi.resetModules();
    store = (await import('../../src/stores/generalSettings')).useGeneralSettings;
    expect(store.getState().language).toBe('zh-CN');
    store.getState().setLanguage('en');
    desktop.systemLanguage = 'zh-CN';
    vi.resetModules();
    store = (await import('../../src/stores/generalSettings')).useGeneralSettings;
    expect(store.getState().language).toBe('en');
    const stop = store.getState().connect();
    saved.set('voxcue-language-v1', 'zh-CN');
    target.dispatchEvent(Object.assign(new Event('storage'), { key: 'voxcue-language-v1' }));
    expect(store.getState().language).toBe('zh-CN');
    localStorage.setItem = () => {
      throw Error('storage blocked');
    };
    store.getState().setLanguage('en');
    expect(store.getState().language).toBe('zh-CN');
    expect(store.getState().error).toBeTruthy();
    stop();
    saved.set('voxcue-language-v1', 'en');
    target.dispatchEvent(Object.assign(new Event('storage'), { key: 'voxcue-language-v1' }));
    expect(store.getState().language).toBe('zh-CN');
  });
});
