import fs from 'node:fs';
import path from 'node:path';
import { builtinModules } from 'node:module';
import { fileURLToPath } from 'node:url';
import workspace from '../../scripts/workspace.mjs';
const ts = workspace.platformRequire('typescript');

const slash = (value) => value.replaceAll('\\', '/');
const nativeModules = new Set([...builtinModules, ...builtinModules.map((name) => 'node:' + name)]);
const inferenceModules =
  /^(?:onnxruntime-node|sherpa-onnx-node|sherpa-onnx-win-x64|sqlite-vec|pdfjs-dist|pdf-parse|mammoth|word-extractor|chardet|@lancedb\/lancedb|@huggingface\/(?:tokenizers|transformers))(?:\/|$)/;

export function dependencies(file, text) {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const edges = [];
  const add = (node, specifier, typeOnly) =>
    edges.push({
      target: specifier.text,
      typeOnly,
      line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
    });
  const allTypeSpecifiers = (bindings) =>
    bindings &&
    ts.isNamedImports(bindings) &&
    bindings.elements.length > 0 &&
    bindings.elements.every((element) => element.isTypeOnly);
  function visit(node) {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const clause = node.importClause;
      add(
        node,
        node.moduleSpecifier,
        !!clause &&
          (clause.isTypeOnly || (!clause.name && allTypeSpecifiers(clause.namedBindings))),
      );
    } else if (
      ts.isExportDeclaration(node) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      add(
        node,
        node.moduleSpecifier,
        node.isTypeOnly ||
          (!!node.exportClause &&
            ts.isNamedExports(node.exportClause) &&
            node.exportClause.elements.length > 0 &&
            node.exportClause.elements.every((element) => element.isTypeOnly)),
      );
    } else if (
      ts.isImportTypeNode(node) &&
      ts.isLiteralTypeNode(node.argument) &&
      ts.isStringLiteral(node.argument.literal)
    ) {
      add(node, node.argument.literal, true);
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference) &&
      node.moduleReference.expression &&
      ts.isStringLiteral(node.moduleReference.expression)
    ) {
      add(node, node.moduleReference.expression, node.isTypeOnly);
    } else if (
      ts.isCallExpression(node) &&
      node.arguments.length &&
      ts.isStringLiteral(node.arguments[0]) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === 'require'))
    ) {
      add(node, node.arguments[0], false);
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return edges;
}

export function sourceGraph(root) {
  const options = {
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    resolveJsonModule: true,
    baseUrl: root,
    paths: { '@/*': ['shared/src/*'] },
  };
  const resolutionCache = ts.createModuleResolutionCache(
    root,
    (name) => ts.sys.useCaseSensitiveFileNames ? name : name.toLowerCase(),
    options,
  );
  const graph = new Map();
  function visit(directory) {
    if (!fs.existsSync(directory)) return;
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(absolute);
      else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
        const file = slash(path.relative(root, absolute));
        graph.set(
          file,
          dependencies(file, fs.readFileSync(absolute, 'utf8')).map((edge) => {
            const resolved = ts.resolveModuleName(
              edge.target,
              absolute,
              options,
              ts.sys,
              resolutionCache,
            ).resolvedModule;
            const assetTarget = edge.target.replace(/\?inline$/, '');
            const asset = path.resolve(path.dirname(absolute), assetTarget);
            return {
              ...edge,
              target:
                resolved && !resolved.isExternalLibraryImport
                  ? slash(path.relative(root, resolved.resolvedFileName))
                  : edge.target.startsWith('.') &&
                      /\.(?:png|jpg|svg|css)$/.test(assetTarget) &&
                      fs.existsSync(asset)
                    ? slash(path.relative(root, asset))
                    : edge.target,
            };
          }),
        );
      }
    }
  }
  for (const directory of [
    'shared/src',
    'shared/electron',
    'windows/electron',
    'macos/electron',
    'macos/src',
    'windows/src',
  ])
    visit(path.join(root, directory));
  return graph;
}

export function runtimeCycles(graph) {
  const states = new Map();
  const stack = [];
  const cycles = [];
  function visit(file) {
    if (states.get(file) === 'active') {
      cycles.push([...stack.slice(stack.indexOf(file)), file]);
      return;
    }
    if (states.has(file)) return;
    states.set(file, 'active');
    stack.push(file);
    for (const edge of graph.get(file) ?? [])
      if (!edge.typeOnly && graph.has(edge.target)) visit(edge.target);
    stack.pop();
    states.set(file, 'done');
  }
  for (const file of graph.keys()) visit(file);
  return cycles;
}

// Keep responsibility rules independent of the physical platform directory.
function logicalPath(file) {
  if (file.startsWith('macos/src/')) return file.slice('macos/'.length);
  if (file === 'windows/electron/platform.ts') return 'electron/platform/windows.ts';
  if (file === 'macos/electron/platform.ts') return 'electron/platform/macos.ts';
  if (file.startsWith('macos/electron/updates/'))
    return file.replace('macos/electron/updates/', 'electron/backend/updates/');
  if (/^(?:windows|macos)\/electron\/speech\//.test(file))
    return file.replace(/^(?:windows|macos)\/electron\/speech\//, 'electron/backend/speech/');
  return file.startsWith('shared/') ? file.slice('shared/'.length) : file;
}

export function boundaryViolations(graph) {
  const violations = [];
  for (const [physicalFile, edges] of graph) {
    const file = logicalPath(physicalFile);
    if (/^(?:macos|windows)\/src\//.test(physicalFile) &&
        !['macos/src/icons.tsx', 'macos/src/mobile/MobileIcon.tsx'].includes(physicalFile))
      violations.push(
        `${physicalFile}: 界面必须唯一保留在 shared/src，不得恢复平台控件或材质替换层`,
      );
    for (const edge of edges) {
      const target = logicalPath(edge.target);
      const fail = (reason) =>
        violations.push(`${physicalFile}:${edge.line} → ${edge.target}: ${reason}`);
      if (
        physicalFile === 'macos/src/icons.tsx' &&
        !['react', 'macos/src/symbols.json', 'macos/src/control-symbols.css'].includes(edge.target)
      )
        fail('Mac 图标适配仅可使用 React、系统符号清单和符号样式');
      if (physicalFile === 'macos/src/mobile/MobileIcon.tsx' &&
          edge.target !== 'macos/src/mobile/symbols.css' &&
          !(edge.typeOnly && edge.target === 'shared/src/mobile/MobileIcon.tsx'))
        fail('Mac 手机图标仅可使用本平台符号样式和共享图标名称类型');
      if (
        /^(?:macos|windows)\/electron\/screenPermission\.ts$/.test(physicalFile) &&
        (!edge.typeOnly || !edge.target.startsWith('shared/electron/contracts/'))
      )
        fail('平台屏幕权限仅通过注入调用权限 API，不得依赖捕获、磁盘、账户或业务实现');
      if (
        /^(?:macos|windows)\/electron\/presentation\.ts$/.test(physicalFile) &&
        !(
          target === 'electron' ||
          (edge.typeOnly && edge.target === 'shared/electron/presentation.ts')
        )
      )
        fail('平台展示适配器仅允许 Electron 和主进程类型端口');
      if (
        /^(?:shared|windows|macos)\//.test(physicalFile) &&
        /^(?:shared|windows|macos)\/test\//.test(edge.target)
      )
        fail('生产源码不得依赖测试实现或夹具');
      if (
        (physicalFile.startsWith('windows/') && edge.target.startsWith('macos/')) ||
        (physicalFile.startsWith('macos/') && edge.target.startsWith('windows/'))
      )
        fail('Windows 与 macOS 专属实现不得相互依赖');
      if (physicalFile.startsWith('shared/') && /^(?:windows|macos)\//.test(edge.target))
        fail('共用源码不得静态依赖平台实现；主进程仅动态装配所选平台');
      if (edge.target.startsWith('.') || edge.target.startsWith('@/'))
        fail('源码引用无法解析到实际模块');
      if (
        file.startsWith('src/') &&
        (nativeModules.has(target) ||
          target === 'electron' ||
          inferenceModules.test(target) ||
          (target.startsWith('electron/') && !target.startsWith('electron/contracts/')))
      )
        fail('Renderer 只能依赖公开契约，不得访问原生业务或基础设施');
      if (
        file.startsWith('src/mobile/') &&
        target.startsWith('src/') &&
        !target.startsWith('src/mobile/') &&
        !['src/components/useFollowScroll.ts', 'src/services/math.ts', 'src/lib/useStreamingMarkdown.ts'].includes(target) &&
        !(file === 'src/mobile/App.tsx' && ['src/lib/messageMotion.ts', 'src/components/ui/content-reveal.tsx'].includes(target))
      )
        fail('手机页面只可复用独立的滚动、公式、Markdown 刷新和动效工具');
      if (file === 'src/components/ui/content-reveal.tsx' &&
          !['react', 'src/components/ui/useHeightTransition.ts', 'src/components/ui/content-reveal.css'].includes(target))
        fail('桌面和手机共用的展开动效仅依赖 React、尺寸过渡和自身样式');
      if (file === 'src/components/ui/useHeightTransition.ts' &&
          !['react', 'src/components/ui/motion-continuation.ts'].includes(target))
        fail('共用尺寸过渡只依赖 React、续播计时和浏览器原生动画接口');
      if (file === 'src/components/ui/motion-continuation.ts')
        fail('共用续播计时只使用浏览器原生动画接口');
      if (file === 'src/lib/useStreamingMarkdown.ts' && target !== 'react')
        fail('桌面和手机共用的 Markdown 刷新工具只依赖 React');
      if (file === 'src/lib/messageMotion.ts')
        fail('桌面和手机共用的消息入场工具只使用浏览器原生动画接口');
      if (/^src\/(?:stores|services)\//.test(file) && /^src\/components\//.test(target))
        fail('状态和服务不得依赖展示组件');
      if (file.startsWith('electron/') && target.startsWith('src/'))
        fail('原生层不得反向依赖 Renderer');
      if (file.startsWith('electron/contracts/') && !target.startsWith('electron/contracts/'))
        fail('公开契约只能依赖同层纯类型/工具');
      if (file === 'electron/preload.ts' && !edge.typeOnly && target !== 'electron')
        fail('沙箱 preload 的运行时依赖只能是 electron');
      if (
        /^@github\/copilot-sdk(?:\/|$|-)/.test(target) &&
        !file.startsWith('electron/backend/copilot/')
      )
        fail('Copilot SDK 只能由专用后台适配器访问');
      if (
        !edge.typeOnly &&
        /^electron-updater(?:\/|$)/.test(target) &&
        !file.startsWith('electron/backend/updates/')
      )
        fail('自动更新依赖只能进入受控更新后台');
      if (
        file.startsWith('electron/backend/updates/') &&
        /^electron\/backend\/(?:auth|chat|knowledge|speech)\//.test(target)
      )
        fail('更新后台不得读取凭据、用户资料、音频或模型实现');
      if (
        file === 'electron/backend/updates/releases.ts' &&
        !edge.typeOnly &&
        (target === 'electron' ||
          /^electron-updater(?:\/|$)/.test(target) ||
          /^electron\/backend\/updates\/(?:driver|provider|service)\.ts$/.test(target))
      )
        fail('发行筛选与清单校验不得依赖原生更新器或更新生命周期');
      if (file.startsWith('electron/backend/') && /^electron\/(?:application|ipc)\//.test(target))
        fail('后台业务不得依赖上层协调器或 IPC');
      if (
        file.startsWith('electron/platform/') &&
        target.startsWith('electron/') &&
        !target.startsWith('electron/platform/') &&
        !(
          file === 'electron/platform/types.ts' &&
          edge.typeOnly &&
          ['electron/contracts/presentation.ts', 'electron/backend/knowledge/types.ts'].includes(target)
        )
      )
        fail('平台策略不得依赖业务、IPC 或窗口生命周期');
      if (file === 'electron/window.ts' && /^electron\/(?:application|backend|ipc)\//.test(target))
        fail('共享窗口配置不得依赖业务服务或 IPC');
      if (file === 'electron/screenshot.ts' && !edge.typeOnly && target !== 'electron')
        fail('屏幕截图适配器仅使用原生捕获，不访问磁盘、账户、AI 或业务状态');
      if (
        /^electron\/(?:backend|application)\//.test(file) &&
        (target === 'electron/window.ts' ||
          target === 'electron/screenshot.ts' ||
          target.startsWith('electron/platform/'))
      )
        fail('业务通过主进程装配接收平台参数，不直接依赖桌面策略');
      if (
        !edge.typeOnly &&
        ['electron/main.ts', 'electron/backend/speech/host.ts'].includes(file) &&
        /^electron\/backend\/speech\/engine\.ts$/.test(target)
      )
        fail('主进程与能力检测不得加载语音推理实现');
      if (
        file.startsWith('electron/application/') &&
        !edge.typeOnly &&
        (target === 'electron' ||
          /electron\/backend\/.+\/(?:service|host|workers)\.ts$/.test(target))
      )
        fail('应用协调通过接口接收服务，不创建原生或 Provider 实现');
      if (
        ((nativeModules.has(target) && /(?:^|:)sqlite$/.test(target)) ||
          inferenceModules.test(target)) &&
        !(/^sherpa-onnx-/.test(target)
          ? file.startsWith('electron/backend/speech/')
          : file.startsWith('electron/backend/knowledge/') &&
            /^(?:@lancedb\/lancedb|@huggingface\/transformers|pdf-parse|mammoth|word-extractor|chardet)(?:\/|$)/.test(
              target,
            ))
      )
        fail('原生/推理依赖仅允许进入各自受控后台，禁止已撤除的索引依赖');
      if (
        file.startsWith('electron/backend/knowledge/') &&
        /^electron\/backend\/(?:auth|chat|speech)\//.test(target)
      )
        fail('知识后台不得访问授权、AI Provider 或音频实现');
      if (
        file === 'electron/backend/knowledge/host.ts' &&
        !edge.typeOnly &&
        /^electron\/backend\/knowledge\/(?:service|embedding|parser|chunks)\.ts$/.test(target)
      )
        fail('主进程知识 Host 不得加载解析、数据库或模型实现');
    }
  }
  return violations;
}

export function checkArchitecture(root) {
  if (
    !fs.existsSync(path.join(root, 'shared/electron')) &&
    ['windows', 'macos'].includes(path.basename(root))
  )
    root = path.dirname(root);
  const graph = sourceGraph(root);
  return {
    files: graph.size,
    violations: [...boundaryViolations(graph), ...ipcCoverage(root)],
    cycles: runtimeCycles(graph),
  };
}

export function ipcCoverage(root) {
  const parse = (file) =>
    ts.createSourceFile(
      file,
      fs.readFileSync(path.join(root, file), 'utf8'),
      ts.ScriptTarget.Latest,
      true,
    );
  const declared = {};
  for (const node of parse('shared/electron/contracts/desktop.ts').statements)
    if (
      ts.isInterfaceDeclaration(node) &&
      ['DesktopInvokeMap', 'DesktopSendMap', 'DesktopEventMap'].includes(node.name.text)
    )
      declared[node.name.text] = new Set(node.members.map((member) => member.name.text));
  const calls = (files, names) => {
    const result = new Set();
    for (const file of files) {
      const visit = (node) => {
        if (
          ts.isCallExpression(node) &&
          ts.isIdentifier(node.expression) &&
          names.includes(node.expression.text)
        ) {
          // sendDesktop takes WebContents before the channel; other adapters take channel first.
          const argument = node.arguments[node.expression.text === 'sendDesktop' ? 1 : 0];
          if (argument && ts.isStringLiteral(argument)) result.add(argument.text);
        }
        ts.forEachChild(node, visit);
      };
      visit(parse(file));
    }
    return result;
  };
  const mainFiles = [
    'shared/electron/main.ts',
    ...fs
      .readdirSync(path.join(root, 'shared/electron/ipc'))
      .filter((name) => name.endsWith('.ts'))
      .map((name) => 'shared/electron/ipc/' + name),
  ];
  const violations = [];
  const compare = (map, actual, label) => {
    for (const channel of declared[map])
      if (!actual.has(channel)) violations.push(`${label} missing ${channel}`);
    for (const channel of actual)
      if (!declared[map].has(channel)) violations.push(`${label} undeclared ${channel}`);
  };
  for (const [map, mainAdapter, preloadAdapter] of [
    ['DesktopInvokeMap', 'handleDesktop', 'invoke'],
    ['DesktopSendMap', 'onDesktop', 'send'],
    ['DesktopEventMap', 'sendDesktop', 'subscribe'],
  ]) {
    compare(map, calls(mainFiles, [mainAdapter]), 'Main ' + map);
    compare(map, calls(['shared/electron/preload.ts'], [preloadAdapter]), 'Preload ' + map);
  }
  return violations;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = checkArchitecture(workspace.repositoryRoot);
  for (const issue of result.violations) console.error(issue);
  for (const cycle of result.cycles) console.error('Runtime cycle: ' + cycle.join(' → '));
  console.log(
    `Architecture: ${result.files} files, ${result.violations.length} boundary violations, ${result.cycles.length} runtime cycles.`,
  );
  if (result.violations.length || result.cycles.length) process.exitCode = 1;
}
