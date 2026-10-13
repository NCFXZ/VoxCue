import fs from 'node:fs';
import path from 'node:path';
import { builtinModules } from 'node:module';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const slash = (value) => value.replaceAll('\\', '/');
const nativeModules = new Set([...builtinModules, ...builtinModules.map((name) => 'node:' + name)]);
const inferenceModules =
  /^(?:onnxruntime-node|sherpa-onnx-node|sherpa-onnx-win-x64|sqlite-vec|pdfjs-dist|mammoth|@huggingface\/tokenizers)(?:\/|$)/;

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
    baseUrl: root,
    paths: { '@/*': ['src/*'] },
  };
  const graph = new Map();
  function visit(directory) {
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
            ).resolvedModule;
            return {
              ...edge,
              target:
                resolved && !resolved.isExternalLibraryImport
                  ? slash(path.relative(root, resolved.resolvedFileName))
                  : edge.target,
            };
          }),
        );
      }
    }
  }
  for (const directory of ['src', 'electron']) visit(path.join(root, directory));
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

export function boundaryViolations(graph) {
  const violations = [];
  for (const [file, edges] of graph)
    for (const edge of edges) {
      const target = edge.target;
      const fail = (reason) => violations.push(`${file}:${edge.line} → ${target}: ${reason}`);
      if (
        file.startsWith('src/') &&
        (nativeModules.has(target) ||
          target === 'electron' ||
          inferenceModules.test(target) ||
          (target.startsWith('electron/') && !target.startsWith('electron/contracts/')))
      )
        fail('Renderer 只能依赖公开契约，不得访问原生业务或基础设施');
      if (/^src\/(?:stores|services)\//.test(file) && /^src\/components\//.test(target))
        fail('状态和服务不得依赖展示组件');
      if (file.startsWith('electron/') && target.startsWith('src/'))
        fail('原生层不得反向依赖 Renderer');
      if (file.startsWith('electron/contracts/') && !target.startsWith('electron/contracts/'))
        fail('公开契约只能依赖同层纯类型/工具');
      if (file === 'electron/preload.ts' && !edge.typeOnly && target !== 'electron')
        fail('沙箱 preload 的运行时依赖只能是 electron');
      if (file.startsWith('electron/backend/') && /^electron\/(?:application|ipc)\//.test(target))
        fail('后台业务不得依赖上层协调器或 IPC');
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
        !(/^sherpa-onnx-/.test(target) ? file.startsWith('electron/backend/speech/') : false)
      )
        fail('禁止引入已撤除的索引依赖；ASR/VAD原生依赖仅可在语音后台使用');
    }
  return violations;
}

export function checkArchitecture(root) {
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
  for (const node of parse('electron/contracts/desktop.ts').statements)
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
    'electron/main.ts',
    ...fs
      .readdirSync(path.join(root, 'electron/ipc'))
      .filter((name) => name.endsWith('.ts'))
      .map((name) => 'electron/ipc/' + name),
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
    compare(map, calls(['electron/preload.ts'], [preloadAdapter]), 'Preload ' + map);
  }
  return violations;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = checkArchitecture(process.cwd());
  for (const issue of result.violations) console.error(issue);
  for (const cycle of result.cycles) console.error('Runtime cycle: ' + cycle.join(' → '));
  console.log(
    `Architecture: ${result.files} files, ${result.violations.length} boundary violations, ${result.cycles.length} runtime cycles.`,
  );
  if (result.violations.length || result.cycles.length) process.exitCode = 1;
}
