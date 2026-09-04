import { type Logger, NULL_LOGGER } from '../logger';
import { CTSError, WsAuthError, WsRpcError } from '../model/Errors';
import { type JsonRpcMessage, type JsonRpcReqParams, type RpcSubId } from '../model/types';
import { generateUuidV7 } from '../utils/uuid.js';

import { getWebSocketImpl } from './ws';

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
  callback: (result: unknown) => void;
  errorCallback: (e: Error) => void;
}

type OnOpenSuccess = () => void;
type OnOpenError = (err: Error) => void;

/**
 * Consecutive failed `authenticate` attempts tolerated before a connection stops trying.
 *
 * @remarks
 * A blind auth token is spent the moment it leaves the pool, so a mint that keeps rejecting would
 * drain the wallet one reconnect at a time without this bound.
 */
const MAX_CONSECUTIVE_AUTH_FAILURES = 3;

export class WSConnection {
  public readonly url: URL;
  private readonly _WS: typeof WebSocket;
  private ws: WebSocket | undefined;
  private connectionPromise: Promise<void> | undefined;
  private subListeners: { [subId: string]: Array<(payload: unknown) => void> } = {};
  private rpcListeners: { [rpcSubId: string]: RpcListener } = {};
  private messageQueue: MessageQueue;
  private handlingInterval?: ReturnType<typeof setInterval>;
  private rpcId = 0;
  private _logger: Logger;
  private onCloseCallbacks: Array<(e: CloseEvent) => void> = [];
  private readonly getAuthToken?: () => Promise<string | undefined>;
  /**
   * Keyed on the socket so a reconnect re-authenticates with no teardown bookkeeping: a new socket
   * is a different object, so the cache misses.
   */
  private authState?: { socket: WebSocket; promise: Promise<void> };
  private consecutiveAuthFailures = 0;
  /**
   * Fails an in-flight `authenticate` when the socket closes.
   *
   * @remarks
   * A clean close clears the pending RPC listeners without failing them, so without this the
   * attempt would wait out its whole timeout instead of failing at once.
   */
  private abortPendingAuth?: (e: Error) => void;

  /**
   * @param getAuthToken Supplies the NUT-21/22 token for the in-band `authenticate` command. It
   *   must return `undefined` when the mint does not protect `/v1/ws`, decided from mint info
   *   without consuming a token, so a connection that never subscribes spends nothing.
   */
  constructor(url: string, logger?: Logger, getAuthToken?: () => Promise<string | undefined>) {
    this._WS = getWebSocketImpl();
    this.url = new URL(url);
    this.messageQueue = new MessageQueue();
    this._logger = logger ?? NULL_LOGGER;
    this.getAuthToken = getAuthToken;
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
        fn();
      };

      const cleanupSocket = () => {
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
        this.stopMessageHandling();
      };

      const fail = (e: unknown) => {
        this.connectionPromise = undefined;
        cleanupSocket();
        const err = e instanceof Error ? e : new CTSError(String(e), { cause: e });
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
        this.messageQueue.enqueue(e.data as string);
        if (!this.handlingInterval) {
          this.handlingInterval = setInterval(this.handleNextMessage.bind(this), 0);
        }
      };

      socket.onclose = (e: CloseEvent) => {
        // Bail only if a replacement socket is now current. this.ws === undefined (explicit close,
        // no reconnect) still runs teardown so onClose subscribers are notified.
        if (this.ws && this.ws !== socket) return;
        this.connectionPromise = undefined;

        if (!opened) {
          const reason = e?.reason ? `, ${e.reason}` : '';
          fail(new CTSError(`WebSocket closed before open (code ${e?.code ?? 0}${reason})`));
          return;
        }

        this.stopMessageHandling();

        // If the socket closed unexpectedly, fail any in flight RPC acks.
        // Otherwise just clear them to avoid leaks, but don't spam errors.
        const reason = e?.reason ? `, ${e.reason}` : '';
        const code = e?.code ?? 0;
        const wasClean = typeof e.wasClean === 'boolean' ? e.wasClean : true;

        const abnormal = !wasClean || (code !== 1000 && code !== 1001);
        if (abnormal) {
          this.failPendingRpc(new CTSError(`WebSocket closed (code ${code}${reason})`));
        } else {
          this.rpcListeners = {};
        }

        this.abortPendingAuth?.(
          new CTSError(`WebSocket closed while authenticating (code ${code}${reason})`),
        );

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

  addSubListener<TPayload = unknown>(subId: string, callback: (payload: TPayload) => void) {
    (this.subListeners[subId] = this.subListeners[subId] || []).push(
      callback as (payload: unknown) => void,
    );
  }

  private stopMessageHandling() {
    if (this.handlingInterval) {
      clearInterval(this.handlingInterval);
      this.handlingInterval = undefined;
    }
    // Drain any queued messages so we don't process stale frames after teardown.
    while (this.messageQueue.size > 0) {
      this.messageQueue.dequeue();
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
    method: 'subscribe' | 'unsubscribe' | 'authenticate',
    params: Partial<JsonRpcReqParams> | { token: string },
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
      this.stopMessageHandling();

      const err = e instanceof Error ? e : new CTSError(String(e), { cause: e });
      this.failPendingRpc(err);
      throw err;
    }
  }

  private addRpcListener(
    callback: (result: unknown) => void,
    errorCallback: (e: Error) => void,
    id: Exclude<RpcSubId, null>,
  ) {
    this.rpcListeners[id] = { callback, errorCallback };
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
      (fn) => fn !== (callback as (payload: unknown) => void),
    );
  }

  async ensureConnection(timeoutMs?: number) {
    if (this.ws?.readyState !== this._WS.OPEN) {
      await this.connect(timeoutMs);
    }
  }

  /**
   * Authenticates this connection in-band (NUT-22) when the mint protects `/v1/ws`, once per
   * socket.
   *
   * @remarks
   * Call after {@link WSConnection.ensureConnection} and before the first subscription: the mint
   * answers a subscribe on an unauthenticated connection with error 31001, and this waits for the
   * mint's reply so a rejected token fails here rather than later, once it is already spent.
   * Concurrent callers share one attempt, and a rejection stays cached for the socket, so a single
   * token covers the connection for its lifetime. A no-op when no token supplier was given.
   * @param timeoutMs How long to wait for the mint's reply.
   */
  async ensureAuthenticated(timeoutMs = 10_000): Promise<void> {
    if (!this.getAuthToken) return;

    const timeout = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 10_000;

    const socket = this.ws;
    if (socket?.readyState !== this._WS.OPEN) {
      this._logger.error('Attempted ensureAuthenticated, but socket was not open');
      throw new CTSError('Socket not open');
    }

    if (this.authState?.socket === socket) return this.authState.promise;

    const promise = this.authenticate(timeout);
    this.authState = { socket, promise };
    return promise;
  }

  /**
   * Fetches a token and authenticates, counting the attempt against the failure bound.
   *
   * @remarks
   * A supplier failure is not counted: it throws before a token leaves the pool, so nothing was
   * spent and retrying cannot drain it. Everything after that is counted once, in a single place,
   * because `sendRpcMessage` already fails pending RPCs before rethrowing and a narrower catch
   * would count a send failure twice.
   */
  private async authenticate(timeoutMs: number): Promise<void> {
    if (this.consecutiveAuthFailures >= MAX_CONSECUTIVE_AUTH_FAILURES) {
      throw new WsAuthError(
        `WebSocket authentication gave up after ${MAX_CONSECUTIVE_AUTH_FAILURES} consecutive failures`,
        { terminal: true },
      );
    }

    let token: string | undefined;
    try {
      token = await this.getAuthToken!();
    } catch (e) {
      throw new WsAuthError('Could not obtain a WebSocket auth token', { cause: e });
    }

    if (!token) return;

    try {
      await this.sendAuthenticate(token, timeoutMs);
    } catch (e) {
      this.consecutiveAuthFailures++;
      throw new WsAuthError('WebSocket authentication failed', {
        code: e instanceof WsRpcError ? e.code : undefined,
        terminal: this.consecutiveAuthFailures >= MAX_CONSECUTIVE_AUTH_FAILURES,
        cause: e,
      });
    }

    this.consecutiveAuthFailures = 0;
    this._logger.debug('WebSocket connection authenticated');
  }

  /**
   * Sends the `authenticate` command and resolves on the mint's answer.
   *
   * @remarks
   * The timeout is required for correctness, not just latency: a clean close mid-authenticate
   * clears the pending RPCs without failing them, which would leave this pending forever.
   */
  private sendAuthenticate(token: string, timeoutMs: number): Promise<void> {
    const id = this.rpcId;
    this.rpcId++;

    return new Promise<void>((resolve, reject) => {
      let settled = false;
      let timer: ReturnType<typeof setTimeout> | null = null;

      const settle = (fn: () => void) => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        this.abortPendingAuth = undefined;
        fn();
      };

      timer = setTimeout(() => {
        this.removeRpcListener(id);
        settle(() => reject(new CTSError(`WebSocket authenticate timeout after ${timeoutMs}ms`)));
      }, timeoutMs);

      this.abortPendingAuth = (e: Error) => {
        this.removeRpcListener(id);
        settle(() => reject(e));
      };

      this.addRpcListener(
        (result) => {
          if (isAuthenticateResult(result)) {
            settle(resolve);
            return;
          }
          settle(() =>
            reject(new CTSError('Mint answered authenticate with an unexpected result')),
          );
        },
        (e: Error) => settle(() => reject(e)),
        id,
      );

      try {
        this.sendRpcMessage('authenticate', { token }, id);
      } catch (e) {
        this.removeRpcListener(id);
        settle(() => reject(e instanceof Error ? e : new CTSError(String(e), { cause: e })));
      }
    });
  }

  private handleNextMessage() {
    if (this.messageQueue.size === 0) {
      if (this.handlingInterval) {
        clearInterval(this.handlingInterval);
        this.handlingInterval = undefined;
      }
      return;
    }

    const message = this.messageQueue.dequeue() as string;

    try {
      const parsed = JSON.parse(message) as JsonRpcMessage;

      if ('result' in parsed && parsed.id != undefined) {
        if (this.rpcListeners[parsed.id]) {
          this.rpcListeners[parsed.id].callback(parsed.result);
          this.removeRpcListener(parsed.id);
        }
      } else if ('error' in parsed && parsed.id != undefined) {
        if (this.rpcListeners[parsed.id]) {
          this.rpcListeners[parsed.id].errorCallback(
            new WsRpcError(parsed.error.code, parsed.error.message),
          );
          this.removeRpcListener(parsed.id);
        }
      } else if ('method' in parsed) {
        if ('id' in parsed) {
          // Do nothing as mints should not send requests
        } else {
          const subId = parsed.params?.subId;
          if (!subId) {
            return;
          }

          if (this.subListeners[subId]?.length > 0) {
            const notification = parsed;
            this.subListeners[subId].forEach((cb) => {
              try {
                cb(notification.params?.payload);
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
        this.addSubListener(subId, callback);
      },
      errorCallback,
      rpcId,
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
      errorCallback || ((e: Error) => this._logger.error('Unsubscribe failed', { e })),
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
    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        // silence
      }
      this.ws = undefined;
    }
    this.connectionPromise = undefined;
    this.stopMessageHandling();
  }

  onClose(callback: (e: CloseEvent) => void) {
    this.onCloseCallbacks.push(callback);
  }
}

/**
 * True for a NUT-22 `authenticate` result.
 *
 * @remarks
 * A subscribe result also carries `status: "OK"`, so the absence of `subId` is what tells the two
 * apart. Seeing one on an authenticate id means the mint answered the wrong request.
 */
function isAuthenticateResult(result: unknown): boolean {
  if (typeof result !== 'object' || result === null) return false;
  if ('subId' in result) return false;
  return (result as { status?: unknown }).status === 'OK';
}
