import { REMOTE_PROTOCOL_VERSION } from '../../electron/contracts/remoteConnection';
import type {
  RemoteClientMessage,
  RemoteCommand,
  RemoteCommandResult,
  RemoteInterviewSnapshot,
} from '../../electron/contracts/remoteConnection';

export type MobileConnectionStatus =
  | 'idle'
  | 'pairing'
  | 'approval'
  | 'connecting'
  | 'reconnecting'
  | 'syncing'
  | 'ready'
  | 'waiting'
  | 'disconnected'
  | 'error';
type Action = 'sendQuestion' | 'microphone' | 'autoAnswer' | 'stopAnswer';
export interface MobileConnectionState {
  status: MobileConnectionStatus;
  snapshot: RemoteInterviewSnapshot | null;
  pairingCode: string | null;
  deviceName: string | null;
  draft: string;
  draftDirty: boolean;
  draftSyncing: boolean;
  error: string | null;
  errorCode: string | null;
  pending: boolean;
  pendingAction: Action | null;
  connected: boolean;
  hasPairingLink: boolean;
  canResume: boolean;
}
interface PendingPair {
  id: string;
  code: string;
  expiresAt: number;
}
interface SavedRequest {
  requestId: string;
  sessionId: string;
  sessionEpoch: number;
  action: Action;
}
interface PendingRequest extends SavedRequest {
  resolve?: () => void;
  draftRevision?: number;
  sharedInputRevision?: number;
  queryDeadline?: number;
}
interface DraftBase {
  truncated?: boolean;
  sessionId: string;
  sessionEpoch: number;
  text: string;
  revision: number;
  manual: boolean;
}
interface PendingDraft {
  requestId: string;
  sessionId: string;
  sessionEpoch: number;
  text?: string;
  expectedRevision?: number;
  editRevision?: number;
  completion?: Promise<boolean>;
  resolve?: (ok: boolean) => void;
  queryDeadline?: number;
}
const STORAGE_KEY = 'voxcue-mobile-lan-v1';
const RESUME_MS = 120_000;
const ACK_MS = 5_000;
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown, maximum: number): value is string =>
  typeof value === 'string' && value.length <= maximum;
const revision = (value: unknown): value is number =>
  Number.isSafeInteger(value) && (value as number) >= 0;
const secret = (value: unknown): value is string =>
  typeof value === 'string' && /^[A-Za-z0-9_-]{8,100}$/.test(value);
const action = (value: unknown): value is Action =>
  ['sendQuestion', 'microphone', 'autoAnswer', 'stopAnswer'].includes(value as string);

function privateOrigin(value: string): string | null {
  try {
    const url = new URL(value);
    const parts = url.hostname.split('.');
    if (
      url.protocol !== 'http:' ||
      url.username ||
      url.password ||
      parts.length !== 4 ||
      !parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255)
    )
      return null;
    const [first, second] = parts.map(Number);
    return first === 10 ||
      (first === 172 && second >= 16 && second <= 31) ||
      (first === 192 && second === 168)
      ? url.origin
      : null;
  } catch {
    return null;
  }
}

function validSnapshot(value: unknown): value is RemoteInterviewSnapshot | null {
  if (value === null) return true;
  if (
    !record(value) ||
    !(value.sessionId === null || text(value.sessionId, 128)) ||
    !revision(value.sessionEpoch) ||
    !revision(value.revision) ||
    !revision(value.micRevision) ||
    !revision(value.autoAnswerRevision) ||
    !revision(value.pendingQuestionRevision) ||
    !record(value.inputDraft) ||
    !text(value.inputDraft.text, 6000) ||
    !revision(value.inputDraft.revision) ||
    typeof value.inputDraft.manual !== 'boolean' ||
    (value.inputDraft.truncated !== undefined && typeof value.inputDraft.truncated !== 'boolean') ||
    !text(value.pendingQuestion, 6000) ||
    !['idle', 'running', 'paused', 'ended'].includes(value.status as string) ||
    !['remote', 'transcription'].includes(value.inputMode as string) ||
    !['generating', 'aiEnabled', 'microphoneMuted', 'microphoneToggling', 'autoAnswer'].every(
      (key) => typeof value[key] === 'boolean',
    ) ||
    !record(value.capabilities) ||
    !['sendQuestion', 'setMicrophone', 'setAutoAnswer', 'stopAnswer'].every(
      (key) => typeof (value.capabilities as Record<string, unknown>)[key] === 'boolean',
    ) ||
    !record(value.omitted) ||
    !revision(value.omitted.transcripts) ||
    !revision(value.omitted.answers) ||
    !Array.isArray(value.transcripts) ||
    value.transcripts.length > 200 ||
    !Array.isArray(value.answers) ||
    value.answers.length > 40
  )
    return false;
  return (
    value.transcripts.every(
      (row) =>
        record(row) &&
        text(row.id, 128) &&
        text(row.text, 16000) &&
        text(row.time, 128) &&
        typeof row.final === 'boolean' &&
        (row.source === undefined || ['microphone', 'system'].includes(row.source as string)) &&
        (row.textTruncated === undefined || typeof row.textTruncated === 'boolean'),
    ) &&
    value.answers.every(
      (row) =>
        record(row) &&
        text(row.id, 128) &&
        text(row.question, 6000) &&
        text(row.content, 128000) &&
        (row.error === undefined || text(row.error, 2000)) &&
        (row.status === undefined ||
          ['streaming', 'completed', 'stopped', 'failed'].includes(row.status as string)) &&
        (row.contentTruncated === undefined || typeof row.contentTruncated === 'boolean'),
    )
  );
}

/** Browser-only LAN client. Storage contains scoped, revocable pairing capabilities,
 * never desktop account credentials, interview text or a replayable command body. */
export class MobileConnection {
  private state: MobileConnectionState = {
    status: 'idle',
    snapshot: null,
    pairingCode: null,
    deviceName: null,
    draft: '',
    draftDirty: false,
    draftSyncing: false,
    error: null,
    errorCode: null,
    pending: false,
    pendingAction: null,
    connected: false,
    hasPairingLink: false,
    canResume: false,
  };
  private listeners = new Set<() => void>();
  private scrollListeners = new Set<(direction: 'up' | 'down') => void>();
  private lastScrollId = 0;
  private origin: string | null = null;
  private pairToken: string | null = null;
  private pendingPair: PendingPair | null = null;
  private resumeToken: string | null = null;
  private pendingRequest: PendingRequest | null = null;
  private draftBase: DraftBase | null = null;
  private draftRequest: PendingDraft | null = null;
  private sendingQuestion = false;
  private recoveringDraft = false;
  private composing = false;
  private deferredDraft: DraftBase | null = null;
  private adoptedDraftKey = '';
  private forceDraftSync = false;
  private deferredDraftForce = false;
  private socket: WebSocket | null = null;
  private active = false;
  private suspended = false;
  private awaitingSync = false;
  private generation = 0;
  private reconnectAttempt = 0;
  private reconnectDeadline = 0;
  private sequence = -1;
  private draftRevision = 0;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private handshakeTimer: ReturnType<typeof setTimeout> | undefined;
  private resultTimer: ReturnType<typeof setTimeout> | undefined;
  private draftTimer: ReturnType<typeof setTimeout> | undefined;
  private draftResultTimer: ReturnType<typeof setTimeout> | undefined;
  private pairAbort: AbortController | null = null;

  constructor() {
    if (typeof window === 'undefined') return;
    this.origin = privateOrigin(window.location.origin);
    if (!this.takePairFragment()) this.restore();
    this.state = {
      ...this.state,
      hasPairingLink: !!this.pairToken,
      canResume: !!this.resumeToken || !!this.pendingPair,
      pending: !!this.pendingRequest,
      pendingAction: this.pendingRequest?.action ?? null,
      pairingCode: this.pendingPair?.code ?? null,
      draftSyncing: !!this.draftRequest,
    };
    if (!this.origin)
      this.state = {
        ...this.state,
        status: 'error',
        errorCode: 'invalid-address',
        error: '请使用电脑提供的私人局域网连接网址。',
      };
  }

  getState = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  subscribeScroll = (listener: (direction: 'up' | 'down') => void) => {
    this.scrollListeners.add(listener);
    return () => {
      this.scrollListeners.delete(listener);
    };
  };
  private update(patch: Partial<MobileConnectionState>) {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }
  private takePairFragment() {
    const fragment = new URLSearchParams(window.location.hash.slice(1));
    if (!fragment.has('pair')) return false;
    // A camera may reuse this tab through hash navigation rather than reload.
    // Retire the previous page capability before exposing the replacement UI.
    window.history.replaceState(null, '', window.location.pathname + window.location.search);
    this.generation++;
    this.pairAbort?.abort();
    this.pairAbort = null;
    this.stopSocket();
    this.clearTimers();
    this.awaitingSync = false;
    this.composing = false;
    this.deferredDraft = null;
    this.deferredDraftForce = false;
    this.resumeToken = null;
    this.pendingPair = null;
    this.pendingRequest?.resolve?.();
    this.pendingRequest = null;
    this.releaseDraft(false);
    this.draftBase = null;
    this.lastScrollId = 0;
    this.clearSaved();
    this.reconnectAttempt = this.reconnectDeadline = 0;
    this.sequence = -1;
    const token = fragment.get('pair');
    this.pairToken = fragment.getAll('pair').length === 1 && secret(token) ? token : null;
    this.update({
      status: this.pairToken ? 'idle' : 'error',
      snapshot: null,
      connected: false,
      pending: false,
      pendingAction: null,
      pairingCode: null,
      hasPairingLink: !!this.pairToken,
      canResume: false,
      errorCode: this.pairToken ? null : 'invalid-link',
      error: this.pairToken ? null : '连接二维码无效，请重新扫码。',
      draft: '',
      draftDirty: false,
      draftSyncing: false,
    });
    return true;
  }
  private fail(code: string, message: string, clear = true) {
    this.awaitingSync = false;
    this.stopSocket();
    this.clearTimers();
    if (clear) {
      this.resumeToken = null;
      this.pendingPair = null;
      this.clearSaved();
    }
    if (clear) {
      this.finishRequest(false, code, message);
      this.releaseDraft(false);
    }
    this.update({
      status: 'error',
      connected: false,
      pairingCode: null,
      canResume: !!this.resumeToken || !!this.pendingPair,
      errorCode: code,
      error: message,
    });
  }
  private clearSaved() {
    try {
      window.sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      /* In-memory recovery still works. */
    }
  }
  private restore() {
    try {
      const value: unknown = JSON.parse(window.sessionStorage.getItem(STORAGE_KEY) ?? 'null');
      if (
        !record(value) ||
        value.origin !== this.origin ||
        value.protocolVersion !== REMOTE_PROTOCOL_VERSION
      ) {
        this.clearSaved();
        return;
      }
      if (secret(value.token)) this.resumeToken = value.token;
      if (
        record(value.pairing) &&
        secret(value.pairing.id) &&
        text(value.pairing.code, 6) &&
        /^\d{6}$/.test(value.pairing.code) &&
        revision(value.pairing.expiresAt) &&
        value.pairing.expiresAt > Date.now()
      )
        this.pendingPair = {
          id: value.pairing.id,
          code: value.pairing.code,
          expiresAt: value.pairing.expiresAt,
        };
      if (!this.resumeToken && !this.pendingPair) {
        this.clearSaved();
        return;
      }
      if (
        record(value.pending) &&
        secret(value.pending.requestId) &&
        text(value.pending.sessionId, 128) &&
        revision(value.pending.sessionEpoch) &&
        action(value.pending.action)
      )
        this.pendingRequest = {
          requestId: value.pending.requestId,
          sessionId: value.pending.sessionId,
          sessionEpoch: value.pending.sessionEpoch,
          action: value.pending.action,
        };
      if (
        record(value.draftPending) &&
        secret(value.draftPending.requestId) &&
        text(value.draftPending.sessionId, 128) &&
        revision(value.draftPending.sessionEpoch)
      )
        this.draftRequest = {
          requestId: value.draftPending.requestId,
          sessionId: value.draftPending.sessionId,
          sessionEpoch: value.draftPending.sessionEpoch,
        };
    } catch {
      this.clearSaved();
    }
  }
  private save() {
    if (!this.resumeToken && !this.pendingPair) {
      this.clearSaved();
      return;
    }
    const pending = this.pendingRequest;
    try {
      window.sessionStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          protocolVersion: REMOTE_PROTOCOL_VERSION,
          origin: this.origin,
          ...(this.resumeToken ? { token: this.resumeToken } : {}),
          ...(this.pendingPair ? { pairing: this.pendingPair } : {}),
          ...(this.draftRequest
            ? {
                draftPending: {
                  requestId: this.draftRequest.requestId,
                  sessionId: this.draftRequest.sessionId,
                  sessionEpoch: this.draftRequest.sessionEpoch,
                },
              }
            : {}),
          ...(pending
            ? {
                pending: {
                  requestId: pending.requestId,
                  sessionId: pending.sessionId,
                  sessionEpoch: pending.sessionEpoch,
                  action: pending.action,
                },
              }
            : {}),
        }),
      );
    } catch {
      /* A blocked sessionStorage falls back to this page's memory. */
    }
  }
  private clearTimers() {
    clearTimeout(this.retryTimer);
    clearTimeout(this.handshakeTimer);
    clearTimeout(this.resultTimer);
    clearTimeout(this.draftTimer);
    clearTimeout(this.draftResultTimer);
    this.retryTimer = this.handshakeTimer = this.resultTimer = undefined;
    this.draftTimer = this.draftResultTimer = undefined;
  }
  private stopSocket() {
    const socket = this.socket;
    this.socket = null;
    if (!socket) return;
    socket.onopen = socket.onmessage = socket.onclose = socket.onerror = null;
    socket.close();
  }
  private listen(enable: boolean) {
    const method = enable ? 'addEventListener' : 'removeEventListener';
    window[method]('online', this.online);
    window[method]('offline', this.offline);
    window[method]('pagehide', this.pagehide);
    window[method]('pageshow', this.pageshow);
    window[method]('hashchange', this.hashchange);
    window.document[method]('visibilitychange', this.visibility);
  }
  private online = () => {
    if (!this.active) return;
    if (this.state.connected) this.sync();
    else if (this.resumeToken || this.pendingPair) void this.retry();
  };
  private offline = () => {
    if (this.active && this.socket) this.lost();
  };
  private visibility = () => {
    if (window.document.visibilityState === 'visible') this.online();
  };
  private hashchange = () => {
    this.takePairFragment();
  };
  private pagehide = () => {
    if (!this.active) return;
    this.suspended = true;
    this.save();
    this.stopSocket();
    this.clearTimers();
    this.update({ connected: false, status: 'reconnecting' });
  };
  private pageshow = () => {
    this.suspended = false;
    if (this.active && !this.state.connected && (this.resumeToken || this.pendingPair))
      void this.retry();
  };

  start = async (): Promise<void> => {
    if (!this.origin || typeof window === 'undefined') {
      this.fail('invalid-address', '请使用电脑提供的私人局域网连接网址。');
      return;
    }
    this.takePairFragment();
    if (!this.active) {
      this.active = true;
      this.listen(true);
    }
    if (this.socket || this.pairAbort) return;
    this.suspended = false;
    this.update({ error: null, errorCode: null });
    if (!this.pairToken) {
      if (this.resumeToken || this.pendingPair) this.connect();
      else this.fail('pairing-required', '请扫描电脑端的连接二维码。');
      return;
    }
    const token = this.pairToken;
    this.pairToken = null;
    this.update({ status: 'pairing', hasPairingLink: false });
    const generation = ++this.generation;
    const abort = new AbortController();
    this.pairAbort = abort;
    const timeout = setTimeout(() => abort.abort(), 10_000);
    try {
      const response = await window.fetch(this.origin + '/pair', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token,
          name: /iPhone|iPad/.test(window.navigator.userAgent)
            ? 'iPhone / iPad'
            : /Android/.test(window.navigator.userAgent)
              ? 'Android'
              : '设备浏览器',
        }),
        cache: 'no-store',
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
        signal: abort.signal,
      });
      if (!this.active || generation !== this.generation) return;
      if (!response.ok) {
        this.fail(
          response.status === 401
            ? 'pairing-expired'
            : response.status === 409
              ? 'pairing-conflict'
              : 'pairing-failed',
          response.status === 401
            ? '二维码已过期，请在电脑刷新后重新扫码。'
            : response.status === 409
              ? '电脑已有配对请求或已连接设备，请在电脑检查。'
              : '无法申请连接，请检查电脑后重新扫码。',
        );
        return;
      }
      const value: unknown = await response.json();
      if (!this.active || generation !== this.generation) return;
      if (record(value) && value.protocolVersion !== REMOTE_PROTOCOL_VERSION) {
        this.fail('protocol-mismatch', '设备页面与电脑版本不兼容，请重新打开连接页面。');
        return;
      }
      if (
        !record(value) ||
        !secret(value.id) ||
        !text(value.code, 6) ||
        !/^\d{6}$/.test(value.code) ||
        !revision(value.expiresAt)
      ) {
        this.fail('invalid-response', '电脑返回的配对信息无效，请重新扫码。');
        return;
      }
      this.pendingPair = { id: value.id, code: value.code, expiresAt: value.expiresAt };
      this.save();
      this.update({ pairingCode: value.code, canResume: true });
      this.connect();
    } catch {
      if (this.active && generation === this.generation)
        this.fail('pairing-failed', '未能确认配对申请结果，请检查网络并重新扫码。');
    } finally {
      clearTimeout(timeout);
      if (this.pairAbort === abort) this.pairAbort = null;
    }
  };

  private connect() {
    if (!this.active || this.suspended || !this.origin || this.socket) return;
    if (window.navigator.onLine === false) {
      if (!this.reconnectDeadline) this.reconnectDeadline = Date.now() + RESUME_MS;
      this.update({
        status: 'reconnecting',
        connected: false,
        errorCode: 'network-disconnected',
        error: '网络已断开，恢复后将重新连接。',
      });
      this.scheduleRetry();
      return;
    }
    if (this.pendingPair && this.pendingPair.expiresAt <= Date.now()) {
      this.fail('pairing-expired', '配对请求已过期，请重新扫码。');
      return;
    }
    if (!this.resumeToken && !this.pendingPair) {
      this.fail('pairing-required', '请扫描电脑端的连接二维码。');
      return;
    }
    let socket: WebSocket;
    try {
      socket = new window.WebSocket(this.origin.replace(/^http:/, 'ws:') + '/connect');
    } catch {
      this.fail('connection-timeout', '无法建立局域网连接，请检查网络后重试。', false);
      return;
    }
    this.socket = socket;
    this.update({
      status: this.reconnectDeadline ? 'reconnecting' : 'connecting',
      connected: false,
    });
    this.handshakeTimer = setTimeout(() => {
      if (this.socket === socket) this.lost();
    }, 8000);
    socket.onopen = () => {
      if (this.socket !== socket || !this.active) return;
      this.send(
        this.resumeToken
          ? { type: 'resume', protocolVersion: REMOTE_PROTOCOL_VERSION, token: this.resumeToken }
          : {
              type: 'authenticate',
              protocolVersion: REMOTE_PROTOCOL_VERSION,
              pendingId: this.pendingPair!.id,
            },
      );
    };
    socket.onmessage = (event) => {
      if (this.socket !== socket || !this.active) return;
      if (typeof event.data !== 'string' || event.data.length > 1100 * 1024) {
        this.fail('invalid-response', '收到无效的电脑消息，请重新连接。');
        return;
      }
      try {
        this.receive(JSON.parse(event.data), socket);
      } catch {
        this.fail('invalid-response', '收到无效的电脑消息，请重新连接。');
      }
    };
    socket.onerror = () => {
      if (this.socket === socket) this.lost();
    };
    socket.onclose = () => {
      if (this.socket === socket) this.lost();
    };
  }
  private send(value: RemoteClientMessage) {
    if (!this.socket || this.socket.readyState !== 1) return false;
    try {
      this.socket.send(JSON.stringify(value));
      return true;
    } catch {
      this.lost();
      return false;
    }
  }
  private acknowledgeSnapshot(socket: WebSocket, sequence: number, deliveryId: string) {
    if (socket !== this.socket || !this.active) return;
    if (!this.send({ type: 'snapshot-applied', sequence, deliveryId }) && this.state.connected)
      this.lost();
  }
  private receive(value: unknown, socket: WebSocket) {
    if (!record(value)) throw Error('Invalid message');
    if (value.type === 'error') {
      const message = text(value.error, 1000) ? value.error : '连接已失效，请重新扫码。';
      if (message.includes('认证超时') || message === 'resume-in-use') {
        this.lost();
        return;
      }
      const code = message.includes('协议版本')
        ? 'protocol-mismatch'
        : message.includes('过期')
          ? 'pairing-expired'
          : message.includes('取消')
            ? 'pairing-rejected'
            : 'authentication-failed';
      this.fail(code, message);
      return;
    }
    if (value.type === 'disconnected') {
      this.fail('authentication-failed', '设备连接已断开，请重新扫码。');
      return;
    }
    if (value.type === 'pending') {
      if (
        !this.pendingPair ||
        value.id !== this.pendingPair.id ||
        value.code !== this.pendingPair.code
      )
        throw Error('Invalid pending');
      clearTimeout(this.handshakeTimer);
      this.handshakeTimer = setTimeout(
        () => this.fail('pairing-expired', '配对请求已过期，请重新扫码。'),
        Math.max(1, this.pendingPair.expiresAt - Date.now()),
      );
      this.update({
        status: 'approval',
        pairingCode: this.pendingPair.code,
        error: null,
        errorCode: null,
      });
      return;
    }
    if (value.type === 'paired') {
      if (this.state.connected) throw Error('Duplicate authentication');
      if (value.protocolVersion !== REMOTE_PROTOCOL_VERSION) {
        this.fail('protocol-mismatch', '设备页面与电脑版本不兼容，请重新打开连接页面。');
        return;
      }
      if (
        !secret(value.token) ||
        !revision(value.sequence) ||
        !secret(value.deliveryId) ||
        !validSnapshot(value.snapshot)
      )
        throw Error('Invalid paired');
      clearTimeout(this.handshakeTimer);
      clearTimeout(this.retryTimer);
      this.resumeToken = value.token;
      this.pendingPair = null;
      this.reconnectAttempt = 0;
      this.reconnectDeadline = 0;
      this.awaitingSync = false;
      this.recoveringDraft = !!this.draftRequest;
      this.sequence = value.sequence;
      const accepted = this.acceptSnapshot(value.snapshot, true);
      this.update({
        connected: true,
        pairingCode: null,
        canResume: true,
        error: null,
        errorCode: null,
        status: accepted ? this.settledStatus() : 'syncing',
      });
      this.save();
      this.acknowledgeSnapshot(socket, value.sequence, value.deliveryId);
      if (!accepted) {
        this.sync(true);
        return;
      }
      if (this.pendingRequest) {
        this.pendingRequest.queryDeadline = Date.now() + 20_000;
        this.queryResult();
      }
      if (this.draftRequest) {
        this.draftRequest.queryDeadline = Date.now() + 20_000;
        this.queryDraft();
      } else this.scheduleDraft();
      return;
    }
    if (!this.state.connected) throw Error('Not authenticated');
    if (value.type === 'snapshot') {
      if (!revision(value.sequence) || !secret(value.deliveryId) || !validSnapshot(value.snapshot))
        throw Error('Invalid snapshot');
      try {
        if (
          value.sequence < this.sequence ||
          (value.sequence === this.sequence && !this.awaitingSync)
        )
          return;
        if (!this.acceptSnapshot(value.snapshot, this.forceDraftSync)) return;
        this.sequence = value.sequence;
        const synced = this.awaitingSync;
        if (synced) {
          this.awaitingSync = false;
          this.forceDraftSync = false;
          clearTimeout(this.handshakeTimer);
        }
        this.update({ status: this.settledStatus() });
        if (synced && this.pendingRequest) {
          this.pendingRequest.queryDeadline = Date.now() + 20_000;
          this.queryResult();
        }
        if (synced && this.draftRequest) {
          this.draftRequest.queryDeadline = Date.now() + 20_000;
          this.queryDraft();
        } else this.scheduleDraft();
      } finally {
        // Also acknowledge deliberately discarded stale frames: processing is
        // complete, and the sender must be free to supply its latest snapshot.
        this.acknowledgeSnapshot(socket, value.sequence, value.deliveryId);
      }
    } else if (value.type === 'scroll') {
      if (
        !revision(value.scrollId) ||
        !text(value.sessionId, 128) ||
        !revision(value.sessionEpoch) ||
        !['up', 'down'].includes(value.direction as string)
      )
        throw Error('Invalid scroll');
      const snapshot = this.state.snapshot;
      if (
        this.awaitingSync ||
        !snapshot?.sessionId ||
        !['running', 'paused'].includes(snapshot.status) ||
        value.sessionId !== snapshot.sessionId ||
        value.sessionEpoch !== snapshot.sessionEpoch ||
        value.scrollId <= this.lastScrollId
      )
        return;
      this.lastScrollId = value.scrollId;
      for (const listener of this.scrollListeners) listener(value.direction as 'up' | 'down');
    } else if (value.type === 'result') {
      if (
        !record(value.result) ||
        !secret(value.result.requestId) ||
        typeof value.result.ok !== 'boolean' ||
        (value.result.error !== undefined && !text(value.result.error, 1000)) ||
        (value.result.answerId !== undefined && !text(value.result.answerId, 128)) ||
        (value.result.inputDraftRevision !== undefined &&
          !revision(value.result.inputDraftRevision))
      )
        throw Error('Invalid result');
      this.result(value.result as unknown as RemoteCommandResult);
    } else if (value.type === 'command-pending') {
      if (value.requestId === this.draftRequest?.requestId) {
        this.queueDraftQuery(1500);
        return;
      }
      if (value.requestId !== this.pendingRequest?.requestId) return;
      this.queueResultQuery(1500);
    } else throw Error('Unsupported message');
  }
  private readyStatus(): MobileConnectionStatus {
    return this.state.snapshot?.sessionId &&
      ['running', 'paused'].includes(this.state.snapshot.status)
      ? 'ready'
      : 'waiting';
  }
  private settledStatus(): MobileConnectionStatus {
    return this.awaitingSync || this.pendingRequest || (this.recoveringDraft && this.draftRequest)
      ? 'syncing'
      : this.readyStatus();
  }
  private acceptSnapshot(snapshot: RemoteInterviewSnapshot | null, forceDraft = false) {
    const previous = this.state.snapshot;
    if (snapshot && previous && snapshot.sessionEpoch < previous.sessionEpoch) return false;
    if (
      snapshot &&
      previous &&
      snapshot.sessionEpoch === previous.sessionEpoch &&
      snapshot.sessionId === previous.sessionId &&
      snapshot.revision < previous.revision
    )
      return false;
    // A successful draft CAS can arrive before its replacement snapshot.
    // Even a resumed/forced snapshot cannot undo that acknowledged revision.
    const draft = this.draftBase;
    if (
      snapshot &&
      draft &&
      snapshot.sessionId === draft.sessionId &&
      snapshot.sessionEpoch === draft.sessionEpoch &&
      snapshot.inputDraft.revision < draft.revision
    )
      return false;
    this.update({ snapshot });
    if (snapshot?.sessionId)
      this.acceptSharedDraft(
        {
          ...snapshot.inputDraft,
          sessionId: snapshot.sessionId,
          sessionEpoch: snapshot.sessionEpoch,
        },
        forceDraft,
      );
    else if (!snapshot?.sessionId) {
      this.draftBase = null;
      this.update({ draft: '', draftDirty: false });
    }
    return true;
  }
  private adoptDraft(base: DraftBase) {
    const key = `${base.sessionId}:${base.sessionEpoch}:${base.revision}`;
    if (this.state.draft !== base.text || this.adoptedDraftKey !== key) this.draftRevision++;
    this.adoptedDraftKey = key;
    this.update({ draft: base.text, draftDirty: false });
  }
  private acceptSharedDraft(remote: DraftBase, force = false) {
    if (this.composing) {
      this.deferredDraft = remote;
      this.deferredDraftForce ||= force;
      return;
    }
    const previous = this.draftBase;
    const sameScene =
      previous?.sessionId === remote.sessionId && previous.sessionEpoch === remote.sessionEpoch;
    if (!force && sameScene && remote.revision < previous.revision) return;
    const changed =
      !sameScene ||
      remote.revision !== previous.revision ||
      remote.text !== previous.text ||
      remote.manual !== previous.manual ||
      remote.truncated !== previous.truncated;
    const request = this.draftRequest;
    const ownWrite =
      !force &&
      sameScene &&
      request?.sessionId === remote.sessionId &&
      request.sessionEpoch === remote.sessionEpoch &&
      request.expectedRevision !== undefined &&
      remote.revision === request.expectedRevision + 1 &&
      remote.manual &&
      remote.text === request.text;
    this.draftBase = remote;
    if (ownWrite) {
      if (request.editRevision === this.draftRevision) {
        this.adoptedDraftKey = `${remote.sessionId}:${remote.sessionEpoch}:${remote.revision}`;
        this.update({ draftDirty: false });
      }
      this.releaseDraft(true);
      this.save();
    } else if (force || changed) {
      clearTimeout(this.draftTimer);
      this.draftTimer = undefined;
      this.releaseDraft(false);
      this.adoptDraft(remote);
      this.save();
    } else if (!this.state.draftDirty) this.adoptDraft(remote);
    this.scheduleDraft();
  }
  private canSyncDraft() {
    const snapshot = this.state.snapshot,
      base = this.draftBase;
    return !!(
      this.active &&
      !this.composing &&
      this.state.connected &&
      !this.awaitingSync &&
      !this.suspended &&
      snapshot?.sessionId &&
      ['running', 'paused'].includes(snapshot.status) &&
      base &&
      base.sessionId === snapshot.sessionId &&
      base.sessionEpoch === snapshot.sessionEpoch
    );
  }
  private scheduleDraft(delay = 400) {
    if (
      this.draftTimer ||
      this.draftRequest ||
      !this.state.draftDirty ||
      !this.canSyncDraft() ||
      this.state.draft.length > 6000
    )
      return;
    this.draftTimer = setTimeout(() => {
      this.draftTimer = undefined;
      void this.flushDraft();
    }, delay);
  }
  private async flushDraft(): Promise<boolean> {
    clearTimeout(this.draftTimer);
    this.draftTimer = undefined;
    if (this.draftRequest && !(await (this.draftRequest.completion ?? Promise.resolve(false))))
      return false;
    if (!this.canSyncDraft()) return false;
    if (!this.state.draftDirty) return true;
    if (this.state.draft.length > 6000) {
      this.update({ errorCode: 'draft-too-long', error: '输入不能超过 6000 字符。' });
      return false;
    }
    const base = this.commandBase()!,
      canonical = this.draftBase!;
    let resolve!: (ok: boolean) => void;
    const completion = new Promise<boolean>((finish) => {
      resolve = finish;
    });
    this.draftRequest = {
      ...base,
      text: this.state.draft,
      expectedRevision: canonical.revision,
      editRevision: this.draftRevision,
      completion,
      resolve,
    };
    this.update({ draftSyncing: true });
    this.save();
    if (
      this.send({
        type: 'command',
        command: {
          ...base,
          action: 'set-draft',
          text: this.state.draft,
          expectedRevision: canonical.revision,
        },
      })
    )
      this.queueDraftQuery(ACK_MS);
    else if (this.state.connected) this.lost();
    return completion;
  }
  private releaseDraft(ok: boolean) {
    const request = this.draftRequest;
    this.draftRequest = null;
    this.recoveringDraft = false;
    clearTimeout(this.draftResultTimer);
    this.draftResultTimer = undefined;
    if (request) {
      this.update({ draftSyncing: false });
      request.resolve?.(ok);
    }
  }
  private queueDraftQuery(delay: number) {
    clearTimeout(this.draftResultTimer);
    this.draftResultTimer = setTimeout(() => this.queryDraft(), delay);
  }
  private queryDraft() {
    const pending = this.draftRequest;
    if (!pending || !this.state.connected || this.awaitingSync) return;
    pending.queryDeadline ??= Date.now() + 20_000;
    if (Date.now() >= pending.queryDeadline) {
      this.draftResult({ requestId: pending.requestId, ok: false, error: 'request-unknown' });
      return;
    }
    if (this.send({ type: 'query-result', requestId: pending.requestId }))
      this.queueDraftQuery(3000);
  }
  private draftResult(result: RemoteCommandResult) {
    const request = this.draftRequest;
    if (!request) return;
    const currentScene =
      this.draftBase?.sessionId === request.sessionId &&
      this.draftBase.sessionEpoch === request.sessionEpoch;
    if (result.ok && revision(result.inputDraftRevision)) {
      if (
        request.text !== undefined &&
        currentScene &&
        result.inputDraftRevision >= this.draftBase!.revision
      ) {
        this.draftBase = {
          sessionId: request.sessionId,
          sessionEpoch: request.sessionEpoch,
          revision: result.inputDraftRevision,
          text: request.text,
          manual: true,
        };
        if (request.editRevision === this.draftRevision) {
          this.adoptedDraftKey = `${request.sessionId}:${request.sessionEpoch}:${result.inputDraftRevision}`;
          this.update({ draftDirty: false });
        }
      }
      this.releaseDraft(true);
      this.save();
      this.update({ status: this.settledStatus() });
      this.scheduleDraft();
      return;
    }
    this.releaseDraft(false);
    this.save();
    this.update({ status: this.settledStatus() });
    if (request.text === undefined || !currentScene) return;
    if (result.error === 'draft-busy') {
      this.scheduleDraft(800);
      return;
    }
    // A rejected/unknown CAS never replays its body. Refresh and take the PC's
    // current draft, including an authoritative empty value.
    this.update({ draftDirty: false });
    this.sync(true);
  }
  private sync(forceDraft = false) {
    if (!this.active || !this.state.connected || this.awaitingSync) return;
    this.awaitingSync = true;
    this.forceDraftSync = forceDraft;
    this.recoveringDraft = !!this.draftRequest;
    clearTimeout(this.resultTimer);
    clearTimeout(this.draftResultTimer);
    this.update({ status: 'syncing' });
    if (!this.send({ type: 'sync' })) {
      if (this.state.connected) this.lost();
      return;
    }
    clearTimeout(this.handshakeTimer);
    this.handshakeTimer = setTimeout(() => {
      if (this.awaitingSync) this.lost();
    }, 8000);
  }
  private lost() {
    this.awaitingSync = false;
    this.stopSocket();
    this.clearTimers();
    if (!this.active || this.suspended) return;
    this.save();
    this.update({
      connected: false,
      status: 'reconnecting',
      errorCode: 'network-disconnected',
      error: '连接已中断，正在重新连接。',
    });
    if (!this.reconnectDeadline) this.reconnectDeadline = Date.now() + RESUME_MS;
    this.scheduleRetry();
  }
  private scheduleRetry() {
    if (!this.active || this.suspended || this.retryTimer) return;
    if (this.reconnectDeadline && Date.now() >= this.reconnectDeadline) {
      this.fail('resume-expired', '连接恢复时间已过，请重新扫码。');
      return;
    }
    const delay = Math.min(1000 * 2 ** this.reconnectAttempt++, 10_000);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = undefined;
      this.connect();
    }, delay);
  }
  retry = async (): Promise<void> => {
    if (!this.active) {
      await this.start();
      return;
    }
    if (this.state.connected || this.socket || this.pairAbort) return;
    clearTimeout(this.retryTimer);
    this.retryTimer = undefined;
    this.connect();
  };
  setDraft = (draft: string) => {
    if (draft === this.state.draft) return;
    this.draftRevision++;
    clearTimeout(this.draftTimer);
    this.draftTimer = undefined;
    this.update({
      draft,
      draftDirty: !this.draftBase || draft !== this.draftBase.text || !this.draftBase.manual,
    });
    this.scheduleDraft();
  };
  setComposing = (composing: boolean) => {
    this.composing = composing;
    if (composing) {
      clearTimeout(this.draftTimer);
      this.draftTimer = undefined;
      return;
    }
    const deferred = this.deferredDraft,
      force = this.deferredDraftForce;
    this.deferredDraft = null;
    this.deferredDraftForce = false;
    if (
      deferred &&
      deferred.sessionId === this.state.snapshot?.sessionId &&
      deferred.sessionEpoch === this.state.snapshot.sessionEpoch
    )
      this.acceptSharedDraft(deferred, force);
    this.scheduleDraft();
  };
  private async request(command: RemoteCommand, pendingAction: Action, clearDraft: boolean) {
    if (!this.state.connected || this.state.status !== 'ready' || this.pendingRequest) {
      this.update({ errorCode: 'command-unavailable', error: '连接恢复并同步完成后才能操作。' });
      return;
    }
    await new Promise<void>((resolve) => {
      this.pendingRequest = {
        requestId: command.requestId,
        sessionId: command.sessionId,
        sessionEpoch: command.sessionEpoch,
        action: pendingAction,
        resolve,
        ...(clearDraft ? { draftRevision: this.draftRevision } : {}),
        ...(command.action === 'ask' && command.inputDraftRevision !== undefined
          ? { sharedInputRevision: command.inputDraftRevision }
          : {}),
      };
      this.update({ pending: true, pendingAction, error: null, errorCode: null });
      this.save();
      if (this.send({ type: 'command', command })) this.queueResultQuery(ACK_MS);
      else if (this.state.connected) this.lost();
    });
  }
  private commandBase() {
    const snapshot = this.state.snapshot;
    if (!snapshot?.sessionId) return null;
    // getRandomValues is available on the HTTP LAN page; randomUUID is not.
    const bytes = new Uint8Array(16);
    window.crypto.getRandomValues(bytes);
    return {
      requestId: 'm' + [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join(''),
      sessionId: snapshot.sessionId,
      sessionEpoch: snapshot.sessionEpoch,
    };
  }
  sendQuestion = async (fromTranscript = false): Promise<void> => {
    if (this.sendingQuestion) return;
    if (this.composing) {
      this.update({ errorCode: 'draft-busy', error: '请先完成当前输入。' });
      return;
    }
    const snapshot = this.state.snapshot,
      base = this.commandBase();
    if (!base || snapshot?.status !== 'running' || !snapshot.capabilities.sendQuestion) {
      this.update({ errorCode: 'command-unavailable', error: '当前无法发送问题，请稍后重试。' });
      return;
    }
    if (fromTranscript && (snapshot.inputDraft.manual || this.state.draft.trim())) {
      this.update({ errorCode: 'command-unavailable', error: '请发送电脑当前输入框中的内容。' });
      return;
    }
    if (!fromTranscript && this.draftBase?.truncated && !this.state.draftDirty) {
      this.update({
        errorCode: 'draft-too-long',
        error: '电脑输入超过 6000 字符，请先编辑为完整的较短问题。',
      });
      return;
    }
    const value = fromTranscript ? snapshot.pendingQuestion : this.state.draft;
    if (!value.trim()) {
      this.update({ errorCode: 'question-empty', error: '请输入问题。' });
      return;
    }
    if (value.trim().length > 6000) {
      this.update({ errorCode: 'question-too-long', error: '问题不能超过 6000 字符。' });
      return;
    }
    this.sendingQuestion = true;
    const edited = this.draftRevision;
    try {
      if (!fromTranscript) {
        if (!(await this.flushDraft())) {
          this.update({
            errorCode: 'draft-changed',
            error: '电脑输入已变化，请确认当前内容后重新发送。',
          });
          return;
        }
        if (edited !== this.draftRevision || this.state.draftDirty) {
          this.update({ errorCode: 'draft-changed', error: '输入已变化，请确认内容后重新发送。' });
          return;
        }
      }
      const currentBase = this.commandBase();
      if (
        !currentBase ||
        currentBase.sessionId !== base.sessionId ||
        currentBase.sessionEpoch !== base.sessionEpoch
      )
        return;
      await this.request(
        {
          ...currentBase,
          action: 'ask',
          text: value.trim(),
          ...(fromTranscript
            ? { pendingQuestionRevision: snapshot.pendingQuestionRevision }
            : { inputDraftRevision: this.draftBase!.revision }),
        },
        'sendQuestion',
        !fromTranscript,
      );
    } finally {
      this.sendingQuestion = false;
    }
  };
  setMicrophoneMuted = async (muted: boolean): Promise<void> => {
    const snapshot = this.state.snapshot,
      base = this.commandBase();
    if (!base || !snapshot?.capabilities.setMicrophone) {
      this.update({ errorCode: 'command-unavailable', error: '当前无法切换麦克风。' });
      return;
    }
    await this.request(
      { ...base, action: 'set-microphone', muted, expectedRevision: snapshot.micRevision },
      'microphone',
      false,
    );
  };
  setAutoAnswer = async (enabled: boolean): Promise<void> => {
    const snapshot = this.state.snapshot,
      base = this.commandBase();
    if (!base || !snapshot?.capabilities.setAutoAnswer) {
      this.update({ errorCode: 'command-unavailable', error: '当前无法切换自动回答。' });
      return;
    }
    await this.request(
      {
        ...base,
        action: 'set-auto-answer',
        enabled,
        expectedRevision: snapshot.autoAnswerRevision,
      },
      'autoAnswer',
      false,
    );
  };
  stopAnswer = async (): Promise<void> => {
    const snapshot = this.state.snapshot,
      base = this.commandBase();
    const answerId = snapshot?.answers.at(-1)?.id;
    if (!base || !answerId || !snapshot?.capabilities.stopAnswer) {
      this.update({ errorCode: 'command-unavailable', error: '当前没有正在生成的回答。' });
      return;
    }
    await this.request({ ...base, action: 'stop-answer', answerId }, 'stopAnswer', false);
  };
  private queueResultQuery(delay: number) {
    clearTimeout(this.resultTimer);
    this.resultTimer = setTimeout(() => this.queryResult(), delay);
  }
  private queryResult() {
    const pending = this.pendingRequest;
    if (!pending || !this.state.connected) return;
    pending.queryDeadline ??= Date.now() + 20_000;
    if (Date.now() >= pending.queryDeadline) {
      this.finishRequest(
        false,
        'command-result-unknown',
        '无法确认上次操作结果，请检查电脑或当前状态后再操作。',
      );
      return;
    }
    if (this.send({ type: 'query-result', requestId: pending.requestId }))
      this.queueResultQuery(3000);
  }
  private result(result: RemoteCommandResult) {
    if (result.requestId === this.draftRequest?.requestId) {
      this.draftResult(result);
      return;
    }
    if (result.requestId !== this.pendingRequest?.requestId) return;
    const pending = this.pendingRequest;
    if (
      pending.sharedInputRevision !== undefined &&
      this.draftBase?.sessionId === pending.sessionId &&
      this.draftBase.sessionEpoch === pending.sessionEpoch
    ) {
      if (
        result.ok &&
        revision(result.inputDraftRevision) &&
        result.inputDraftRevision > this.draftBase.revision
      )
        this.draftBase = {
          ...this.draftBase,
          text: '',
          manual: false,
          revision: result.inputDraftRevision,
        };
    }
    const code =
      result.error === 'request-unknown'
        ? 'command-result-unknown'
        : result.error === 'request-limit-repair-required'
          ? 'request-limit'
          : 'command-failed';
    const messages: Record<string, string> = {
      'request-unknown': '电脑无法确认上次操作是否接收，请检查结果，不要自动重复发送。',
      'request-conflict': '操作标识冲突，请同步状态后重试。',
      'request-limit-repair-required': '本次连接操作次数已达上限，请断开后重新配对。',
      'command-busy': '电脑正在处理操作，请稍后重试。',
      'session-changed': '面试已变化，请同步后重试。',
      'command-failed': '操作失败，请同步状态后重试。',
    };
    this.finishRequest(
      result.ok,
      code,
      (result.error && messages[result.error]) || result.error || '操作失败，请同步状态后重试。',
    );
    if (!result.ok && result.error === 'draft-conflict') this.sync(true);
    else this.scheduleDraft();
  }
  private finishRequest(ok: boolean, errorCode: string, error: string) {
    const pending = this.pendingRequest;
    if (!pending) return;
    clearTimeout(this.resultTimer);
    this.resultTimer = undefined;
    this.pendingRequest = null;
    const clearDraft =
      ok &&
      pending.draftRevision === this.draftRevision &&
      pending.sessionId === this.state.snapshot?.sessionId &&
      pending.sessionEpoch === this.state.snapshot.sessionEpoch;
    this.update({
      pending: false,
      pendingAction: null,
      ...(clearDraft ? { draft: '', draftDirty: false } : {}),
      ...(this.state.connected ? { status: this.settledStatus() } : {}),
      error: ok ? null : error,
      errorCode: ok ? null : errorCode,
    });
    this.save();
    pending.resolve?.();
  }
  disconnect = async (): Promise<void> => {
    const socket = this.socket;
    if (socket?.readyState === 1) this.send({ type: 'disconnect' });
    this.active = false;
    this.generation++;
    this.pairAbort?.abort();
    this.pairAbort = null;
    this.clearTimers();
    this.listen(false);
    this.resumeToken = null;
    this.pendingPair = null;
    this.pairToken = null;
    this.pendingRequest?.resolve?.();
    this.pendingRequest = null;
    this.releaseDraft(false);
    this.clearSaved();
    this.socket = null;
    this.update({
      status: 'disconnected',
      snapshot: null,
      connected: false,
      pending: false,
      pendingAction: null,
      pairingCode: null,
      canResume: false,
      hasPairingLink: false,
      error: null,
      errorCode: null,
    });
    if (!socket) return;
    socket.onopen = socket.onerror = null;
    await new Promise<void>((resolve) => {
      const finish = () => {
        clearTimeout(timer);
        socket.onmessage = socket.onclose = null;
        socket.close();
        resolve();
      };
      const timer = setTimeout(finish, 1000);
      socket.onmessage = (event) => {
        try {
          if (JSON.parse(String(event.data)).type === 'disconnected') finish();
        } catch {
          /* Wait for close. */
        }
      };
      socket.onclose = finish;
    });
  };
  dispose = () => {
    this.active = false;
    this.generation++;
    this.pairAbort?.abort();
    this.pairAbort = null;
    this.save();
    this.stopSocket();
    this.clearTimers();
    if (typeof window !== 'undefined') this.listen(false);
    this.pendingRequest?.resolve?.();
    if (this.pendingRequest) this.pendingRequest.resolve = undefined;
    this.draftRequest?.resolve?.(false);
    if (this.draftRequest) this.draftRequest.resolve = undefined;
    this.update({ connected: false });
  };
}

export const createMobileConnection = () => new MobileConnection();
