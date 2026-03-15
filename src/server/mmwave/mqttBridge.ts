import { readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import mqtt, { type MqttClient } from "mqtt";

import type {
  AreaCollection,
  AreaKind,
  AreaRect,
  AreaSlot,
  BaseBounds,
  BridgeSummary,
  DeviceAreaLabels,
  DeviceMeta,
  DeviceProfileSettings,
  DeviceSnapshot,
  StudioProfile,
  StudioSnapshot,
  TargetPoint,
  TargetTrail,
  TargetTrackingState,
  UpdateSettingsRequest
} from "../../shared/mmwaveTypes.js";
import { ZERO_AREA, finiteOr, clamp, cloneArea, cloneAreaCollection, isFiniteNumber } from "../../shared/mmwaveUtils.js";
import type { MmwaveConfig } from "../config.js";

type StudioConfig = MmwaveConfig;
import type { AreaLabelStore } from "./areaLabelStore.js";

const AREA_KEYS: Record<AreaKind, string> = {
  detection: "mmwave_detection_areas",
  interference: "mmwave_interference_areas",
  stay: "mmwave_stay_areas"
};

const SETTING_KEYS = {
  roomPreset: "mmWaveRoomSizePreset",
  detectSensitivity: "mmWaveDetectSensitivity",
  detectTrigger: "mmWaveDetectTrigger",
  holdTime: "mmWaveHoldTime",
  stayLife: "mmWaveStayLife",
  targetInfoReport: "mmWaveTargetInfoReport",
  controlWiredDevice: "mmwaveControlWiredDevice",
  defaultLevelLocal: "defaultLevelLocal"
};
const TARGET_POINT_TTL_MS = 5000;
const TARGET_TRACK_HISTORY_LIMIT = 10;
const TARGET_TRACK_MATCH_DISTANCE = 160;
const RUNTIME_CACHE_PATH = resolve(process.cwd(), "data/runtime-cache.json");

interface RuntimeState {
  rawState: Record<string, unknown>;
  availability: string;
  updatedAt: string | null;
  targetPoints: TargetPoint[];
  targetTrails: TargetTrail[];
  targetTelemetryAt: string | null;
  targetTelemetryRaw: Record<string, unknown> | null;
}

interface SocketLike {
  readyState?: number;
  send: (payload: string) => void;
}

function parseJson(payload: Buffer): unknown {
  const raw = payload.toString("utf8");
  const candidates = [raw, raw.replace(/^\uFEFF/, ""), raw.replace(/\0/g, "").replace(/^\uFEFF/, "")];
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate.trim());
    } catch {
      // Try the next normalized form.
    }
  }
  return null;
}

function normalizeAreas(raw: unknown): AreaCollection {
  const source = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return {
    area1: cloneArea(source.area1 as AreaRect | undefined),
    area2: cloneArea(source.area2 as AreaRect | undefined),
    area3: cloneArea(source.area3 as AreaRect | undefined),
    area4: cloneArea(source.area4 as AreaRect | undefined)
  };
}

function pickBoolean(value: unknown): boolean | null {
  if (typeof value === "boolean") {
    return value;
  }
  if (value === "true") {
    return true;
  }
  if (value === "false") {
    return false;
  }
  return null;
}

function nullableNumber(value: unknown): number | null {
  return isFiniteNumber(value) ? value : null;
}

function stringOr(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function normalizeAreaOccupancy(raw: Record<string, unknown>): Record<AreaSlot, boolean | null> {
  return {
    area1: pickBoolean(raw.area1Occupancy ?? raw.mmwave_area1_occupancy),
    area2: pickBoolean(raw.area2Occupancy ?? raw.mmwave_area2_occupancy),
    area3: pickBoolean(raw.area3Occupancy ?? raw.mmwave_area3_occupancy),
    area4: pickBoolean(raw.area4Occupancy ?? raw.mmwave_area4_occupancy)
  };
}

function normalizeBaseBounds(raw: Record<string, unknown>): BaseBounds {
  return {
    width_min: finiteOr(raw.mmWaveWidthMin, -600),
    width_max: finiteOr(raw.mmWaveWidthMax, 600),
    depth_min: finiteOr(raw.mmWaveDepthMin, 0),
    depth_max: finiteOr(raw.mmWaveDepthMax, 600),
    height_min: finiteOr(raw.mmWaveHeightMin, -300),
    height_max: finiteOr(raw.mmWaveHeightMax, 300)
  };
}

function normalizeTargetPoints(raw: Record<string, unknown>): TargetPoint[] {
  const direct = raw.mmwave_target_info ?? raw.targets;
  if (Array.isArray(direct)) {
    return direct
      .filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === "object")
      .map((entry) => ({
        x: finiteOr(entry.x, 0),
        y: finiteOr(entry.y, 0),
        z: typeof entry.z === "number" ? entry.z : undefined,
        id: typeof entry.id === "number" ? entry.id : undefined,
        speed: typeof entry.speed === "number" ? entry.speed : undefined,
        confidence: typeof entry.confidence === "number" ? entry.confidence : undefined,
        label: typeof entry.label === "string" ? entry.label : undefined
      }));
  }
  if (direct && typeof direct === "object") {
    const point = direct as Record<string, unknown>;
    if (typeof point.x === "number" && typeof point.y === "number") {
      return [
        {
          x: point.x,
          y: point.y,
          z: typeof point.z === "number" ? point.z : undefined
        }
      ];
    }
  }
  return [];
}

function readIndexedNumber(record: Record<string, unknown>, base: string, index: number): number | undefined {
  const candidates = [
    `${base}${index}`,
    `${base}_${index}`,
    `target${index}_${base}`,
    `${base}${index - 1}`,
    `${base}_${index - 1}`
  ];
  for (const key of candidates) {
    const value = record[key];
    if (isFiniteNumber(value)) {
      return value;
    }
  }
  return undefined;
}

function normalizeTelemetryTargets(payload: unknown): TargetPoint[] {
  if (Array.isArray(payload)) {
    return payload
      .filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === "object")
      .map((entry) => ({
        x: finiteOr(entry.x, 0),
        y: finiteOr(entry.y, 0),
        z: isFiniteNumber(entry.z) ? entry.z : undefined,
        id: isFiniteNumber(entry.id) ? entry.id : undefined,
        speed: isFiniteNumber(entry.speed) ? entry.speed : isFiniteNumber(entry.dop) ? entry.dop : undefined,
        confidence: isFiniteNumber(entry.confidence) ? entry.confidence : undefined,
        label: typeof entry.label === "string" ? entry.label : undefined
      }))
      .filter((entry) => Number.isFinite(entry.x) && Number.isFinite(entry.y));
  }

  if (!payload || typeof payload !== "object") {
    return [];
  }

  const record = payload as Record<string, unknown>;
  if (Array.isArray(record.targets)) {
    return normalizeTelemetryTargets(record.targets);
  }
  if (record.raw && typeof record.raw === "object") {
    const nested = normalizeTelemetryTargets(record.raw);
    if (nested.length > 0) {
      return nested;
    }
  }
  if (isFiniteNumber(record.x) && isFiniteNumber(record.y)) {
    return [
      {
        x: record.x,
        y: record.y,
        z: isFiniteNumber(record.z) ? record.z : undefined,
        id: isFiniteNumber(record.id) ? record.id : undefined,
        speed: isFiniteNumber(record.speed) ? record.speed : isFiniteNumber(record.dop) ? record.dop : undefined
      }
    ];
  }

  const count = isFiniteNumber(record.target_count)
    ? record.target_count
    : isFiniteNumber(record.target_num)
      ? record.target_num
      : isFiniteNumber(record.targetNum)
        ? record.targetNum
        : isFiniteNumber(record.count)
          ? record.count
          : 0;

  const targets: TargetPoint[] = [];
  for (let index = 1; index <= count; index += 1) {
    const x = readIndexedNumber(record, "x", index);
    const y = readIndexedNumber(record, "y", index);
    if (x === undefined || y === undefined) {
      continue;
    }
    targets.push({
      x,
      y,
      z: readIndexedNumber(record, "z", index),
      id: readIndexedNumber(record, "id", index),
      speed: readIndexedNumber(record, "speed", index) ?? readIndexedNumber(record, "dop", index),
      label: typeof record[`label${index}`] === "string" ? String(record[`label${index}`]) : undefined
    });
  }
  return targets;
}

function telemetryRaw(payload: unknown): Record<string, unknown> | null {
  if (Array.isArray(payload)) {
    return { targets: payload };
  }
  return payload && typeof payload === "object" && !Array.isArray(payload)
    ? (payload as Record<string, unknown>)
    : null;
}

function normalizeAvailability(payload: Buffer, parsed: unknown): string {
  if (parsed && typeof parsed === "object" && typeof (parsed as Record<string, unknown>).state === "string") {
    return String((parsed as Record<string, unknown>).state);
  }
  return payload.toString("utf8");
}

function targetInfoEnabled(rawState: Record<string, unknown>): boolean {
  return stringOr(rawState.mmWaveTargetInfoReport, "Disable (default)").toLowerCase().includes("enable");
}

function targetTrackingStateFor(
  rawState: Record<string, unknown>,
  runtime: RuntimeState | undefined,
  liveTargetCount: number
): TargetTrackingState {
  if (!targetInfoEnabled(rawState)) {
    return "disabled";
  }
  if (liveTargetCount > 0) {
    return "live";
  }
  return runtime?.targetTelemetryAt ? "armed" : "waiting";
}

function pointDistance(left: TargetPoint, right: TargetPoint): number {
  const deltaX = left.x - right.x;
  const deltaY = left.y - right.y;
  return Math.sqrt(deltaX * deltaX + deltaY * deltaY);
}

function nextAnonTrackId(tracks: TargetTrail[]): number {
  let highest = 0;
  for (const track of tracks) {
    if (!track.key.startsWith("anon:")) {
      continue;
    }
    const numeric = Number(track.key.slice(5));
    if (Number.isFinite(numeric)) {
      highest = Math.max(highest, numeric);
    }
  }
  return highest + 1;
}

function trackLabel(point: TargetPoint, index: number, fallback?: string): string {
  if (typeof point.label === "string" && point.label.trim()) {
    return point.label.trim();
  }
  if (isFiniteNumber(point.id)) {
    return `Target ${point.id}`;
  }
  return fallback ?? `Target ${index + 1}`;
}

function trackKey(point: TargetPoint, index: number, fallback?: string): string {
  if (isFiniteNumber(point.id)) {
    return `id:${point.id}`;
  }
  if (typeof point.label === "string" && point.label.trim()) {
    return `label:${point.label.trim()}`;
  }
  return fallback ?? `anon:${index + 1}`;
}

function mergeTargetTrails(existing: TargetTrail[], nextPoints: TargetPoint[], timestamp: string): TargetTrail[] {
  const activeExisting = existing.filter((trail) => trail.points.length > 0);
  if (nextPoints.length === 0) {
    return activeExisting;
  }

  const nextTrails: TargetTrail[] = [];
  const used = new Set<string>();
  let anonId = nextAnonTrackId(activeExisting);

  for (const [index, point] of nextPoints.entries()) {
    const exactKey = trackKey(point, index);
    let matched = activeExisting.find((trail) => trail.key === exactKey && !used.has(trail.key)) ?? null;

    if (!matched) {
      let bestCandidate: TargetTrail | null = null;
      let bestDistance = Number.POSITIVE_INFINITY;
      for (const trail of activeExisting) {
        if (used.has(trail.key) || trail.points.length === 0) {
          continue;
        }
        const lastPoint = trail.points[trail.points.length - 1];
        const distance = pointDistance(lastPoint, point);
        if (distance < bestDistance && distance <= TARGET_TRACK_MATCH_DISTANCE) {
          bestDistance = distance;
          bestCandidate = trail;
        }
      }
      matched = bestCandidate;
    }

    const fallbackKey = matched?.key ?? `anon:${anonId++}`;
    const key = trackKey(point, index, fallbackKey);
    const priorPoints = matched?.points ?? [];
    nextTrails.push({
      key,
      label: trackLabel(point, index, matched?.label),
      lastSeenAt: timestamp,
      points: [...priorPoints, point].slice(-TARGET_TRACK_HISTORY_LIMIT)
    });
    used.add(matched?.key ?? key);
  }

  return nextTrails;
}

function profileToSettings(profile: StudioProfile): DeviceProfileSettings {
  return {
    roomPreset: profile.settings.roomPreset,
    detectSensitivity: profile.settings.detectSensitivity,
    detectTrigger: profile.settings.detectTrigger,
    holdTime: profile.settings.holdTime,
    stayLife: profile.settings.stayLife,
    targetInfoReport: profile.settings.targetInfoReport,
    controlWiredDevice: profile.settings.controlWiredDevice,
    defaultLevelLocal: profile.settings.defaultLevelLocal,
    baseBounds: { ...profile.settings.baseBounds }
  };
}

function enrichRawState(rawState: Record<string, unknown>, runtime: RuntimeState): Record<string, unknown> {
  return {
    ...rawState,
    ...(runtime.targetPoints.length > 0 ? { mmwave_target_info: runtime.targetPoints } : {}),
    ...(runtime.targetTelemetryAt ? { mmwave_target_info_updated_at: runtime.targetTelemetryAt } : {}),
    ...(runtime.targetTelemetryRaw ? { mmwave_target_info_raw: runtime.targetTelemetryRaw } : {})
  };
}

function buildSnapshot(
  meta: DeviceMeta,
  runtime: RuntimeState | undefined,
  areaLabels: DeviceAreaLabels,
  includeRawState: boolean
): DeviceSnapshot {
  const rawState = runtime?.rawState ?? {};
  const targetPoints =
    runtime?.targetPoints && runtime.targetPoints.length > 0
      ? runtime.targetPoints
      : normalizeTargetPoints(rawState);
  const trackingState = targetTrackingStateFor(rawState, runtime, targetPoints.length);
  const trackingNote =
    trackingState === "live"
      ? runtime?.targetPoints.length
        ? "Live target tracking is active through the studio telemetry lane."
        : "Live target tracking is active from the current Zigbee payload."
      : trackingState === "armed"
        ? "Target tracking is enabled and waiting for the next live target frame."
        : trackingState === "waiting"
          ? "Target tracking is enabled, but the studio has not seen a target frame yet."
          : "Live highlighting is driven by area occupancy until target tracking is enabled.";
  return {
    meta,
    availability: runtime?.availability ?? "unknown",
    updatedAt: runtime?.updatedAt ?? null,
    settings: {
      roomPreset: stringOr(rawState.mmWaveRoomSizePreset, "Custom"),
      detectSensitivity: stringOr(rawState.mmWaveDetectSensitivity, "Medium"),
      detectTrigger: stringOr(rawState.mmWaveDetectTrigger, "Fast (0.2s, default)"),
      holdTime: finiteOr(rawState.mmWaveHoldTime, 30),
      stayLife: finiteOr(rawState.mmWaveStayLife, 300),
      targetInfoReport: stringOr(rawState.mmWaveTargetInfoReport, "Enable"),
      controlWiredDevice: stringOr(rawState.mmwaveControlWiredDevice, "Occupancy (default)"),
      defaultLevelLocal: clamp(finiteOr(rawState.defaultLevelLocal, 255), 1, 255),
      mmwaveVersion: nullableNumber(rawState.mmWaveVersion),
      baseBounds: normalizeBaseBounds(rawState),
      state: stringOr(rawState.state, "UNKNOWN"),
      brightness: nullableNumber(rawState.brightness),
      occupancy: pickBoolean(rawState.occupancy) ?? false,
      illuminance: nullableNumber(rawState.illuminance),
      areaOccupancy: normalizeAreaOccupancy(rawState)
    },
    areas: {
      detection: normalizeAreas(rawState[AREA_KEYS.detection]),
      interference: normalizeAreas(rawState[AREA_KEYS.interference]),
      stay: normalizeAreas(rawState[AREA_KEYS.stay])
    },
    areaLabels,
    supportsTargetDots: targetPoints.length > 0,
    targetPoints,
    targetTrails: runtime?.targetTrails ?? [],
    targetTelemetryAt: runtime?.targetTelemetryAt ?? null,
    targetTrackingState: trackingState,
    notes: [
      "Axes are from the switch looking into the room: negative width is left, positive width is right, and depth increases away from the wall.",
      trackingNote
    ],
    ...(includeRawState && runtime ? { rawState: enrichRawState(rawState, runtime) } : {})
  };
}

function isMmwaveDevice(entry: unknown): entry is Record<string, unknown> {
  return Boolean(entry) && typeof entry === "object" && (entry as Record<string, unknown>).definition !== undefined;
}

function toMeta(entry: Record<string, unknown>): DeviceMeta | null {
  const definition = entry.definition;
  if (!definition || typeof definition !== "object") {
    return null;
  }
  const definitionRecord = definition as Record<string, unknown>;
  if (definitionRecord.model !== "VZM32-SN") {
    return null;
  }
  return {
    friendlyName: String(entry.friendly_name ?? ""),
    ieeeAddress: String(entry.ieee_address ?? ""),
    model: String(definitionRecord.model ?? "VZM32-SN"),
    vendor: String(definitionRecord.vendor ?? "Inovelli"),
    description: String(definitionRecord.description ?? "mmWave Zigbee Dimmer")
  };
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export class MqttStudioBridge {
  private readonly client: MqttClient;
  private readonly config: StudioConfig;
  private readonly sockets = new Set<SocketLike>();
  private readonly metas = new Map<string, DeviceMeta>();
  private readonly runtime = new Map<string, RuntimeState>();
  private readonly targetExpiryTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly bridge: BridgeSummary;
  private readonly areaLabelStore: AreaLabelStore;
  private cacheWriteTimer: ReturnType<typeof setTimeout> | null = null;
  private metasHydrated = false;
  private readonly pendingHydrations = new Set<string>();

  constructor(config: StudioConfig, areaLabelStore: AreaLabelStore) {
    this.config = config;
    this.areaLabelStore = areaLabelStore;
    this.bridge = {
      connected: false,
      brokerUrl: config.mqttUrl,
      baseTopic: config.baseTopic,
      connectedAt: null,
      lastMessageAt: null,
      z2mBridgeState: null,
      lastError: null
    };
    this.loadRuntimeCache();
    this.client = mqtt.connect(config.mqttUrl, {
      username: config.mqttUser,
      password: config.mqttPassword,
      reconnectPeriod: 2000,
      keepalive: 30,
      manualConnect: true
    });
  }

  start(): void {
    this.client.on("connect", () => {
      this.bridge.connected = true;
      this.bridge.connectedAt = new Date().toISOString();
      this.bridge.lastError = null;
      this.subscribe();
      this.broadcast({ type: "bridge_update", bridge: this.bridge });
    });

    this.client.on("error", (error) => {
      this.bridge.lastError = error.message;
      this.broadcast({ type: "bridge_update", bridge: this.bridge });
    });

    this.client.on("reconnect", () => {
      this.bridge.connected = false;
      this.broadcast({ type: "bridge_update", bridge: this.bridge });
    });

    this.client.on("close", () => {
      this.bridge.connected = false;
      this.broadcast({ type: "bridge_update", bridge: this.bridge });
    });

    this.client.on("message", (topic, payload) => {
      this.handleMessage(topic, payload);
    });

    this.client.connect();
  }

  private subscribe(): void {
    const topics = [
      `${this.config.baseTopic}/bridge/devices`,
      `${this.config.baseTopic}/bridge/state`,
      `${this.config.baseTopic}/_mmwave_studio/+/target_info`,
      `${this.config.baseTopic}/+`,
      `${this.config.baseTopic}/+/availability`
    ];
    for (const topic of topics) {
      this.client.subscribe(topic, (error) => {
        if (error) {
          this.bridge.lastError = `subscribe ${topic}: ${error.message}`;
          this.broadcast({ type: "bridge_update", bridge: this.bridge });
        }
      });
    }
  }

  private emptyRuntimeState(): RuntimeState {
    return {
      rawState: {},
      availability: "unknown",
      updatedAt: null,
      targetPoints: [],
      targetTrails: [],
      targetTelemetryAt: null,
      targetTelemetryRaw: null
    };
  }

  private trackedDeviceNames(): string[] {
    return Array.from(this.metas.keys());
  }

  private shouldTrackName(name: string): boolean {
    return this.metasHydrated ? this.metas.has(name) || this.runtime.has(name) : true;
  }

  private pruneUntrackedRuntime(): void {
    const tracked = new Set(this.trackedDeviceNames());
    for (const name of this.runtime.keys()) {
      if (tracked.has(name)) {
        continue;
      }
      this.runtime.delete(name);
      const timer = this.targetExpiryTimers.get(name);
      if (timer) {
        clearTimeout(timer);
        this.targetExpiryTimers.delete(name);
      }
    }
  }

  private needsBootstrapHydration(name: string): boolean {
    const current = this.runtime.get(name);
    return !current || current.updatedAt === null || Object.keys(current.rawState).length === 0;
  }

  private bootstrapHydrateDevices(names: string[]): void {
    let offsetMs = 250;
    for (const name of names) {
      if (this.pendingHydrations.has(name) || !this.needsBootstrapHydration(name)) {
        continue;
      }
      this.pendingHydrations.add(name);
      void (async () => {
        try {
          await wait(offsetMs);
          this.publishDevice(name, { mmwave_control_commands: { controlID: "query_areas" } });
        } finally {
          setTimeout(() => {
            this.pendingHydrations.delete(name);
          }, 5000);
        }
      })();
      offsetMs += 350;
    }
  }

  private handleMessage(topic: string, payload: Buffer): void {
    const now = new Date().toISOString();
    this.bridge.lastMessageAt = now;
    const studioPrefix = `${this.config.baseTopic}/_mmwave_studio/`;
    if (topic.startsWith(studioPrefix)) {
      const remainder = topic.slice(studioPrefix.length);
      const slash = remainder.indexOf("/");
      if (slash > 0) {
        const name = decodeURIComponent(remainder.slice(0, slash));
        const leaf = remainder.slice(slash + 1);
        if (leaf === "target_info") {
          if (!this.shouldTrackName(name)) {
            return;
          }
          const parsed = parseJson(payload);
          const targetPoints = normalizeTelemetryTargets(parsed);
          const current = this.runtime.get(name) ?? this.emptyRuntimeState();
          current.targetPoints = targetPoints;
          current.targetTrails = mergeTargetTrails(current.targetTrails, targetPoints, now);
          current.targetTelemetryAt = now;
          current.targetTelemetryRaw = telemetryRaw(parsed);
          current.updatedAt = now;
          this.runtime.set(name, current);
          this.scheduleRuntimeCacheWrite();
          this.scheduleTargetExpiry(name, now);
          this.emitDevice(name);
        }
      }
      return;
    }

    const [, second, third] = topic.split("/");
    const parsed = parseJson(payload);

    if (second === "bridge" && third === "devices" && Array.isArray(parsed)) {
      const nextMetas = new Map<string, DeviceMeta>();
      for (const entry of parsed) {
        if (!isMmwaveDevice(entry)) {
          continue;
        }
        const meta = toMeta(entry);
        if (!meta) {
          continue;
        }
        nextMetas.set(meta.friendlyName, meta);
      }
      this.metas.clear();
      for (const [name, meta] of nextMetas.entries()) {
        this.metas.set(name, meta);
        if (!this.runtime.has(name)) {
          this.runtime.set(name, this.emptyRuntimeState());
        }
      }
      this.metasHydrated = true;
      this.pruneUntrackedRuntime();
      this.scheduleRuntimeCacheWrite();
      this.broadcast({ type: "snapshot", snapshot: this.getSnapshot() });
      this.bootstrapHydrateDevices(Array.from(nextMetas.keys()));
      return;
    }

    if (second === "bridge" && third === "state") {
      if (parsed && typeof parsed === "object" && typeof (parsed as Record<string, unknown>).state === "string") {
        this.bridge.z2mBridgeState = String((parsed as Record<string, unknown>).state);
      } else {
        this.bridge.z2mBridgeState = payload.toString("utf8");
      }
      this.broadcast({ type: "bridge_update", bridge: this.bridge });
      return;
    }

    if (!second) {
      return;
    }

    const name = second;
    if (!this.shouldTrackName(name)) {
      return;
    }
    const current = this.runtime.get(name) ?? this.emptyRuntimeState();

    if (third === "availability") {
      current.availability = normalizeAvailability(payload, parsed);
      current.updatedAt = now;
      this.runtime.set(name, current);
      this.scheduleRuntimeCacheWrite();
      this.emitDevice(name);
      return;
    }

    if (third === undefined && parsed && typeof parsed === "object") {
      current.rawState = parsed as Record<string, unknown>;
      if (current.availability === "unknown") {
        current.availability = "online";
      }
      current.updatedAt = now;
      this.runtime.set(name, current);
      this.scheduleRuntimeCacheWrite();
      this.emitDevice(name);
    }
  }

  private emitDevice(name: string): void {
    const snapshot = this.getDevice(name);
    if (snapshot) {
      this.broadcast({ type: "device_update", device: snapshot });
    }
  }

  private scheduleTargetExpiry(name: string, telemetryAt: string): void {
    const existing = this.targetExpiryTimers.get(name);
    if (existing) {
      clearTimeout(existing);
    }
    const timer = setTimeout(() => {
      const current = this.runtime.get(name);
      if (!current || current.targetTelemetryAt !== telemetryAt || current.targetPoints.length === 0) {
        return;
      }
      current.targetPoints = [];
      current.targetTelemetryRaw = null;
      current.targetTrails = [];
      this.runtime.set(name, current);
      this.targetExpiryTimers.delete(name);
      this.scheduleRuntimeCacheWrite();
      this.emitDevice(name);
    }, TARGET_POINT_TTL_MS);
    this.targetExpiryTimers.set(name, timer);
  }

  private loadRuntimeCache(): void {
    try {
      const raw = JSON.parse(readFileSync(RUNTIME_CACHE_PATH, "utf8")) as Record<string, RuntimeState>;
      for (const [name, state] of Object.entries(raw)) {
        if (!state || typeof state !== "object") {
          continue;
        }
        this.runtime.set(name, {
          rawState: state.rawState && typeof state.rawState === "object" ? state.rawState : {},
          availability: typeof state.availability === "string" ? state.availability : "unknown",
          updatedAt: typeof state.updatedAt === "string" ? state.updatedAt : null,
          targetPoints: [],
          targetTrails: [],
          targetTelemetryAt: null,
          targetTelemetryRaw: null
        });
      }
    } catch {
      // Ignore corrupt cache and rebuild it from live MQTT traffic.
    }
  }

  private scheduleRuntimeCacheWrite(): void {
    if (this.cacheWriteTimer) {
      return;
    }
    this.cacheWriteTimer = setTimeout(() => {
      this.cacheWriteTimer = null;
      void this.writeRuntimeCache();
    }, 2000);
  }

  private async writeRuntimeCache(): Promise<void> {
    try {
      await mkdir(dirname(RUNTIME_CACHE_PATH), { recursive: true });
      await writeFile(
        RUNTIME_CACHE_PATH,
        JSON.stringify(
          Object.fromEntries(
            Array.from(this.runtime.entries(), ([name, state]) => [
              name,
              {
                rawState: state.rawState,
                availability: state.availability,
                updatedAt: state.updatedAt,
                targetPoints: [],
                targetTrails: [],
                targetTelemetryAt: null,
                targetTelemetryRaw: null
              }
            ])
          ),
          null,
          2
        ),
        "utf8"
      );
    } catch {
      // Cache persistence is best-effort and should not break the live bridge.
    }
  }

  getSnapshot(): StudioSnapshot {
    return {
      bridge: { ...this.bridge },
      devices: Array.from(this.metas.values())
        .map((meta) =>
          buildSnapshot(
            meta,
            this.runtime.get(meta.friendlyName),
            this.areaLabelStore.getForDevice(meta.friendlyName),
            false
          )
        )
        .sort((left, right) => left.meta.friendlyName.localeCompare(right.meta.friendlyName))
    };
  }

  getDevice(name: string, includeRawState = false): DeviceSnapshot | null {
    const meta = this.metas.get(name);
    if (!meta) {
      return null;
    }
    return buildSnapshot(meta, this.runtime.get(name), this.areaLabelStore.getForDevice(name), includeRawState);
  }

  getRawState(name: string): Record<string, unknown> | null {
    const runtime = this.runtime.get(name);
    if (!runtime) {
      return null;
    }
    return enrichRawState(runtime.rawState, runtime);
  }

  attachSocket(socket: SocketLike): void {
    this.sockets.add(socket);
    socket.send(JSON.stringify({ type: "snapshot", snapshot: this.getSnapshot() }));
  }

  detachSocket(socket: SocketLike): void {
    this.sockets.delete(socket);
  }

  private broadcast(payload: unknown): void {
    const message = JSON.stringify(payload);
    for (const socket of this.sockets) {
      if (socket.readyState !== undefined && socket.readyState !== 1) {
        continue;
      }
      try {
        socket.send(message);
      } catch {
        this.sockets.delete(socket);
      }
    }
  }

  private publishDevice(name: string, payload: Record<string, unknown>): void {
    this.client.publish(`${this.config.baseTopic}/${name}/set`, JSON.stringify(payload));
  }

  private async publishAreaCollection(
    name: string,
    kind: AreaKind,
    collection: AreaCollection,
    applyInterference = false
  ): Promise<void> {
    this.publishDevice(name, { [AREA_KEYS[kind]]: cloneAreaCollection(collection) });
    if (kind === "interference" && applyInterference) {
      await wait(500);
      this.publishDevice(name, { mmwave_control_commands: { controlID: "set_interference" } });
    }
  }

  async identify(name: string): Promise<DeviceSnapshot | null> {
    this.publishDevice(name, { identify: "identify" });
    await wait(300);
    return this.getDevice(name);
  }

  async queryAreas(name: string): Promise<DeviceSnapshot | null> {
    this.publishDevice(name, { mmwave_control_commands: { controlID: "query_areas" } });
    await wait(1200);
    return this.getDevice(name);
  }

  async resetDetectionAreas(name: string): Promise<DeviceSnapshot | null> {
    this.publishDevice(name, { mmwave_control_commands: { controlID: "reset_detection_area" } });
    await wait(1200);
    return this.getDevice(name);
  }

  async clearInterference(name: string): Promise<DeviceSnapshot | null> {
    this.publishDevice(name, { mmwave_control_commands: { controlID: "clear_interference" } });
    await wait(1200);
    return this.getDevice(name);
  }

  async clearStayAreas(name: string): Promise<DeviceSnapshot | null> {
    this.publishDevice(name, { mmwave_control_commands: { controlID: "clear_stay_areas" } });
    await wait(1200);
    return this.getDevice(name);
  }

  async updateArea(name: string, kind: AreaKind, slot: AreaSlot, area: AreaRect): Promise<DeviceSnapshot | null> {
    const current = this.getDevice(name);
    if (!current) {
      return null;
    }
    const areas: AreaCollection = { ...current.areas[kind], [slot]: cloneArea(area) };
    this.publishDevice(name, { [AREA_KEYS[kind]]: areas });
    if (kind === "interference") {
      await wait(500);
      this.publishDevice(name, { mmwave_control_commands: { controlID: "set_interference" } });
    }
    await wait(900);
    return this.queryAreas(name);
  }

  async updateSettings(name: string, patch: UpdateSettingsRequest): Promise<DeviceSnapshot | null> {
    const payload: Record<string, unknown> = {};
    if (patch.roomPreset !== undefined) {
      payload[SETTING_KEYS.roomPreset] = patch.roomPreset;
    }
    if (patch.detectSensitivity !== undefined) {
      payload[SETTING_KEYS.detectSensitivity] = patch.detectSensitivity;
    }
    if (patch.detectTrigger !== undefined) {
      payload[SETTING_KEYS.detectTrigger] = patch.detectTrigger;
    }
    if (isFiniteNumber(patch.holdTime)) {
      payload[SETTING_KEYS.holdTime] = patch.holdTime;
    }
    if (isFiniteNumber(patch.stayLife)) {
      payload[SETTING_KEYS.stayLife] = patch.stayLife;
    }
    if (patch.targetInfoReport !== undefined) {
      payload[SETTING_KEYS.targetInfoReport] = patch.targetInfoReport;
    }
    if (patch.controlWiredDevice !== undefined) {
      payload[SETTING_KEYS.controlWiredDevice] = patch.controlWiredDevice;
    }
    if (isFiniteNumber(patch.defaultLevelLocal)) {
      payload[SETTING_KEYS.defaultLevelLocal] = clamp(Math.round(patch.defaultLevelLocal), 1, 255);
    }
    if (patch.baseBounds) {
      if (isFiniteNumber(patch.baseBounds.width_min)) {
        payload.mmWaveWidthMin = patch.baseBounds.width_min;
      }
      if (isFiniteNumber(patch.baseBounds.width_max)) {
        payload.mmWaveWidthMax = patch.baseBounds.width_max;
      }
      if (isFiniteNumber(patch.baseBounds.depth_min)) {
        payload.mmWaveDepthMin = patch.baseBounds.depth_min;
      }
      if (isFiniteNumber(patch.baseBounds.depth_max)) {
        payload.mmWaveDepthMax = patch.baseBounds.depth_max;
      }
      if (isFiniteNumber(patch.baseBounds.height_min)) {
        payload.mmWaveHeightMin = patch.baseBounds.height_min;
      }
      if (isFiniteNumber(patch.baseBounds.height_max)) {
        payload.mmWaveHeightMax = patch.baseBounds.height_max;
      }
    }
    if (Object.keys(payload).length === 0) {
      return this.getDevice(name);
    }
    this.publishDevice(name, payload);
    await wait(900);
    return this.getDevice(name);
  }

  async updateAreaLabel(name: string, kind: AreaKind, slot: AreaSlot, label: string): Promise<DeviceSnapshot | null> {
    if (!this.metas.has(name)) {
      return null;
    }
    await this.areaLabelStore.setLabel(name, kind, slot, label);
    const snapshot = this.getDevice(name);
    if (snapshot) {
      this.broadcast({ type: "device_update", device: snapshot });
    }
    return snapshot;
  }

  async applyProfile(name: string, profile: StudioProfile): Promise<DeviceSnapshot | null> {
    if (!this.metas.has(name)) {
      return null;
    }

    await this.updateSettings(name, profileToSettings(profile));
    await Promise.all([
      this.publishAreaCollection(name, "detection", profile.areas.detection),
      this.publishAreaCollection(name, "interference", profile.areas.interference, true),
      this.publishAreaCollection(name, "stay", profile.areas.stay)
    ]);
    await wait(800);
    return this.queryAreas(name);
  }

  get socketCount(): number {
    return this.sockets.size;
  }

  async stop(): Promise<void> {
    for (const timer of this.targetExpiryTimers.values()) {
      clearTimeout(timer);
    }
    this.targetExpiryTimers.clear();
    if (this.cacheWriteTimer) {
      clearTimeout(this.cacheWriteTimer);
      this.cacheWriteTimer = null;
    }
    await this.writeRuntimeCache();
    this.client.removeAllListeners();
    await new Promise<void>((resolve) => {
      if (!this.client.connected) {
        resolve();
        return;
      }
      this.client.end(false, {}, () => resolve());
    });
    this.bridge.connected = false;
    this.bridge.lastError = null;
    this.sockets.clear();
    this.metas.clear();
    this.metasHydrated = false;
    this.pendingHydrations.clear();
  }
}
