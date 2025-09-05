import { type JsonRpcReqParams } from './model/types';
import { type Logger } from './logger';
export declare class ConnectionManager {
    private static instance;
    private connectionMap;
    static getInstance(): ConnectionManager;
    getConnection(url: string, logger?: Logger): WSConnection;
}
export declare class WSConnection {
    readonly url: URL;
    private readonly _WS;
    private ws;
    private connectionPromise;
    private subListeners;
    private rpcListeners;
    private messageQueue;
    private handlingInterval?;
    private rpcId;
    private _logger;
    private onCloseCallbacks;
    constructor(url: string, logger?: Logger);
    connect(): Promise<void>;
    sendRequest(method: 'subscribe', params: JsonRpcReqParams): void;
    sendRequest(method: 'unsubscribe', params: {
        subId: string;
    }): void;
    /**
     * @deprecated Use cancelSubscription for JSONRPC compliance.
     */
    closeSubscription(subId: string): void;
    addSubListener<TPayload = unknown>(subId: string, callback: (payload: TPayload) => void): void;
    private addRpcListener;
    private removeRpcListener;
    private removeListener;
    ensureConnection(): Promise<void>;
    private handleNextMessage;
    createSubscription<TPayload = unknown>(params: Omit<JsonRpcReqParams, 'subId'>, callback: (payload: TPayload) => void, errorCallback: (e: Error) => void): string;
    /**
     * Cancels a subscription, sending an unsubscribe request and handling responses.
     *
     * @param subId The subscription ID to cancel.
     * @param callback The original payload callback to remove.
     * @param errorCallback Optional callback for unsubscribe errors (defaults to logging).
     */
    cancelSubscription<TPayload = unknown>(subId: string, callback: (payload: TPayload) => void, errorCallback?: (e: Error) => void): void;
    get activeSubscriptions(): string[];
    close(): void;
    onClose(callback: (e: CloseEvent) => void): void;
}
