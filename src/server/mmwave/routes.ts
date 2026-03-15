import type { FastifyInstance } from "fastify";
import type { Server as HttpServer, IncomingMessage } from "node:http";
import { WebSocketServer, WebSocket } from "ws";

import type {
  AreaKind,
  AreaSlot,
  UpdateAreaLabelRequest,
  UpdateAreaRequest,
  UpdateSettingsRequest,
  UpsertProfileRequest
} from "../../shared/mmwaveTypes.js";
import type { LazyMmwaveBridge } from "./lazyBridge.js";
import { AREA_KINDS, AREA_SLOTS, isFiniteNumber, clamp } from "../../shared/mmwaveUtils.js";

const DETECT_SENSITIVITY_OPTIONS = new Set(["Low", "Medium", "High (default)", "High"]);
const DETECT_TRIGGER_OPTIONS = new Set(["Fast (0.2s, default)", "Medium (0.5s)", "Slow (1s)"]);
const TARGET_INFO_REPORT_OPTIONS = new Set(["Enable", "Disable (default)"]);
const CONTROL_WIRED_DEVICE_OPTIONS = new Set(["Occupancy (default)", "Disabled"]);

function isAreaKind(value: string): value is AreaKind {
  return AREA_KINDS.includes(value as AreaKind);
}

function isAreaSlot(value: string): value is AreaSlot {
  return AREA_SLOTS.includes(value as AreaSlot);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isAreaRequest(body: unknown): body is UpdateAreaRequest {
  if (!body || typeof body !== "object" || !("area" in body)) {
    return false;
  }
  const area = (body as { area?: Record<string, unknown> }).area;
  if (!area || typeof area !== "object") {
    return false;
  }
  return ["width_min", "width_max", "depth_min", "depth_max", "height_min", "height_max"].every((key) =>
    isFiniteNumber(area[key])
  );
}

function isAreaRectValue(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const area = value as Record<string, unknown>;
  return ["width_min", "width_max", "depth_min", "depth_max", "height_min", "height_max"].every((key) =>
    isFiniteNumber(area[key])
  );
}

function isAreaCollectionValue(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const collection = value as Record<string, unknown>;
  return AREA_SLOTS.every((slot) => isAreaRectValue(collection[slot]));
}

function isProfileAreasValue(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const areas = value as Record<string, unknown>;
  return AREA_KINDS.every((kind) => isAreaCollectionValue(areas[kind]));
}

function isProfileSettingsValue(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const settings = value as Record<string, unknown>;
  return Boolean(
    isNonEmptyString(settings.roomPreset) &&
      typeof settings.detectSensitivity === "string" &&
      DETECT_SENSITIVITY_OPTIONS.has(settings.detectSensitivity) &&
      typeof settings.detectTrigger === "string" &&
      DETECT_TRIGGER_OPTIONS.has(settings.detectTrigger) &&
      isFiniteNumber(settings.holdTime) &&
      isFiniteNumber(settings.stayLife) &&
      typeof settings.targetInfoReport === "string" &&
      TARGET_INFO_REPORT_OPTIONS.has(settings.targetInfoReport) &&
      typeof settings.controlWiredDevice === "string" &&
      CONTROL_WIRED_DEVICE_OPTIONS.has(settings.controlWiredDevice) &&
      isFiniteNumber(settings.defaultLevelLocal) &&
      isAreaRectValue(settings.baseBounds)
  );
}

function isProfileRequest(body: unknown): body is UpsertProfileRequest {
  if (!body || typeof body !== "object") {
    return false;
  }
  const profile = body as Partial<UpsertProfileRequest>;
  return Boolean(
    isNonEmptyString(profile.name) &&
      isNonEmptyString(profile.sourceDevice) &&
      isProfileSettingsValue(profile.settings) &&
      isProfileAreasValue(profile.areas)
  );
}

function isAreaLabelRequest(body: unknown): body is UpdateAreaLabelRequest {
  if (!body || typeof body !== "object" || !("label" in body)) {
    return false;
  }
  const label = (body as { label?: unknown }).label;
  return typeof label === "string" && label.trim().length <= 48;
}

function isImportRequest(body: unknown): boolean {
  if (Array.isArray(body)) {
    return body.every((entry) => isProfileRequest(entry));
  }
  if (body && typeof body === "object" && !Array.isArray(body) && "profiles" in body) {
    const profiles = (body as { profiles?: unknown }).profiles;
    return Array.isArray(profiles) && profiles.every((entry) => isProfileRequest(entry));
  }
  return isProfileRequest(body);
}

function sanitizeSettingsRequest(body: unknown): UpdateSettingsRequest | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return null;
  }

  const input = body as Record<string, unknown>;
  const patch: UpdateSettingsRequest = {};

  if (typeof input.roomPreset === "string" && input.roomPreset.trim()) {
    patch.roomPreset = input.roomPreset;
  }
  if (typeof input.detectSensitivity === "string" && DETECT_SENSITIVITY_OPTIONS.has(input.detectSensitivity)) {
    patch.detectSensitivity = input.detectSensitivity;
  }
  if (typeof input.detectTrigger === "string" && DETECT_TRIGGER_OPTIONS.has(input.detectTrigger)) {
    patch.detectTrigger = input.detectTrigger;
  }
  if (isFiniteNumber(input.holdTime)) {
    patch.holdTime = input.holdTime;
  }
  if (isFiniteNumber(input.stayLife)) {
    patch.stayLife = input.stayLife;
  }
  if (typeof input.targetInfoReport === "string" && TARGET_INFO_REPORT_OPTIONS.has(input.targetInfoReport)) {
    patch.targetInfoReport = input.targetInfoReport;
  }
  if (typeof input.controlWiredDevice === "string" && CONTROL_WIRED_DEVICE_OPTIONS.has(input.controlWiredDevice)) {
    patch.controlWiredDevice = input.controlWiredDevice;
  }
  if (isFiniteNumber(input.defaultLevelLocal)) {
    patch.defaultLevelLocal = clamp(Math.round(input.defaultLevelLocal), 1, 255);
  }

  if (input.baseBounds && typeof input.baseBounds === "object" && !Array.isArray(input.baseBounds)) {
    const baseBoundsInput = input.baseBounds as Record<string, unknown>;
    const baseBounds: NonNullable<UpdateSettingsRequest["baseBounds"]> = {};
    for (const key of ["width_min", "width_max", "depth_min", "depth_max", "height_min", "height_max"] as const) {
      if (isFiniteNumber(baseBoundsInput[key])) {
        baseBounds[key] = baseBoundsInput[key];
      }
    }
    if (Object.keys(baseBounds).length > 0) {
      patch.baseBounds = baseBounds;
    }
  }

  return patch;
}

export async function registerMmwaveRoutes(app: FastifyInstance, lazy: LazyMmwaveBridge): Promise<void> {
  const ensureBridge = async () => {
    try {
      return await lazy.activate();
    } catch {
      throw new Error("mmWave bridge is not available");
    }
  };

  app.get("/api/mmwave/studio", async () => {
    const bridge = await ensureBridge();
    return bridge.getSnapshot();
  });

  app.get("/api/mmwave/devices", async () => {
    const bridge = await ensureBridge();
    return bridge.getSnapshot().devices;
  });

  app.get("/api/mmwave/devices/:name", async (request, reply) => {
    const bridge = await ensureBridge();
    const name = decodeURIComponent((request.params as { name: string }).name);
    const device = bridge.getDevice(name);
    if (!device) {
      reply.code(404);
      return { error: "Device not found" };
    }
    return device;
  });

  app.get("/api/mmwave/devices/:name/raw-state", async (request, reply) => {
    const bridge = await ensureBridge();
    const name = decodeURIComponent((request.params as { name: string }).name);
    const rawState = bridge.getRawState(name);
    if (!rawState) {
      reply.code(404);
      return { error: "Device not found" };
    }
    return rawState;
  });

  app.get("/api/mmwave/profiles", async () => lazy.profileStore.list());

  app.post("/api/mmwave/profiles", async (request, reply) => {
    if (!isProfileRequest(request.body)) {
      reply.code(400);
      return { error: "Invalid profile payload" };
    }
    return lazy.profileStore.create(request.body);
  });

  app.put("/api/mmwave/profiles/:id", async (request, reply) => {
    const id = (request.params as { id: string }).id;
    if (!isProfileRequest(request.body)) {
      reply.code(400);
      return { error: "Invalid profile payload" };
    }
    const profile = await lazy.profileStore.update(id, request.body);
    if (!profile) {
      reply.code(404);
      return { error: "Profile not found" };
    }
    return profile;
  });

  app.delete("/api/mmwave/profiles/:id", async (request, reply) => {
    const id = (request.params as { id: string }).id;
    const deleted = await lazy.profileStore.delete(id);
    if (!deleted) {
      reply.code(404);
      return { error: "Profile not found" };
    }
    return { ok: true };
  });

  app.post("/api/mmwave/profiles/import", async (request, reply) => {
    if (!isImportRequest(request.body)) {
      reply.code(400);
      return { error: "Invalid import payload" };
    }
    return lazy.profileStore.import(request.body);
  });

  app.post("/api/mmwave/profiles/:id/apply/:name", async (request, reply) => {
    const bridge = await ensureBridge();
    const { id, name } = request.params as { id: string; name: string };
    const profile = await lazy.profileStore.get(id);
    if (!profile) {
      reply.code(404);
      return { error: "Profile not found" };
    }
    const device = await bridge.applyProfile(decodeURIComponent(name), profile);
    if (!device) {
      reply.code(404);
      return { error: "Device not found" };
    }
    return device;
  });

  app.post("/api/mmwave/devices/:name/actions/find-me", async (request, reply) => {
    const bridge = await ensureBridge();
    const name = decodeURIComponent((request.params as { name: string }).name);
    const device = await bridge.identify(name);
    if (!device) {
      reply.code(404);
      return { error: "Device not found" };
    }
    return device;
  });

  app.post("/api/mmwave/devices/:name/actions/query-areas", async (request, reply) => {
    const bridge = await ensureBridge();
    const name = decodeURIComponent((request.params as { name: string }).name);
    const device = await bridge.queryAreas(name);
    if (!device) {
      reply.code(404);
      return { error: "Device not found" };
    }
    return device;
  });

  app.post("/api/mmwave/devices/:name/actions/reset-detection", async (request, reply) => {
    const bridge = await ensureBridge();
    const name = decodeURIComponent((request.params as { name: string }).name);
    const device = await bridge.resetDetectionAreas(name);
    if (!device) {
      reply.code(404);
      return { error: "Device not found" };
    }
    return device;
  });

  app.post("/api/mmwave/devices/:name/actions/clear-interference", async (request, reply) => {
    const bridge = await ensureBridge();
    const name = decodeURIComponent((request.params as { name: string }).name);
    const device = await bridge.clearInterference(name);
    if (!device) {
      reply.code(404);
      return { error: "Device not found" };
    }
    return device;
  });

  app.post("/api/mmwave/devices/:name/actions/clear-stay", async (request, reply) => {
    const bridge = await ensureBridge();
    const name = decodeURIComponent((request.params as { name: string }).name);
    const device = await bridge.clearStayAreas(name);
    if (!device) {
      reply.code(404);
      return { error: "Device not found" };
    }
    return device;
  });

  app.put("/api/mmwave/devices/:name/areas/:kind/:slot", async (request, reply) => {
    const bridge = await ensureBridge();
    const params = request.params as { name: string; kind: string; slot: string };
    if (!isAreaKind(params.kind) || !isAreaSlot(params.slot) || !isAreaRequest(request.body)) {
      reply.code(400);
      return { error: "Invalid area request" };
    }
    const body = request.body;
    const device = await bridge.updateArea(
      decodeURIComponent(params.name),
      params.kind,
      params.slot,
      body.area
    );
    if (!device) {
      reply.code(404);
      return { error: "Device not found" };
    }
    return device;
  });

  app.put("/api/mmwave/devices/:name/labels/:kind/:slot", async (request, reply) => {
    const bridge = await ensureBridge();
    const params = request.params as { name: string; kind: string; slot: string };
    if (!isAreaKind(params.kind) || !isAreaSlot(params.slot) || !isAreaLabelRequest(request.body)) {
      reply.code(400);
      return { error: "Invalid area label request" };
    }
    const body = request.body as UpdateAreaLabelRequest;
    const device = await bridge.updateAreaLabel(
      decodeURIComponent(params.name),
      params.kind,
      params.slot,
      body.label
    );
    if (!device) {
      reply.code(404);
      return { error: "Device not found" };
    }
    return device;
  });

  app.put("/api/mmwave/devices/:name/settings", async (request, reply) => {
    const bridge = await ensureBridge();
    const name = decodeURIComponent((request.params as { name: string }).name);
    const body = sanitizeSettingsRequest(request.body);
    if (!body) {
      reply.code(400);
      return { error: "Invalid settings request" };
    }
    const device = await bridge.updateSettings(name, body);
    if (!device) {
      reply.code(404);
      return { error: "Device not found" };
    }
    return device;
  });

  const MAX_WS_CONNECTIONS = 50;
  const wss = new WebSocketServer({ noServer: true, maxPayload: 1 * 1024 * 1024 }); // 1 MB
  const server = app.server as HttpServer;

  server.on("upgrade", (request: IncomingMessage, socket, head) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    if (url.pathname !== "/ws/mmwave") {
      return;
    }
    if (wss.clients.size >= MAX_WS_CONNECTIONS) {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(request, socket, head, async (ws: WebSocket) => {
      try {
        const bridge = await lazy.activate();
        bridge.attachSocket(ws);
        ws.on("error", () => {
          bridge.detachSocket(ws);
          lazy.scheduleIdleShutdown();
        });
        ws.on("close", () => {
          bridge.detachSocket(ws);
          lazy.scheduleIdleShutdown();
        });
      } catch {
        ws.close(1011, "mmWave bridge activation failed");
      }
    });
  });
}
