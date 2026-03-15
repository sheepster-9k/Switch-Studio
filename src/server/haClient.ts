import WebSocket from "ws";

import type { StudioConfig } from "./config.js";

interface PendingRequest<T> {
  reject: (error: Error) => void;
  resolve: (value: T) => void;
  timer: NodeJS.Timeout;
}

interface ResultMessage<T> {
  id: number;
  success: boolean;
  result?: T;
  error?: {
    code?: string | number;
    message?: string;
  };
  type?: string;
}

function toWsUrl(baseUrl: string): string {
  if (baseUrl.startsWith("https://")) {
    return `${baseUrl.replace("https://", "wss://")}/api/websocket`;
  }
  if (baseUrl.startsWith("http://")) {
    return `${baseUrl.replace("http://", "ws://")}/api/websocket`;
  }
  return `${baseUrl}/api/websocket`;
}

export class HomeAssistantClient {
  private readonly config: StudioConfig;
  private connectingSocket: WebSocket | null = null;
  private connectPromise: Promise<void> | null = null;
  private messageId = 1;
  private pending = new Map<number, PendingRequest<unknown>>();
  private socket: WebSocket | null = null;

  constructor(config: StudioConfig) {
    this.config = config;
  }

  get hasToken(): boolean {
    return Boolean(this.config.haToken);
  }

  get baseUrl(): string {
    return this.config.haBaseUrl;
  }

  async call<T>(message: Record<string, unknown>): Promise<T> {
    if (!this.config.haToken) {
      throw new Error("HA_TOKEN is not configured");
    }

    await this.connect();
    const socket = this.socket;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      throw new Error("Home Assistant websocket is not connected");
    }

    const id = this.messageId++;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Home Assistant request timed out for message ${id}`));
      }, this.config.requestTimeoutMs);

      this.pending.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
        timer
      });
      try {
        socket.send(JSON.stringify({ id, ...message }));
      } catch (sendError) {
        this.pending.delete(id);
        clearTimeout(timer);
        reject(sendError instanceof Error ? sendError : new Error(String(sendError)));
      }
    });
  }

  async callService(
    domain: string,
    service: string,
    serviceData?: Record<string, unknown>,
    target?: Record<string, unknown>
  ): Promise<void> {
    await this.call({
      type: "call_service",
      domain,
      service,
      ...(serviceData ? { service_data: serviceData } : {}),
      ...(target ? { target } : {})
    });
  }

  async updateDeviceArea(deviceId: string, areaId: string | null): Promise<void> {
    await this.call({
      type: "config/device_registry/update",
      device_id: deviceId,
      area_id: areaId
    });
  }

  async updateEntityArea(entityId: string, areaId: string | null): Promise<void> {
    await this.call({
      type: "config/entity_registry/update",
      entity_id: entityId,
      area_id: areaId
    });
  }

  close(): void {
    const socket = this.socket;
    const connectingSocket = this.connectingSocket;
    this.socket = null;
    this.connectingSocket = null;
    this.connectPromise = null;
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.close();
    }
    if (connectingSocket && connectingSocket !== socket) {
      connectingSocket.removeAllListeners();
      connectingSocket.close();
    }
    for (const [id, pending] of this.pending.entries()) {
      clearTimeout(pending.timer);
      pending.reject(new Error("Home Assistant websocket closed"));
      this.pending.delete(id);
    }
  }

  async fetch(path: string, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers);
    if (this.config.haToken) {
      headers.set("Authorization", `Bearer ${this.config.haToken}`);
    }
    return fetch(`${this.config.haBaseUrl}${path}`, { ...init, headers });
  }

  private async connect(): Promise<void> {
    if (this.socket?.readyState === WebSocket.OPEN) {
      return;
    }
    if (this.connectPromise) {
      return this.connectPromise;
    }

    if (!this.config.haToken) {
      throw new Error("HA_TOKEN is not configured");
    }

    this.connectPromise = new Promise<void>((resolve, reject) => {
      const socket = new WebSocket(toWsUrl(this.config.haBaseUrl));
      this.connectingSocket = socket;
      let authenticated = false;

      const rejectPending = (error: Error) => {
        for (const [id, pending] of this.pending.entries()) {
          clearTimeout(pending.timer);
          pending.reject(error);
          this.pending.delete(id);
        }
      };

      const cleanup = () => {
        socket.removeAllListeners();
        if (this.connectingSocket === socket) {
          this.connectingSocket = null;
        }
        if (this.socket === socket && socket.readyState !== WebSocket.OPEN) {
          this.socket = null;
        }
        this.connectPromise = null;
      };

      socket.on("message", (payload) => {
        try {
          const message = JSON.parse(payload.toString()) as Record<string, unknown>;
          if (message.type === "auth_required") {
            socket.send(JSON.stringify({ type: "auth", access_token: this.config.haToken }));
            return;
          }
          if (message.type === "auth_ok") {
            authenticated = true;
            this.socket = socket;
            this.connectingSocket = null;
            resolve();
            return;
          }
          if (message.type === "auth_invalid") {
            const error = new Error("Home Assistant rejected HA_TOKEN");
            reject(error);
            socket.close();
            return;
          }

          if (typeof message.id === "number") {
            const pending = this.pending.get(message.id);
            if (!pending) {
              return;
            }
            this.pending.delete(message.id);
            clearTimeout(pending.timer);

            const resultMessage = message as unknown as ResultMessage<unknown>;
            if (resultMessage.success) {
              pending.resolve(resultMessage.result);
            } else {
              pending.reject(
                new Error(resultMessage.error?.message ?? `Home Assistant request ${message.id} failed`)
              );
            }
          }
        } catch (error) {
          const err = error instanceof Error ? error : new Error(String(error));
          if (!authenticated) {
            reject(err);
          }
        }
      });

      socket.on("error", (error) => {
        const err = error instanceof Error ? error : new Error(String(error));
        if (!authenticated) {
          reject(err);
        }
        rejectPending(err);
      });

      socket.on("close", () => {
        if (!authenticated) {
          reject(new Error("Home Assistant websocket closed before authentication"));
        }
        cleanup();
        rejectPending(new Error("Home Assistant websocket closed"));
      });
    });

    return this.connectPromise;
  }
}
