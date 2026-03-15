import { resolve } from "node:path";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import type { MmwaveConfig } from "../config.js";
import { AreaLabelStore } from "./areaLabelStore.js";
import { MqttStudioBridge } from "./mqttBridge.js";
import { FileProfileStore } from "./profileStore.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const IDLE_SHUTDOWN_MS = 30_000;

export class LazyMmwaveBridge {
  private bridge: MqttStudioBridge | null = null;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private activating: Promise<MqttStudioBridge> | null = null;

  readonly profileStore: FileProfileStore;
  readonly areaLabelStore: AreaLabelStore;
  private readonly config: MmwaveConfig;
  private areaLabelStoreLoaded = false;

  constructor(config: MmwaveConfig) {
    this.config = config;
    this.profileStore = new FileProfileStore(resolve(__dirname, "../../../data/mmwave-profiles.json"));
    this.areaLabelStore = new AreaLabelStore(resolve(__dirname, "../../../data/mmwave-area-labels.json"));
  }

  get running(): boolean {
    return this.bridge !== null;
  }

  async activate(): Promise<MqttStudioBridge> {
    this.clearIdleTimer();
    if (this.bridge) {
      return this.bridge;
    }
    if (this.activating) {
      return this.activating;
    }
    this.activating = this.doActivate();
    try {
      const bridge = await this.activating;
      return bridge;
    } finally {
      // Only clear if doActivate set this.bridge; otherwise a concurrent
      // caller that arrives after this finally would start a duplicate.
      if (this.bridge) {
        this.activating = null;
      }
    }
  }

  private async doActivate(): Promise<MqttStudioBridge> {
    if (!this.areaLabelStoreLoaded) {
      await this.areaLabelStore.load();
      this.areaLabelStoreLoaded = true;
    }
    this.bridge = new MqttStudioBridge(this.config, this.areaLabelStore);
    this.bridge.start();
    return this.bridge;
  }

  async deactivate(): Promise<void> {
    this.clearIdleTimer();
    if (this.activating) {
      await this.activating;
    }
    if (!this.bridge) {
      return;
    }
    await this.bridge.stop();
    this.bridge = null;
  }

  getBridge(): MqttStudioBridge | null {
    return this.bridge;
  }

  scheduleIdleShutdown(): void {
    this.clearIdleTimer();
    if (!this.bridge) {
      return;
    }
    if (this.bridge.socketCount > 0) {
      return;
    }
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null;
      if (this.bridge && this.bridge.socketCount === 0) {
        void this.deactivate();
      }
    }, IDLE_SHUTDOWN_MS);
  }

  private clearIdleTimer(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
  }
}
