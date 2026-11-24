import { beforeAll, describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import symbols from '../../src/symbols.json';
import vite from '../../../shared/vite.config.mjs';

let icons: typeof import('../../src/icons');
describe.skipIf(process.platform !== 'darwin')('Mac SF Symbols 的共享界面契约', () => {
  beforeAll(async () => {
    icons = await import('../../src/icons');
  });
  it('覆盖全部现有图标接口且不改变尺寸、颜色继承和无障碍归属', () => {
    const file = path.resolve('../shared/src/components/icons.tsx');
    const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest);
    const names = source.statements.flatMap((statement) => {
      if (ts.isExportDeclaration(statement) && !statement.isTypeOnly &&
          statement.exportClause && ts.isNamedExports(statement.exportClause)) {
        return statement.exportClause.elements.filter((item) => !item.isTypeOnly).map((item) => item.name.text);
      }
      if (ts.isVariableStatement(statement) &&
          statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)) {
        return statement.declarationList.declarations.map((item) => item.name.getText(source));
      }
      return [];
    }).sort();
    expect(Object.keys(icons).sort()).toEqual(names);
    const controlMasks = ['src/control-symbols.css', 'src/mobile/symbols.css'].flatMap(file =>
      [...readFileSync(file, 'utf8').matchAll(/sf-symbols\/(\w+)\.png/g)].map(match => match[1]),
    );
    const iconNames = names.filter((name) => name !== 'personalInfoIconSize');
    expect(Object.keys(symbols).sort()).toEqual([...new Set([...iconNames, ...controlMasks])].sort());
    expect(icons.personalInfoIconSize).toBe(16);
    for (const name of iconNames) {
      const Icon = icons[name as keyof typeof icons];
      if (typeof Icon !== 'function') throw Error('Missing Mac icon component: ' + name);
      const html = renderToStaticMarkup(<Icon size={18} />);
      expect(html).toContain('aria-hidden="true"');
      expect(html).toContain('width:18px;height:18px;flex-shrink:0');
      expect(html).toContain('fill="currentColor"');
      expect(html).toContain('mask-type:alpha');
      expect(html).toContain('data-sf-symbol=');
      expect(html).not.toContain('@fluentui');
    }
  });
  it('同页多图标 mask ID 独立，避免跨图标引用串位', () => {
    const html = renderToStaticMarkup(
      <>
        <icons.Copy />
        <icons.Play />
        <icons.Copy />
      </>,
    );
    const ids = [...html.matchAll(/<mask id="([^"]+)"/g)].map((item) => item[1]);
    expect(ids).toHaveLength(3);
    expect(new Set(ids).size).toBe(3);
    for (const id of ids) expect(html).toContain(`mask="url(#${id})"`);
  });
  it('只替换公共图标入口，涵盖相邻组件和基础控件，不误替换其他模块', () => {
    const plugin = vite.plugins.find(
      (item: { name?: string }) => item.name === 'macos-symbol-icons',
    );
    const root = path.resolve('..');
    const mac = path.join(root, 'macos/src/icons.tsx');
    expect(plugin.resolveId('./icons', path.join(root, 'shared/src/components/Sidebar.tsx'))).toBe(
      mac,
    );
    expect(
      plugin.resolveId('../icons', path.join(root, 'shared/src/components/ui/modal.tsx')),
    ).toBe(mac);
    expect(
      plugin.resolveId('./icons.tsx', path.join(root, 'shared/src/components/Sidebar.tsx')),
    ).toBe(mac);
    expect(plugin.resolveId('./icons', path.join(root, 'macos/src/other.tsx'))).toBeNull();
    expect(plugin.resolveId('./MobileIcon', path.join(root, 'shared/src/mobile/App.tsx'))).toBe(
      path.join(root, 'macos/src/mobile/MobileIcon.tsx'),
    );
    expect(
      plugin.resolveId(
        '@fluentui/react-icons',
        path.join(root, 'shared/src/components/Sidebar.tsx'),
      ),
    ).toBeNull();
  });
});
