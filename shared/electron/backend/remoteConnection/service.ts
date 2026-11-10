import { randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { isIP } from 'node:net';
import { networkInterfaces } from 'node:os';
import { WebSocket, WebSocketServer } from 'ws';
import { REMOTE_PROTOCOL_VERSION } from '../../contracts/remoteConnection';
import type { MobileAssets } from './assets';
import type {
  RemoteCommand,
  RemoteCommandResult,
  RemoteConnectionState,
  RemoteInterviewSnapshot,
  RemotePairing,
  RemoteServerMessage,
} from '../../contracts/remoteConnection';

const PAIR_MS = 120_000;
const RESUME_MS = 120_000;
const MAX_SNAPSHOT = 1024 * 1024;
const MAX_CLIENT_FRAME = 32 * 1024;
const MAX_REQUESTS = 1024;
const MAX_DRAFT_REQUESTS = 64;
const secret = () => randomBytes(32).toString('base64url');
const identifier = (value: unknown): value is string =>
  typeof value === 'string' && /^[A-Za-z0-9_-]{8,100}$/.test(value);
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const revision = (value: unknown): value is number =>
  Number.isSafeInteger(value) && (value as number) >= 0;
const equalSecret = (actual: unknown, expected: string) => {
  if (typeof actual !== 'string' || actual.length !== expected.length) return false;
  const bytes = Buffer.from(actual);
  const expectedBytes = Buffer.from(expected);
  return bytes.length === expectedBytes.length && timingSafeEqual(bytes, expectedBytes);
};

export function isPrivateIPv4(address: string) {
  const value = address.startsWith('::ffff:') ? address.slice(7) : address;
  if (isIP(value) !== 4) return false;
  const [a, b] = value.split('.').map(Number);
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

export function selectPrivateIPv4(interfaces: ReturnType<typeof networkInterfaces>): string | null {
  const rank = (name: string) =>
    /virtual|vmware|vbox|vethernet|hyper-v|wsl|docker|vpn|tailscale|zerotier|loopback|\btun\d*\b|\btap\d*\b/i.test(
      name,
    )
      ? 2
      : /wi-?fi|wlan|wireless|无线/i.test(name)
        ? 0
        : 1;
  for (const [, entries] of Object.entries(interfaces).sort(([a], [b]) => rank(a) - rank(b))) {
    const address = entries?.find(
      (entry) => !entry.internal && entry.family === 'IPv4' && isPrivateIPv4(entry.address),
    )?.address;
    if (address) return address;
  }
  return null;
}

export function parseRemoteCommand(value: unknown): RemoteCommand | null {
  if (
    !record(value) ||
    !identifier(value.requestId) ||
    typeof value.sessionId !== 'string' ||
    !value.sessionId ||
    value.sessionId.length > 128 ||
    !revision(value.sessionEpoch)
  )
    return null;
  const base = {
    requestId: value.requestId,
    sessionId: value.sessionId,
    sessionEpoch: value.sessionEpoch,
  };
  switch (value.action) {
    case 'set-microphone':
      return typeof value.muted === 'boolean' && revision(value.expectedRevision)
        ? {
            ...base,
            action: value.action,
            muted: value.muted,
            expectedRevision: value.expectedRevision,
          }
        : null;
    case 'set-auto-answer':
      return typeof value.enabled === 'boolean' && revision(value.expectedRevision)
        ? {
            ...base,
            action: value.action,
            enabled: value.enabled,
            expectedRevision: value.expectedRevision,
          }
        : null;
    case 'set-draft':
      return typeof value.text === 'string' &&
        value.text.length <= 6000 &&
        revision(value.expectedRevision)
        ? {
            ...base,
            action: value.action,
            text: value.text,
            expectedRevision: value.expectedRevision,
          }
        : null;
    case 'ask':
      return typeof value.text === 'string' &&
        !!value.text.trim() &&
        value.text.length <= 6000 &&
        (value.pendingQuestionRevision === undefined || revision(value.pendingQuestionRevision)) &&
        (value.inputDraftRevision === undefined || revision(value.inputDraftRevision)) &&
        (value.pendingQuestionRevision === undefined || value.inputDraftRevision === undefined)
        ? {
            ...base,
            action: value.action,
            text: value.text,
            ...(value.pendingQuestionRevision !== undefined
              ? { pendingQuestionRevision: value.pendingQuestionRevision }
              : {}),
            ...(value.inputDraftRevision !== undefined
              ? { inputDraftRevision: value.inputDraftRevision }
              : {}),
          }
        : null;
    case 'stop-answer':
      return typeof value.answerId === 'string' && !!value.answerId && value.answerId.length <= 128
        ? { ...base, action: value.action, answerId: value.answerId }
        : null;
    default:
      return null;
  }
}

interface Options {
  onState(state: RemoteConnectionState): void;
  onCommand(command: RemoteCommand, signal: AbortSignal): Promise<RemoteCommandResult>;
  mobileAssets?: MobileAssets;
}
interface Pending {
  id: string;
  name: string;
  code: string;
  expiresAt: number;
  socket: WebSocket | null;
}
interface CommandEntry {
  fingerprint: string;
  controller: AbortController;
  result?: RemoteCommandResult;
}
interface Authorization {
  token: string;
  name: string;
  resumeUntil: number;
  commands: Map<string, CommandEntry>;
  drafts: Map<string, CommandEntry>;
}
interface Client {
  authenticated: boolean;
  alive: boolean;
  authenticating: ReturnType<typeof setTimeout>;
  commandsSince: number;
  commandCount: number;
  draftCount: number;
  messagesSince: number;
  messageCount: number;
}

export class RemoteConnectionService {
  private current: RemoteConnectionState = {
    status: 'off',
    revision: 0,
    addresses: [],
    clientName: null,
    pending: null,
    error: null,
  };
  private server: Server | null = null;
  private sockets: WebSocketServer | null = null;
  private origin: string | null = null;
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private pairingRecord: { token: string; expiresAt: number } | null = null;
  private pending: Pending | null = null;
  private authorization: Authorization | null = null;
  private active: WebSocket | null = null;
  private clients = new Map<WebSocket, Client>();
  private snapshot: RemoteInterviewSnapshot | null = null;
  private sequence = 0;
  private scrollSequence = 0;
  private generation = 0;
  private sendingSnapshot = false;
  private lifecycle: Promise<unknown> = Promise.resolve();
  private requestWindow = { since: 0, count: 0 };

  constructor(private options: Options) {}

  state(): RemoteConnectionState {
    return structuredClone(this.current);
  }

  private change(patch: Partial<Omit<RemoteConnectionState, 'revision'>>) {
    this.current = { ...this.current, ...patch, revision: this.current.revision + 1 };
    this.options.onState(this.state());
  }

  start(): Promise<RemoteConnectionState> {
    const operation = this.lifecycle.then(() => this.open());
    this.lifecycle = operation.catch(() => {});
    return operation;
  }

  private async open(): Promise<RemoteConnectionState> {
    if (this.server?.listening) return this.state();
    const address = selectPrivateIPv4(networkInterfaces());
    if (!address) {
      this.change({ status: 'error', error: '没有可用的私人局域网 IPv4 地址。' });
      return this.state();
    }
    const generation = ++this.generation;
    const server = createServer((request, response) => {
      void this.request(request, response);
    });
    server.requestTimeout = 5000;
    server.headersTimeout = 5000;
    server.keepAliveTimeout = 2000;
    server.maxHeadersCount = 32;
    server.maxConnections = 8;
    const sockets = new WebSocketServer({
      noServer: true,
      maxPayload: MAX_CLIENT_FRAME,
      perMessageDeflate: false,
    });
    this.server = server;
    this.sockets = sockets;
    server.on('upgrade', (request, socket, head) => {
      if (
        !this.allowed(request, true) ||
        request.url !== '/connect' ||
        sockets.clients.size >= 4 ||
        !this.rateAllowed()
      ) {
        socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
        return;
      }
      try {
        sockets.handleUpgrade(request, socket, head, (client) =>
          this.connected(client, generation),
        );
      } catch {
        socket.destroy();
      }
    });
    server.on('clientError', (_error, socket) => socket.destroy());
    try {
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, address, () => {
          server.off('error', reject);
          resolve();
        });
      });
      server.on('error', () => {
        if (generation !== this.generation) return;
        void this.disconnect().then(() =>
          this.change({ status: 'error', error: '局域网连接服务已停止，请重试。' }),
        );
      });
      const port = (server.address() as { port: number }).port;
      this.origin = `http://${address}:${port}`;
      this.requestWindow = { since: Date.now(), count: 0 };
      this.heartbeat = setInterval(() => this.tick(), 10_000);
      this.heartbeat.unref();
      this.change({
        status: 'waiting',
        addresses: [this.origin],
        clientName: null,
        pending: null,
        error: null,
      });
    } catch {
      this.server = null;
      this.sockets = null;
      sockets.close();
      server.close();
      this.change({
        status: 'error',
        addresses: [],
        error: '无法启动局域网连接服务，请检查网络后重试。',
      });
    }
    return this.state();
  }

  pairing(): RemotePairing {
    this.expire();
    if (!this.origin || !this.server?.listening) throw new Error('请先开启设备连接。');
    if (!this.active && this.current.status === 'reconnecting') {
      this.abortCommands();
      this.authorization = null;
    }
    if (this.authorization) throw new Error('已有设备连接，请先断开连接。');
    this.clearPending();
    this.pairingRecord = { token: secret(), expiresAt: Date.now() + PAIR_MS };
    this.change({ status: 'waiting', clientName: null, pending: null, error: null });
    return {
      url: `${this.origin}/#pair=${this.pairingRecord.token}`,
      expiresAt: this.pairingRecord.expiresAt,
    };
  }

  approve(id: string): RemoteConnectionState {
    this.expire();
    const pending = this.pending;
    if (!pending || pending.id !== id) throw new Error('配对请求已失效，请重新扫码。');
    if (!pending.socket || pending.socket.readyState !== WebSocket.OPEN)
      throw new Error('请等待设备建立配对连接。');
    const socket = pending.socket;
    this.pending = null;
    this.pairingRecord = null;
    this.authorization = {
      token: secret(),
      name: pending.name,
      resumeUntil: Infinity,
      commands: new Map(),
      drafts: new Map(),
    };
    this.authorize(socket);
    return this.state();
  }

  reject(id: string): RemoteConnectionState {
    if (this.pending?.id !== id) throw new Error('配对请求已失效。');
    this.clearPending();
    this.change({ pending: null, status: 'waiting' });
    return this.state();
  }

  private clearPending() {
    const socket = this.pending?.socket;
    this.pending = null;
    if (socket) this.fail(socket, '配对请求已取消。');
  }

  private abortCommands() {
    for (const cache of [this.authorization?.commands, this.authorization?.drafts])
      cache?.forEach((entry) => entry.controller.abort());
  }

  scroll(direction: 'up' | 'down'): boolean {
    const snapshot = this.snapshot,
      socket = this.active;
    if (
      !['up', 'down'].includes(direction) ||
      !this.authorization ||
      this.current.status !== 'connected' ||
      !socket ||
      socket.readyState !== WebSocket.OPEN ||
      !snapshot?.sessionId ||
      !['running', 'paused'].includes(snapshot.status) ||
      socket.bufferedAmount > 0
    )
      return false;
    this.send(socket, {
      type: 'scroll',
      scrollId: ++this.scrollSequence,
      direction,
      sessionId: snapshot.sessionId,
      sessionEpoch: snapshot.sessionEpoch,
    });
    return true;
  }

  updateSnapshot(value: RemoteInterviewSnapshot | null) {
    if (
      value &&
      this.snapshot &&
      (value.sessionEpoch < this.snapshot.sessionEpoch ||
        (value.sessionEpoch === this.snapshot.sessionEpoch &&
          value.revision <= this.snapshot.revision))
    )
      return;
    const serialized = JSON.stringify(value);
    if (Buffer.byteLength(serialized) > MAX_SNAPSHOT) throw new Error('设备同步内容超过容量限制。');
    if (
      this.snapshot?.sessionId !== value?.sessionId ||
      this.snapshot?.sessionEpoch !== value?.sessionEpoch
    ) {
      this.abortCommands();
    }
    this.snapshot = JSON.parse(serialized) as RemoteInterviewSnapshot | null;
    this.sequence++;
    this.sendSnapshot();
  }

  disconnect(): Promise<void> {
    // Revoke synchronously, before waiting for any listener shutdown.
    this.generation++;
    this.abortCommands();
    this.authorization = null;
    this.pairingRecord = null;
    this.pending = null;
    this.active = null;
    this.sendingSnapshot = false;
    const operation = this.lifecycle.then(async () => {
      const server = this.server;
      const sockets = this.sockets;
      this.server = null;
      this.sockets = null;
      this.origin = null;
      if (this.heartbeat) clearInterval(this.heartbeat);
      this.heartbeat = null;
      for (const [socket, client] of this.clients) {
        clearTimeout(client.authenticating);
        socket.terminate();
      }
      this.clients.clear();
      if (sockets) await new Promise<void>((resolve) => sockets.close(() => resolve()));
      if (server?.listening)
        await new Promise<void>((resolve) => {
          server.close(() => resolve());
          server.closeAllConnections();
        });
      this.change({ status: 'off', addresses: [], clientName: null, pending: null, error: null });
    });
    this.lifecycle = operation.catch(() => {});
    return operation;
  }

  private allowed(request: IncomingMessage, requireOrigin: boolean) {
    if (
      !this.origin ||
      !request.socket.remoteAddress ||
      !isPrivateIPv4(request.socket.remoteAddress)
    )
      return false;
    const host = new URL(this.origin).host;
    return (
      request.headers.host === host &&
      request.rawHeaders.filter((value, index) => index % 2 === 0 && value.toLowerCase() === 'host')
        .length === 1 &&
      (requireOrigin
        ? request.headers.origin === this.origin
        : !request.headers.origin || request.headers.origin === this.origin)
    );
  }

  private rateAllowed() {
    const now = Date.now();
    if (now - this.requestWindow.since > 10_000) this.requestWindow = { since: now, count: 0 };
    return ++this.requestWindow.count <= 60;
  }

  private async request(request: IncomingMessage, response: ServerResponse) {
    const generation = this.generation;
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader(
      'Content-Security-Policy',
      `default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; font-src 'self'; connect-src 'self' ${this.origin?.replace('http:', 'ws:')}; frame-ancestors 'none'; base-uri 'none'; form-action 'none'`,
    );
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    const json = (status: number, body: object) => {
      if (response.writableEnded || response.destroyed) return;
      response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify(body));
    };
    if (!this.allowed(request, request.method !== 'GET' && request.method !== 'HEAD'))
      return json(403, { error: 'forbidden' });
    if (!this.rateAllowed()) return json(429, { error: 'rate-limited' });
    if (
      (request.method === 'GET' || request.method === 'HEAD') &&
      (request.url === '/' || request.url?.startsWith('/assets/'))
    ) {
      try {
        if (!this.options.mobileAssets)
          return json(503, {
            error: 'mobile-assets-unavailable',
            message: '设备页面尚未构建，请构建应用后重试。',
          });
        const asset = await this.options.mobileAssets.read(request.url);
        if (generation !== this.generation || !this.allowed(request, false))
          return json(403, { error: 'connection-stopped' });
        if (!asset) return json(404, { error: 'not-found' });
        response.writeHead(200, {
          'Content-Type': asset.contentType,
          'Content-Length': asset.body.length,
        });
        response.end(request.method === 'HEAD' ? undefined : asset.body);
      } catch {
        json(503, {
          error: 'mobile-assets-unavailable',
          message: '设备页面不可用，请重新构建应用后重试。',
        });
      }
      return;
    }
    if (request.method !== 'POST' || request.url !== '/pair')
      return json(404, { error: 'not-found' });
    if (request.headers['content-type']?.split(';')[0].trim() !== 'application/json')
      return json(415, { error: 'json-required' });
    let bytes = 0;
    const chunks: Buffer[] = [];
    try {
      for await (const chunk of request) {
        bytes += Buffer.byteLength(chunk);
        if (bytes > 2048) {
          json(413, { error: 'payload-too-large' });
          return;
        }
        chunks.push(Buffer.from(chunk));
      }
      if (generation !== this.generation || !this.allowed(request, true))
        return json(403, { error: 'connection-stopped' });
      this.expire();
      const value: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (
        !record(value) ||
        !this.pairingRecord ||
        !equalSecret(value.token, this.pairingRecord.token)
      )
        return json(401, { error: 'pairing-expired' });
      if (this.authorization || this.pending) return json(409, { error: 'device-already-paired' });
      if (
        typeof value.name !== 'string' ||
        !value.name.trim() ||
        value.name.length > 60 ||
        /[\x00-\x1f\x7f]/.test(value.name)
      )
        return json(400, { error: 'invalid-name' });
      this.pairingRecord = null;
      this.pending = {
        id: secret(),
        name: value.name.trim(),
        code: String(randomInt(100000, 1000000)),
        expiresAt: Date.now() + PAIR_MS,
        socket: null,
      };
      this.change({
        pending: { id: this.pending.id, name: this.pending.name, code: this.pending.code },
        error: null,
      });
      json(200, {
        protocolVersion: REMOTE_PROTOCOL_VERSION,
        id: this.pending.id,
        code: this.pending.code,
        expiresAt: this.pending.expiresAt,
      });
    } catch {
      json(400, { error: 'invalid-request' });
    }
  }

  private connected(socket: WebSocket, generation: number) {
    const authenticating = setTimeout(() => this.fail(socket, '连接认证超时。'), 5000);
    authenticating.unref();
    this.clients.set(socket, {
      authenticated: false,
      alive: true,
      authenticating,
      commandsSince: Date.now(),
      commandCount: 0,
      draftCount: 0,
      messagesSince: Date.now(),
      messageCount: 0,
    });
    socket.on('error', () => {});
    socket.on('pong', () => {
      const client = this.clients.get(socket);
      if (client) client.alive = true;
    });
    socket.on('message', (data, binary) => {
      if (generation !== this.generation || binary) return this.fail(socket, '连接已失效。');
      const client = this.clients.get(socket);
      if (!client) return;
      let value: unknown;
      try {
        value = JSON.parse(data.toString());
      } catch {
        return this.fail(socket, '无效的消息。');
      }
      if (!record(value)) return this.fail(socket, '无效的消息。');
      this.expire();
      if (!client.authenticated) {
        if (value.protocolVersion !== REMOTE_PROTOCOL_VERSION)
          return this.fail(socket, '不支持的设备连接协议版本。');
        if (
          value.type === 'authenticate' &&
          this.pending &&
          equalSecret(value.pendingId, this.pending.id) &&
          !this.pending.socket
        ) {
          clearTimeout(client.authenticating);
          this.pending.socket = socket;
          this.send(socket, { type: 'pending', id: this.pending.id, code: this.pending.code });
          return;
        }
        if (
          value.type === 'resume' &&
          this.authorization &&
          equalSecret(value.token, this.authorization.token)
        ) {
          const previous = this.active;
          this.authorize(socket);
          if (previous && previous !== socket) previous.terminate();
          return;
        }
        return this.fail(socket, '连接认证失败。');
      }
      if (socket !== this.active) return this.fail(socket, '连接已失效。');
      if (Date.now() - client.messagesSince > 10_000) {
        client.messagesSince = Date.now();
        client.messageCount = 0;
      }
      if (++client.messageCount > 60) return this.fail(socket, '操作过于频繁。');
      if (value.type === 'sync') {
        this.send(socket, { type: 'snapshot', sequence: this.sequence, snapshot: this.snapshot });
        return;
      }
      if (value.type === 'disconnect') {
        this.abortCommands();
        this.authorization = null;
        this.active = null;
        this.sendingSnapshot = false;
        this.change({ status: 'waiting', clientName: null });
        this.send(socket, { type: 'disconnected' });
        socket.close(1000, 'Disconnected');
        return;
      }
      if (value.type === 'query-result') {
        if (!identifier(value.requestId)) return this.fail(socket, '无效的请求编号。');
        const entry =
          this.authorization?.commands.get(value.requestId) ??
          this.authorization?.drafts.get(value.requestId);
        if (entry?.result) this.send(socket, { type: 'result', result: entry.result });
        else if (entry) this.send(socket, { type: 'command-pending', requestId: value.requestId });
        else
          this.send(socket, {
            type: 'result',
            result: { requestId: value.requestId, ok: false, error: 'request-unknown' },
          });
        return;
      }
      if (value.type !== 'command') return this.fail(socket, '不支持的消息。');
      const command = parseRemoteCommand(value.command);
      if (!command) return this.fail(socket, '无效的操作参数。');
      void this.command(socket, command, generation);
    });
    socket.on('close', () => {
      clearTimeout(authenticating);
      this.clients.delete(socket);
      if (this.pending?.socket === socket) this.pending.socket = null;
      if (socket !== this.active) return;
      this.active = null;
      this.sendingSnapshot = false;
      if (this.authorization) {
        this.authorization.resumeUntil = Date.now() + RESUME_MS;
        this.change({ status: 'reconnecting' });
      }
    });
  }

  private authorize(socket: WebSocket) {
    const authorization = this.authorization;
    const client = this.clients.get(socket);
    if (!authorization || !client) return;
    clearTimeout(client.authenticating);
    client.authenticated = true;
    authorization.resumeUntil = Infinity;
    this.active = socket;
    this.sendingSnapshot = false;
    this.change({
      status: 'connected',
      clientName: authorization.name,
      pending: null,
      error: null,
    });
    this.send(socket, {
      type: 'paired',
      protocolVersion: REMOTE_PROTOCOL_VERSION,
      token: authorization.token,
      sequence: this.sequence,
      snapshot: this.snapshot,
    });
  }

  private async command(socket: WebSocket, command: RemoteCommand, generation: number) {
    const authorization = this.authorization;
    if (!authorization) return;
    const isDraft = command.action === 'set-draft';
    const cache = isDraft ? authorization.drafts : authorization.commands;
    const fingerprint = JSON.stringify(command);
    const existing =
      authorization.commands.get(command.requestId) ?? authorization.drafts.get(command.requestId);
    if (existing) {
      if (existing.fingerprint !== fingerprint)
        this.send(socket, {
          type: 'result',
          result: { requestId: command.requestId, ok: false, error: 'request-conflict' },
        });
      else if (existing.result) this.send(socket, { type: 'result', result: existing.result });
      return;
    }
    if (!isDraft && cache.size >= MAX_REQUESTS) {
      this.send(socket, {
        type: 'result',
        result: { requestId: command.requestId, ok: false, error: 'request-limit-repair-required' },
      });
      return;
    }
    if (isDraft && cache.size >= MAX_DRAFT_REQUESTS) {
      const oldest = [...cache].find(([, value]) => value.result !== undefined);
      if (oldest) cache.delete(oldest[0]);
      else {
        this.send(socket, {
          type: 'result',
          result: { requestId: command.requestId, ok: false, error: 'command-busy' },
        });
        return;
      }
    }
    const entry: CommandEntry = { fingerprint, controller: new AbortController() };
    cache.set(command.requestId, entry);
    let result: RemoteCommandResult;
    const client = this.clients.get(socket)!;
    if (Date.now() - client.commandsSince > 10_000) {
      client.commandsSince = Date.now();
      client.commandCount = 0;
      client.draftCount = 0;
    }
    if (
      (isDraft ? ++client.draftCount > 40 : ++client.commandCount > 20) ||
      [...authorization.commands.values(), ...authorization.drafts.values()].filter(
        (value) => !value.result,
      ).length > 4
    ) {
      result = { requestId: command.requestId, ok: false, error: 'command-busy' };
    } else if (
      !this.snapshot ||
      command.sessionId !== this.snapshot.sessionId ||
      command.sessionEpoch !== this.snapshot.sessionEpoch
    ) {
      result = { requestId: command.requestId, ok: false, error: 'session-changed' };
    } else {
      try {
        result = await this.options.onCommand(command, entry.controller.signal);
        if (result.requestId !== command.requestId || typeof result.ok !== 'boolean')
          throw new Error();
      } catch {
        result = { requestId: command.requestId, ok: false, error: 'command-failed' };
      }
    }
    if (generation !== this.generation || authorization !== this.authorization) return;
    entry.result = entry.controller.signal.aborted
      ? { requestId: command.requestId, ok: false, error: 'session-changed' }
      : {
          requestId: command.requestId,
          ok: result.ok,
          ...(typeof result.error === 'string' ? { error: result.error.slice(0, 300) } : {}),
          ...(typeof result.answerId === 'string'
            ? { answerId: result.answerId.slice(0, 128) }
            : {}),
          ...(revision(result.inputDraftRevision)
            ? { inputDraftRevision: result.inputDraftRevision }
            : {}),
        };
    if (this.active) this.send(this.active, { type: 'result', result: entry.result });
  }

  private send(socket: WebSocket, message: RemoteServerMessage) {
    if (socket.readyState !== WebSocket.OPEN) return;
    if (socket.bufferedAmount > MAX_SNAPSHOT * 2) {
      socket.terminate();
      return;
    }
    socket.send(JSON.stringify(message), (error) => {
      if (error) socket.terminate();
    });
  }

  private sendSnapshot() {
    const socket = this.active;
    if (!socket || this.sendingSnapshot || socket.readyState !== WebSocket.OPEN) return;
    if (socket.bufferedAmount > MAX_SNAPSHOT * 2) {
      socket.terminate();
      return;
    }
    const sequence = this.sequence;
    this.sendingSnapshot = true;
    socket.send(
      JSON.stringify({
        type: 'snapshot',
        sequence,
        snapshot: this.snapshot,
      } satisfies RemoteServerMessage),
      (error) => {
        if (socket !== this.active) return;
        this.sendingSnapshot = false;
        if (error) {
          socket.terminate();
          return;
        }
        if (sequence !== this.sequence) this.sendSnapshot();
      },
    );
  }

  private fail(socket: WebSocket, error: string) {
    this.send(socket, { type: 'error', error });
    socket.close(1008, 'Connection rejected');
    const timeout = setTimeout(() => {
      if (socket.readyState !== WebSocket.CLOSED) socket.terminate();
    }, 1000);
    timeout.unref();
  }

  private expire() {
    const now = Date.now();
    if (this.pairingRecord && this.pairingRecord.expiresAt <= now) this.pairingRecord = null;
    if (this.pending && this.pending.expiresAt <= now) {
      this.clearPending();
      this.change({ pending: null });
    }
    if (this.authorization && this.authorization.resumeUntil <= now) {
      this.abortCommands();
      this.authorization = null;
      this.change({ status: 'waiting', clientName: null });
    }
  }

  private tick() {
    this.expire();
    for (const [socket, client] of this.clients) {
      if (!client.alive) {
        socket.terminate();
        continue;
      }
      client.alive = false;
      socket.ping();
    }
  }
}
