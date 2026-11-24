import { afterEach, describe, expect, it, vi } from 'vitest';
import { isUILanguage, systemUILanguage, translateUI } from '../../electron/contracts/uiLanguage';
import { uiMessages } from '../../electron/contracts/uiMessages';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('interface language', () => {
  it('translates independent response warnings without changing unknown multiline text', () => {
    const provider = '回答已接收，但本机用量保存失败。';
    const retrieval = '对话已接近长度上限，本次回答未使用知识库资料。';
    const warning = [provider, retrieval].join('\n');
    const lines = translateUI(warning, 'en').split('\n');
    expect(lines).toEqual([uiMessages[provider], uiMessages[retrieval]]);
    expect(lines.join(' ')).not.toMatch(/\p{Script=Han}/u);
    expect(translateUI(warning, 'zh-CN')).toBe(warning);
    const unknown = provider + '\n' + '用户原文';
    expect(translateUI(unknown, 'en')).toBe(unknown);
  });
  it('translates capture clock errors and recovery notices from the speech service', () => {
    expect(translateUI('本机音频时钟不可用，请重新开始采集。', 'en')).toBe(
      'The local audio clock is unavailable. Restart audio capture.',
    );
    expect(translateUI('系统时间已变化，转写已继续。', 'en')).toBe(
      'The system time changed. Transcription has resumed.',
    );
  });
  it('uses the settings names in CPU diagnostics and multilingual recognition status', () => {
    expect(translateUI('无法确认多语言语音识别所需的处理器指令集，请改用轻量语音识别。', 'en'))
      .toBe('Could not verify the CPU instructions required for Multilingual speech recognition. Switch to Lightweight speech recognition.');
    expect(translateUI('多语言语音识别 · CUDA · 对齐 CPU · 本地', 'en'))
      .toBe('Multilingual speech recognition · CUDA · CPU alignment · Local');
  });
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

  it('localizes the completed answer count in interview history rows', () => {
    expect(translateUI('1 个回答', 'en')).toBe('1 answer');
    expect(translateUI('{0} 个回答', 'en', [0])).toBe('0 answers');
    expect(translateUI('{0} 个回答', 'en', [2])).toBe('2 answers');
    expect(translateUI('1 个回答', 'zh-CN')).toBe('1 个回答');
    expect(translateUI('{0} 个回答', 'zh-CN', [2])).toBe('2 个回答');
  });

  it('translates proposal field errors without translating the model-provided field name', () => {
    expect(translateUI('资料更新包含未知字段：targetRole。', 'en'))
      .toBe('The profile update contains an unknown field: targetRole.');
    expect(translateUI('DeepSeek 没有标明本轮是否修改资料，个人信息未修改。', 'en'))
      .toBe('DeepSeek did not state whether this reply changes your profile. Your profile is unchanged.');
  });
  it('translates per-skill proposal errors and keeps the skill title as data', () => {
    expect(translateUI('技能「嵌入式运动控制」的正文为空或超过 6000 个字符，未修改个人信息。', 'en'))
      .toBe('The content of skill "嵌入式运动控制" is empty or longer than 6,000 characters. Your profile is unchanged.');
    expect(translateUI('技能「合成技能」包含未知字段：level，未修改个人信息。', 'en'))
      .toBe('Skill "合成技能" contains an unknown field: level. Your profile is unchanged.');
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

  it('translates Windows device labels and keeps the original audio error code', () => {
    for (const source of ['麦克风', '系统音频']) {
      for (const selected of ['所选', '默认']) {
        const unavailable = `${selected}${source}设备不可用，请在面试设置中重新选择。`;
        expect(translateUI(unavailable, 'en')).not.toMatch(/\p{Script=Han}/u);
      }
      const code = '0x88890004';
      const failure = `${source}不可用（${code}），请检查设备、隐私权限或默认设备变化后重新开始。`;
      const english = translateUI(failure, 'en');
      expect(english).not.toMatch(/\p{Script=Han}/u);
      expect(english).toContain(code);
    }
    expect(translateUI('音频采集助手输出异常，采集已停止；请重新开始。', 'en')).not.toMatch(/\p{Script=Han}/u);
    expect(translateUI('用户原文不可用', 'en')).toBe('用户原文不可用');
  });

  it('names the affected input in English when capture is interrupted or no device is found', () => {
    for (const [source, english] of [['系统音频', 'System audio'], ['麦克风', 'Microphone input']]) {
      const interruption = source + '发生短暂间断，转写已继续；不完整片段不会自动用于回答。';
      const result = translateUI(interruption, 'en');
      expect(result).toContain(english);
      expect(result).not.toMatch(/\p{Script=Han}/u);
    }
    expect(translateUI('未发现播放设备。', 'en')).toBe('No output device found.');
    expect(translateUI('未发现麦克风设备。', 'en')).toBe('No microphone found.');
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
