import { type Logger, NULL_LOGGER } from '../logger';
import { CTSError } from '../model/Errors';
import { type JsonRpcMessage, type JsonRpcReqParams, type RpcSubId } from '../model/types';
import { JSONInt } from '../utils/JSONInt';
import { MAX_WS_QUEUED_MESSAGES } from '../utils/limits';
import { generateUuidV7 } from '../utils/uuid.js';

import { getWebSocketImpl } from './ws';

// RFC 6455 7.4.1: reported locally when a connection drops without a Close frame.
const WS_ABNORMAL_CLOSURE = 1006;
// Longest a keepalive probe waits for its reply; a shorter interval caps it further.
const WS_KEEPALIVE_TIMEOUT_MS = 10_000;

/**
 * The close notification handed to `onClose`: the `CloseEvent` fields the library reads, so Node
 * consumers need no DOM lib.
 */
export type WSCloseEvent = { code: number; reason: string; wasClean: boolean };

class MessageNode {
  value: string;
  next: MessageNode | null = null;
  constructor(message: string) {
    this.value = message;
  }
}

/**
 * Simple FIFO string queue backed by a singly-linked list.
 */
export class MessageQueue {
  private _first: MessageNode | null = null;
  private _last: MessageNode | null = null;
  size = 0;

  enqueue(message: string): boolean {
    const node = new MessageNode(message);
    if (this._last) {
      this._last.next = node;
    } else {
      this._first = node;
    }
    this._last = node;
    this.size++;
    return true;
  }

  dequeue(): string | null {
    if (!this._first) return null;
    const node = this._first;
    this._first = node.next;
    if (!this._first) this._last = null;
    this.size--;
    return node.value;
  }
}

// Internal interface for RPC listeners
interface RpcListener {
  callback: () => void;
  errorCallback: (e: Error) => void;
  subId?: string;
}

// Internal interface for subscription listeners; errorCallback fires when the socket drops them.
interface SubListener {
  callback: (payload: unknown) => void;
  errorCallback?: (e: Error) => void;
}

type OnOpenSuccess = () => void;
type OnOpenError = (err: Error) => void;

export class WSConnection {
  public readonly url: URL;
  private readonly _WS: typeof WebSocket;
  private ws: WebSocket | undefined;
  private connectionPromise: Promise<void> | undefined;
  private subListeners: { [subId: string]: SubListener[] } = {};
  private rpcListeners: { [rpcSubId: string]: RpcListener } = {};
  private messageQueue: MessageQueue;
  private handlingInterval?: ReturnType<typeof setInterval>;
  // Set while a connect is pending so close() can settle it and drop its timer.
  private abandonConnect?: (err: Error) => void;
  private rpcId = 0;
  private _logger: Logger;
  private onCloseCallbacks: Array<(e: WSCloseEvent) => void> = [];
  private readonly keepaliveMs?: number;
  private keepaliveTimer?: ReturnType<typeof setInterval>;
  private probeTimer?: ReturnType<typeof setTimeout>;

  /**
   * @param options `keepaliveMs` probes the mint at that interval with a JSON-RPC request it must
   *   answer; no reply within the interval (10 s at most) drops the socket as an abnormal close.
   */
  constructor(url: string, logger?: Logger, options?: { keepaliveMs?: number }) {
    this._WS = getWebSocketImpl();
    this.url = new URL(url);
    this.messageQueue = new MessageQueue();
    this._logger = logger ?? NULL_LOGGER;
    if (options?.keepaliveMs !== undefined) {
      if (
        !Number.isFinite(options.keepaliveMs) ||
        options.keepaliveMs < 1 ||
        options.keepaliveMs > 2_147_483_647
      ) {
        throw new CTSError('keepaliveMs must be a finite number between 1 and 2147483647');
      }
      this.keepaliveMs = options.keepaliveMs;
    }
  }

  setLogger(logger: Logger) {
    this._logger = logger;
  }

  connect(timeoutMs = 10_000): Promise<void> {
    if (this.connectionPromise) return this.connectionPromise;

    this.connectionPromise = new Promise((resolve: OnOpenSuccess, reject: OnOpenError) => {
      let opened = false;
      let settled = false;
      let timer: ReturnType<typeof setTimeout> | null = null;

      const settle = (fn: () => void) => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        this.abandonConnect = undefined;
        fn();
      };
      this.abandonConnect = (err: Error) => settle(() => reject(err));

      const cleanupSocket = (err: Error) => {
        if (!this.ws) return;
        try {
          this.ws.onopen = null;
          this.ws.onerror = null;
          this.ws.onmessage = null;
          this.ws.onclose = null;
        } catch {
          // silence
        }
        try {
          this.ws.close();
        } catch {
          // silence
        }
        this.ws = undefined;
        this.stopMessageHandling(err);
      };

      const fail = (e: unknown) => {
        this.connectionPromise = undefined;
        const err = e instanceof Error ? e : new CTSError(String(e), { cause: e });
        cleanupSocket(err);
        this.failPendingRpc(err);
        settle(() => reject(err));
      };

      let socket: WebSocket;
      try {
        socket = new this._WS(this.url.toString());
        this.ws = socket;
      } catch (e) {
        fail(e);
        return;
      }

      // A later connect() replaces this.ws with a new socket. This socket's own events must then
      // no-op rather than mutate the replacement's shared state.
      const isCurrent = () => this.ws === socket;

      timer = setTimeout(() => {
        fail(new CTSError(`WebSocket connect timeout after ${timeoutMs}ms`));
      }, timeoutMs);

      socket.onopen = () => {
        if (!isCurrent()) return;
        opened = true;
        settle(resolve);
        this.armKeepalive();
      };

      socket.onerror = (ev) => {
        if (!isCurrent()) return;
        if (!opened) {
          fail(new CTSError('Failed to open WebSocket'));
          return;
        }
        this._logger.error('WebSocket error after open', { ev });
        // do not call fail(), onclose will follow in most implementations
      };

      socket.onmessage = (e: MessageEvent) => {
        if (!isCurrent()) return;
        if (this.messageQueue.size >= MAX_WS_QUEUED_MESSAGES) {
          this._logger.error('WebSocket message queue exceeded its bound, closing connection', {
            size: this.messageQueue.size,
          });
          this.dropSocket(new CTSError('WebSocket message queue exceeded its bound'));
          return;
        }
        this.messageQueue.enqueue(e.data as string);
        if (!this.handlingInterval) {
          this.handlingInterval = setInterval(this.handleNextMessage.bind(this), 0);
        }
      };

      socket.onclose = (e: WSCloseEvent) => {
        // Bail only if a replacement socket is now current. this.ws === undefined (explicit close,
        // no reconnect) still runs teardown so onClose subscribers are notified.
        if (this.ws && this.ws !== socket) return;
        this.connectionPromise = undefined;

        if (!opened) {
          const reason = e?.reason ? `, ${e.reason}` : '';
          fail(new CTSError(`WebSocket closed before open (code ${e?.code ?? 0}${reason})`));
          return;
        }

        const reason = e?.reason ? `, ${e.reason}` : '';
        const code = e?.code ?? 0;
        const wasClean = typeof e.wasClean === 'boolean' ? e.wasClean : true;
        const err = new CTSError(`WebSocket closed (code ${code}${reason})`);

        // Every subscription on this socket is gone whatever the close code (1001 is a mint
        // restart), so each owner is told. In-flight acks keep the old rule: errored on an
        // abnormal close, cleared quietly on a clean one.
        this.stopMessageHandling(err);

        const abnormal = !wasClean || (code !== 1000 && code !== 1001);
        if (abnormal) {
          this.failPendingRpc(err);
        } else {
          this.rpcListeners = {};
        }

        this.onCloseCallbacks.forEach((cb) => cb(e));
      };
    });

    return this.connectionPromise;
  }

  sendRequest(method: 'subscribe', params: JsonRpcReqParams): void;
  sendRequest(method: 'unsubscribe', params: { subId: string }): void;
  sendRequest(method: 'subscribe' | 'unsubscribe', params: Partial<JsonRpcReqParams>): void {
    if (this.ws?.readyState !== this._WS.OPEN) {
      if (method === 'unsubscribe') {
        return;
      }
      this._logger.error('Attempted sendRequest, but socket was not open');
      throw new CTSError('Socket not open');
    }

    const id = this.rpcId;
    this.rpcId++;
    this.sendRpcMessage(method, params, id);
  }

  addSubListener<TPayload = unknown>(
    subId: string,
    callback: (payload: TPayload) => void,
    errorCallback?: (e: Error) => void,
  ) {
    (this.subListeners[subId] = this.subListeners[subId] || []).push({
      callback: callback as (payload: unknown) => void,
      errorCallback,
    });
  }

  private stopMessageHandling(err: Error) {
    clearInterval(this.keepaliveTimer);
    clearTimeout(this.probeTimer);
    this.keepaliveTimer = this.probeTimer = undefined;
    if (this.handlingInterval) {
      clearInterval(this.handlingInterval);
      this.handlingInterval = undefined;
    }
    // Drain any queued messages so we don't process stale frames after teardown.
    while (this.messageQueue.size > 0) {
      this.messageQueue.dequeue();
    }
    // Subscriptions are scoped to the connection being torn down, explicit or remote: a mint
    // replaying an old subId after a reconnect must not reach a stale callback. Each owner hears
    // about the drop, so a watch can resubscribe or fall back rather than wait on a dead socket.
    const listeners = this.subListeners;
    this.subListeners = {};
    for (const subs of Object.values(listeners)) {
      for (const { errorCallback } of subs) {
        try {
          errorCallback?.(err);
        } catch {
          // ignore user error callbacks throwing
        }
      }
    }
  }

  /**
   * Tears the current socket down as if it had closed abnormally: teardown first, callbacks last,
   * so a callback that reconnects or unsubscribes never sees the dying socket as current.
   */
  private dropSocket(err: Error) {
    const socket = this.ws;
    if (!socket) return;
    this.connectionPromise = undefined;
    try {
      socket.onopen = null;
      socket.onerror = null;
      socket.onmessage = null;
      socket.onclose = null;
    } catch {
      // silence
    }
    try {
      socket.close();
    } catch {
      // silence
    }
    this.ws = undefined;
    this.stopMessageHandling(err);
    this.failPendingRpc(err);
    this.onCloseCallbacks.forEach((cb) =>
      cb({ code: WS_ABNORMAL_CLOSURE, reason: err.message, wasClean: false }),
    );
  }

  private armKeepalive() {
    if (!this.keepaliveMs) return;
    clearInterval(this.keepaliveTimer);
    this.keepaliveTimer = setInterval(() => this.probe(), this.keepaliveMs);
  }

  // A JSON-RPC request the mint must answer (result or error): an unsubscribe for a subId that
  // never existed. Silence past the timeout is a half-open socket, which never closes by itself.
  private probe() {
    if (this.probeTimer || !this.keepaliveMs || this.ws?.readyState !== this._WS.OPEN) return;
    const id = this.rpcId;
    this.rpcId++;
    const answered = () => {
      clearTimeout(this.probeTimer);
      this.probeTimer = undefined;
    };
    this.addRpcListener(answered, answered, id);
    const timeoutMs = Math.min(this.keepaliveMs, WS_KEEPALIVE_TIMEOUT_MS);
    this.probeTimer = setTimeout(() => {
      this._logger.warn('WebSocket keepalive probe unanswered, dropping the connection', {
        timeoutMs,
      });
      this.dropSocket(new CTSError(`WebSocket keepalive probe unanswered after ${timeoutMs}ms`));
    }, timeoutMs);
    try {
      this.sendRpcMessage('unsubscribe', { subId: generateUuidV7() }, id);
    } catch {
      // sendRpcMessage already tore the socket down and failed the probe listener
    }
  }

  private failPendingRpc(err: Error) {
    const listeners = this.rpcListeners;
    this.rpcListeners = {};
    for (const key of Object.keys(listeners)) {
      try {
        listeners[key].errorCallback(err);
      } catch {
        // ignore user error callbacks throwing
      }
    }
  }

  private sendRpcMessage(
    method: 'subscribe' | 'unsubscribe',
    params: Partial<JsonRpcReqParams>,
    id: number,
  ): void {
    if (this.ws?.readyState !== this._WS.OPEN) {
      throw new CTSError('Socket not open');
    }

    const message = JSON.stringify({ jsonrpc: '2.0', method, params, id });

    try {
      this.ws.send(message);
    } catch (e) {
      this._logger.error('WebSocket send failed', { e });
      // allow retry
      this.connectionPromise = undefined;

      // Ensure the failed socket is closed and queues are flushed.
      try {
        this.ws.close();
      } catch {
        // silence
      }
      this.ws = undefined;
      const err = e instanceof Error ? e : new CTSError(String(e), { cause: e });
      this.stopMessageHandling(err);
      this.failPendingRpc(err);
      throw err;
    }
  }

  private addRpcListener(
    callback: () => void,
    errorCallback: (e: Error) => void,
    id: Exclude<RpcSubId, null>,
    subId?: string,
  ) {
    this.rpcListeners[id] = { callback, errorCallback, subId };
  }

  private removeRpcListener(id: Exclude<RpcSubId, null>) {
    delete this.rpcListeners[id];
  }

  private removeListener<TPayload = unknown>(subId: string, callback: (payload: TPayload) => void) {
    if (!this.subListeners[subId]) {
      return;
    }
    if (this.subListeners[subId].length === 1) {
      delete this.subListeners[subId];
      return;
    }
    this.subListeners[subId] = this.subListeners[subId].filter(
      (l) => l.callback !== (callback as (payload: unknown) => void),
    );
  }

  async ensureConnection(timeoutMs?: number) {
    if (this.ws?.readyState !== this._WS.OPEN) {
      await this.connect(timeoutMs);
    }
  }

  // Drains the whole queue in one tick rather than one frame per interval fire, so a legitimate
  // burst under the queue cap is delivered promptly; a bad frame is logged and does not stop
  // the rest.
  private handleNextMessage() {
    while (this.messageQueue.size > 0) {
      const message = this.messageQueue.dequeue() as string;

      try {
        // Same bigint-safe, strict parse as the HTTP transport, so a u64 amount is not rounded and
        // a duplicate key cannot pick a different result than an earlier check saw.
        const parsed = JSONInt.parse(message, undefined, { strict: true }) as JsonRpcMessage;

        if ('result' in parsed && parsed.id != undefined) {
          if (this.rpcListeners[parsed.id]) {
            this.rpcListeners[parsed.id].callback();
            this.removeRpcListener(parsed.id);
          }
        } else if ('error' in parsed && parsed.id != undefined) {
          if (this.rpcListeners[parsed.id]) {
            this.rpcListeners[parsed.id].errorCallback(new CTSError(parsed.error.message));
            this.removeRpcListener(parsed.id);
          }
        } else if ('method' in parsed) {
          if ('id' in parsed) {
            // Do nothing as mints should not send requests
          } else {
            const subId = parsed.params?.subId;
            if (!subId) {
              continue;
            }

            if (this.subListeners[subId]?.length > 0) {
              const notification = parsed;
              this.subListeners[subId].forEach(({ callback: cb }) => {
                try {
                  // A callback typed to return void may still be an async function; a returned
                  // thenable's rejection needs the same containment as a synchronous throw. Duck
                  // typed, like safeCallback, so a non-native promise (another realm, a polyfill)
                  // is still caught.
                  const result = cb(notification.params?.payload) as void | PromiseLike<unknown>;
                  if (result && typeof result.then === 'function') {
                    Promise.resolve(result).catch((e: unknown) => {
                      this._logger.error('Subscription handler threw', { e });
                    });
                  }
                } catch (e) {
                  this._logger.error('Subscription handler threw', { e });
                }
              });
            }
          }
        }
      } catch (e) {
        this._logger.error('Error doing handleNextMessage', { e });
      }
    }

    if (this.handlingInterval) {
      clearInterval(this.handlingInterval);
      this.handlingInterval = undefined;
    }
  }

  createSubscription<TPayload = unknown>(
    params: Omit<JsonRpcReqParams, 'subId'>,
    callback: (payload: TPayload) => void,
    errorCallback: (e: Error) => void,
  ): string {
    if (this.ws?.readyState !== this._WS.OPEN) {
      this._logger.error('Attempted createSubscription, but socket was not open');
      throw new CTSError('Socket is not open');
    }

    const subId = generateUuidV7();
    const rpcId = this.rpcId; // this is the id sendRequest will use next
    this.addRpcListener(
      () => {
        this.addSubListener(subId, callback, errorCallback);
      },
      errorCallback,
      rpcId,
      subId,
    );

    try {
      this.sendRequest('subscribe', { ...params, subId });
    } catch (e) {
      this.removeRpcListener(rpcId);
      throw e;
    }

    return subId;
  }

  /**
   * Cancels a subscription, sending an unsubscribe request and handling responses.
   *
   * @param subId The subscription ID to cancel.
   * @param callback The original payload callback to remove.
   * @param errorCallback Optional callback for unsubscribe errors (defaults to logging).
   */
  cancelSubscription<TPayload = unknown>(
    subId: string,
    callback: (payload: TPayload) => void,
    errorCallback?: (e: Error) => void,
  ) {
    // A late subscribe acknowledgement must not reinstall a cancelled listener.
    for (const [id, listener] of Object.entries(this.rpcListeners)) {
      if (listener.subId === subId) this.removeRpcListener(id);
    }
    this.removeListener(subId, callback);

    if (this.ws?.readyState !== this._WS.OPEN) {
      this._logger.info('Socket not open, removed listener locally {subId}', { subId });
      return;
    }

    const id = this.rpcId;
    this.rpcId++;

    this.addRpcListener(
      () => {
        this._logger.info('Unsubscribed {subId}', { subId });
      },
      // Not actionable: the subscription is gone either way, and a close() races these RPCs
      errorCallback || ((e: Error) => this._logger.info('Unsubscribe failed', { e })),
      id,
    );

    try {
      this.sendRpcMessage('unsubscribe', { subId }, id);
    } catch (e) {
      this.removeRpcListener(id);
      throw e;
    }
  }

  get activeSubscriptions() {
    return Object.keys(this.subListeners);
  }

  close() {
    const err = new CTSError('WebSocket closed');
    // A connect still pending settles now rather than when its timer fires.
    this.abandonConnect?.(err);
    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        // silence
      }
      this.ws = undefined;
    }
    this.connectionPromise = undefined;
    this.failPendingRpc(err);
    this.stopMessageHandling(err);
  }

  /**
   * Registers a socket-close callback and returns a function that removes it.
   */
  onClose(callback: (e: WSCloseEvent) => void) {
    this.onCloseCallbacks.push(callback);
    return () => {
      this.onCloseCallbacks = this.onCloseCallbacks.filter((cb) => cb !== callback);
    };
  }
}
