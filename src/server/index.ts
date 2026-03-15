import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import fastifyStatic from "@fastify/static";
import Fastify from "fastify";

import {
  errorMessage,
  type AuthSessionRequest,
  type AutomationSummary,
  type LearningLibraryResponse,
  type SaveConfigRequest,
  type SwitchManagerConfig
} from "../shared/types.js";
import { isRecord, asString, asNullableString } from "../shared/utils.js";
import { loadConfig, type StudioConfig } from "./config.js";
import { StudioAuthManager } from "./auth.js";
import { HomeAssistantClient } from "./haClient.js";
import { LazyMmwaveBridge } from "./mmwave/lazyBridge.js";
import { registerMmwaveRoutes } from "./mmwave/routes.js";

import { normalizeConfigForSave, normalizeConfigFromStore } from "./normalization.js";
import {
  fileExists,
  isPngBuffer,
  saveBlueprintImageOverride,
  removeBlueprintImageOverride,
  loadBlueprintImageStatus,
  serveLocalBlueprintImage,
  buildBlueprintExportPackage
} from "./blueprintUtils.js";
import { buildSnapshotWithWebsocket } from "./snapshot.js";
import {
  loadLearningStore,
  normalizeLearningSession,
  normalizeLearnedEvent,
  loadAutomations,
  buildDiscoveryCandidates,
  loadDeviceProperties,
  exportAutomation
} from "./automations.js";
import { callEntityControl, syncConfigArea } from "./entityControl.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

type StudioBackendMode = "websocket" | "none";

function preferredBackend(wsClient: HomeAssistantClient): StudioBackendMode {
  return wsClient.hasToken ? "websocket" : "none";
}

async function main(): Promise<void> {
  const config = loadConfig();
  const authManager = new StudioAuthManager(config);
  // On restart, restore wsClient from the most recent persisted session if no env token is set.
  const persistedSession = !config.haToken ? authManager.getLatestSession() : null;
  let wsClient = persistedSession
    ? new HomeAssistantClient({ ...config, haToken: persistedSession.accessToken, haBaseUrl: persistedSession.haBaseUrl })
    : new HomeAssistantClient(config);
  const MAX_BODY_BYTES = 5 * 1024 * 1024; // 5 MB
  const app = Fastify({ logger: true, bodyLimit: MAX_BODY_BYTES });
  const webRoot = resolve(__dirname, "../web");

  // Security headers
  app.addHook("onSend", async (_request, reply) => {
    void reply.header("X-Content-Type-Options", "nosniff");
    void reply.header("X-Frame-Options", "DENY");
    void reply.header("Referrer-Policy", "strict-origin-when-cross-origin");
  });

  // Simple per-IP rate limiter for auth endpoint
  const authAttempts = new Map<string, { count: number; resetAt: number }>();
  const AUTH_RATE_WINDOW_MS = 60_000;
  const AUTH_RATE_MAX = 15;
  const AUTH_RATE_PRUNE_THRESHOLD = 200;

  function pruneExpiredAuthBuckets(): void {
    if (authAttempts.size < AUTH_RATE_PRUNE_THRESHOLD) {
      return;
    }
    const now = Date.now();
    for (const [ip, bucket] of authAttempts) {
      if (bucket.resetAt <= now) {
        authAttempts.delete(ip);
      }
    }
  }

  app.get("/api/auth/status", async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    // When running as an add-on with SUPERVISOR_TOKEN, skip cookie-based auth entirely.
    if (config.haToken) {
      return {
        authenticated: true,
        haBaseUrl: config.haBaseUrl,
        defaultHaBaseUrl: config.haBaseUrl
      };
    }
    return authManager.status(request, reply, config);
  });

  app.post("/api/auth/session", async (request, reply) => {
    reply.header("Cache-Control", "no-store");

    // Rate limit auth attempts per IP
    pruneExpiredAuthBuckets();
    const clientIp = request.ip;
    const now = Date.now();
    const bucket = authAttempts.get(clientIp);
    if (bucket && bucket.resetAt > now) {
      bucket.count++;
      if (bucket.count > AUTH_RATE_MAX) {
        reply.code(429);
        return { error: "Too many authentication attempts. Try again later." };
      }
    } else {
      authAttempts.set(clientIp, { count: 1, resetAt: now + AUTH_RATE_WINDOW_MS });
    }

    const body = request.body as { accessToken?: unknown; haBaseUrl?: unknown } | undefined;
    const accessToken = typeof body?.accessToken === "string" ? body.accessToken.trim() : "";
    const haBaseUrl = typeof body?.haBaseUrl === "string" ? body.haBaseUrl.trim() : "";
    if (!accessToken || !haBaseUrl) {
      reply.code(400);
      return { error: "accessToken and haBaseUrl are required" };
    }
    const session = authManager.createSession(request, reply, { accessToken, haBaseUrl });
    wsClient.close();
    wsClient = new HomeAssistantClient({ ...config, haToken: session.accessToken, haBaseUrl: session.haBaseUrl });
    return {
      authenticated: true,
      haBaseUrl: session.haBaseUrl,
      defaultHaBaseUrl: config.haBaseUrl
    };
  });

  app.delete("/api/auth/session", async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    authManager.clearSession(request, reply);
    wsClient.close();
    wsClient = new HomeAssistantClient(config);
    return {
      authenticated: wsClient.hasToken,
      haBaseUrl: wsClient.hasToken ? wsClient.baseUrl : null,
      defaultHaBaseUrl: config.haBaseUrl
    };
  });

  app.get("/api/health", async (request, reply) => {
    if (!wsClient.hasToken) {
      reply.code(503);
      return {
        ok: false,
        haBaseUrl: config.haBaseUrl,
        hasToken: false,
        mmwaveConfigured: config.mmwave !== null,
        error: "HA_TOKEN is not configured"
      };
    }

    try {
      const result = await wsClient.call<{ version: string }>({ type: "get_config" });
      return {
        ok: true,
        haBaseUrl: wsClient.baseUrl,
        hasToken: true,
        mmwaveConfigured: config.mmwave !== null,
        version: result.version
      };
    } catch (error) {
      request.log.error(error);
      reply.code(503);
      return {
        ok: false,
        haBaseUrl: wsClient.baseUrl,
        hasToken: true,
        mmwaveConfigured: config.mmwave !== null,
        error: errorMessage(error)
      };
    }
  });

  app.get("/api/snapshot", async (request, reply) => {
    if (preferredBackend(wsClient) === "none") {
      reply.code(503);
      return { error: "HA_TOKEN is not configured" };
    }

    try {
      return await buildSnapshotWithWebsocket(wsClient);
    } catch (error) {
      request.log.error(error);
      reply.code(503);
      return { error: errorMessage(error) };
    }
  });

  app.get("/api/discovery", async (request, reply) => {
    if (preferredBackend(wsClient) === "none") {
      reply.code(503);
      return { error: "HA_TOKEN is not configured" };
    }

    try {
      const snapshot = await buildSnapshotWithWebsocket(wsClient);
      let automations: AutomationSummary[] = [];
      if (config.haConfigPath) {
        try {
          automations = await loadAutomations(config, snapshot);
        } catch {
          // automations unavailable — discovery continues without them
        }
      }
      return { candidates: buildDiscoveryCandidates(snapshot, automations) };
    } catch (error) {
      request.log.error(error);
      reply.code(400);
      return { error: errorMessage(error) };
    }
  });

  app.get("/api/automations", async (request, reply) => {
    if (preferredBackend(wsClient) === "none") {
      reply.code(503);
      return { error: "HA_TOKEN is not configured" };
    }
    if (!config.haConfigPath) {
      reply.code(501);
      return { error: "Automation import/export requires HA_CONFIG_PATH" };
    }

    try {
      const snapshot = await buildSnapshotWithWebsocket(wsClient);
      return { automations: await loadAutomations(config, snapshot) };
    } catch (error) {
      request.log.error(error);
      reply.code(400);
      return { error: errorMessage(error) };
    }
  });

  app.post("/api/automations/export", async (request, reply) => {
    if (preferredBackend(wsClient) === "none") {
      reply.code(503);
      return { error: "HA_TOKEN is not configured" };
    }
    if (!config.haConfigPath) {
      reply.code(501);
      return { error: "Automation export requires HA_CONFIG_PATH" };
    }

    const body = request.body as {
      configId?: string;
      buttonIndex?: number;
      actionIndex?: number;
      pressCount?: number;
      virtual?: boolean;
      alias?: string;
    };
    if (
      typeof body?.configId !== "string" ||
      typeof body?.buttonIndex !== "number" ||
      typeof body?.actionIndex !== "number"
    ) {
      reply.code(400);
      return { error: "configId, buttonIndex, and actionIndex are required" };
    }
    try {
      const snapshot = await buildSnapshotWithWebsocket(wsClient);
      return {
        automation: await exportAutomation(wsClient, config, snapshot, {
          configId: body.configId,
          buttonIndex: body.buttonIndex,
          actionIndex: body.actionIndex,
          pressCount: body.pressCount,
          virtual: body.virtual,
          alias: body.alias
        })
      };
    } catch (error) {
      request.log.error(error);
      reply.code(400);
      return { error: errorMessage(error) };
    }
  });

  app.get("/api/blueprints/:id/image-status", async (request, reply) => {
    const params = request.params as { id: string };
    try {
      return await loadBlueprintImageStatus(params.id, config, wsClient);
    } catch (error) {
      request.log.error(error);
      reply.code(400);
      return { error: errorMessage(error) };
    }
  });

  app.post("/api/blueprints/:id/image-override", async (request, reply) => {
    const params = request.params as { id: string };
    const body = request.body as { imageBase64?: unknown; sourceFileName?: unknown } | undefined;
    if (typeof body?.imageBase64 !== "string" || !body.imageBase64.trim()) {
      reply.code(400);
      return { error: "imageBase64 is required" };
    }
    const imageBase64 = body.imageBase64;
    const sourceFileName = typeof body.sourceFileName === "string" ? body.sourceFileName : null;
    // Reject oversized payloads before allocating the buffer (~3 MB base64 ≈ ~2.25 MB decoded)
    const MAX_IMAGE_BASE64_LENGTH = 3 * 1024 * 1024;
    if (imageBase64.length > MAX_IMAGE_BASE64_LENGTH) {
      reply.code(400);
      return { error: "Image is too large (max ~2 MB)" };
    }

    try {
      const buffer = Buffer.from(imageBase64, "base64");
      if (!buffer.length) {
        throw new Error("Uploaded image content was empty");
      }
      if (!isPngBuffer(buffer)) {
        throw new Error("Uploaded image must be converted to PNG before it reaches the server");
      }

      await saveBlueprintImageOverride(config.blueprintImageOverrideDir, params.id, buffer);
      const status = await loadBlueprintImageStatus(params.id, config, wsClient);
      return {
        ...status,
        sourceFileName
      };
    } catch (error) {
      request.log.error(error);
      reply.code(400);
      return { error: errorMessage(error) };
    }
  });

  app.delete("/api/blueprints/:id/image-override", async (request, reply) => {
    const params = request.params as { id: string };

    try {
      await removeBlueprintImageOverride(config.blueprintImageOverrideDir, params.id);
      return await loadBlueprintImageStatus(params.id, config, wsClient);
    } catch (error) {
      request.log.error(error);
      reply.code(400);
      return { error: errorMessage(error) };
    }
  });

  app.post("/api/blueprints/export-package", async (request, reply) => {
    if (preferredBackend(wsClient) === "none") {
      reply.code(503);
      return { error: "Blueprint export requires HA_TOKEN" };
    }

    const body = request.body as SaveConfigRequest | undefined;
    const draft = body?.config;
    if (!draft || typeof draft.blueprintId !== "string" || !draft.blueprintId.trim()) {
      reply.code(400);
      return { error: "config.blueprintId is required" };
    }

    try {
      const snapshot = await buildSnapshotWithWebsocket(wsClient);
      const blueprint = snapshot.blueprints.find((entry) => entry.id === draft.blueprintId);
      if (!blueprint) {
        throw new Error(`Blueprint ${draft.blueprintId} was not found`);
      }

      const packageResult = await buildBlueprintExportPackage({
        wsClient,
        config,
        draft,
        blueprint
      });

      reply.header("Cache-Control", "no-store");
      const safeFileName = packageResult.fileName.replace(/["\n\r]/g, "");
      reply.header("Content-Disposition", `attachment; filename="${safeFileName}"`);
      reply.header("Content-Length", String(packageResult.content.length));
      reply.header("Content-Type", "application/gzip");
      return packageResult.content;
    } catch (error) {
      request.log.error(error);
      reply.code(400);
      return { error: errorMessage(error) };
    }
  });

  app.get("/api/learning", async (request, reply) => {
    if (preferredBackend(wsClient) === "none") {
      reply.code(503);
      return { error: "HA_TOKEN is not configured" };
    }
    if (!config.haConfigPath) {
      reply.code(501);
      return { error: "Learn mode requires HA_CONFIG_PATH" };
    }

    try {
      const store = await loadLearningStore(config);
      const response: LearningLibraryResponse = {
        activeSession: normalizeLearningSession(store.active_session),
        events: (store.library ?? [])
          .filter((entry): entry is Record<string, unknown> => isRecord(entry))
          .map((entry) => normalizeLearnedEvent(entry))
          .sort((left, right) => right.capturedAt.localeCompare(left.capturedAt))
      };
      return response;
    } catch (error) {
      request.log.error(error);
      reply.code(400);
      return { error: errorMessage(error) };
    }
  });

  app.post("/api/learning/start", async (request, reply) => {
    if (preferredBackend(wsClient) === "none") {
      reply.code(503);
      return { error: "HA_TOKEN is not configured" };
    }
    if (!config.haConfigPath) {
      reply.code(501);
      return { error: "Learn mode requires HA_CONFIG_PATH" };
    }

    const body = request.body as {
      blueprintId?: string;
      configId?: string;
      identifier?: string;
      label?: string;
    };

    try {
      await wsClient.callService("switch_manager", "start_learning", {
        ...(body.blueprintId ? { blueprint_id: body.blueprintId } : {}),
        ...(body.configId ? { config_id: body.configId } : {}),
        ...(body.identifier ? { identifier: body.identifier } : {}),
        ...(body.label ? { label: body.label } : {})
      });
      const store = await loadLearningStore(config);
      return {
        activeSession: normalizeLearningSession(store.active_session)
      };
    } catch (error) {
      request.log.error(error);
      reply.code(400);
      return { error: errorMessage(error) };
    }
  });

  app.post("/api/learning/stop", async (request, reply) => {
    if (preferredBackend(wsClient) === "none") {
      reply.code(503);
      return { error: "HA_TOKEN is not configured" };
    }
    if (!config.haConfigPath) {
      reply.code(501);
      return { error: "Learn mode requires HA_CONFIG_PATH" };
    }

    try {
      await wsClient.callService("switch_manager", "stop_learning");
      return { ok: true };
    } catch (error) {
      request.log.error(error);
      reply.code(400);
      return { error: errorMessage(error) };
    }
  });

  app.post("/api/learning/clear", async (request, reply) => {
    if (preferredBackend(wsClient) === "none") {
      reply.code(503);
      return { error: "HA_TOKEN is not configured" };
    }
    if (!config.haConfigPath) {
      reply.code(501);
      return { error: "Learn mode requires HA_CONFIG_PATH" };
    }

    try {
      await wsClient.callService("switch_manager", "clear_learning_library");
      return { ok: true };
    } catch (error) {
      request.log.error(error);
      reply.code(400);
      return { error: errorMessage(error) };
    }
  });

  app.get("/api/devices/:id/properties", async (request, reply) => {
    if (preferredBackend(wsClient) === "none") {
      reply.code(503);
      return { error: "HA_TOKEN is not configured" };
    }

    try {
      const params = request.params as { id: string };
      const snapshot = await buildSnapshotWithWebsocket(wsClient);
      return await loadDeviceProperties(wsClient, snapshot, params.id);
    } catch (error) {
      request.log.error(error);
      reply.code(400);
      return { error: errorMessage(error) };
    }
  });

  app.get("/api/devices/:deviceId/image", async (request, reply) => {
    if (preferredBackend(wsClient) === "none") {
      reply.code(503);
      return { error: "HA_TOKEN is not configured" };
    }

    const params = request.params as { deviceId: string };

    try {
      const allStates = await wsClient.call<Array<Record<string, unknown>>>({ type: "get_states" });
      const entityRegistry = await wsClient.call<Array<Record<string, unknown>>>({
        type: "config/entity_registry/list"
      });

      // Build a set of entity IDs belonging to this device.
      const deviceEntityIds = new Set(
        entityRegistry
          .filter((entry): entry is Record<string, unknown> => isRecord(entry) && asString(entry.device_id) === params.deviceId)
          .map((entry) => asString(entry.entity_id))
          .filter(Boolean)
      );

      // Find the first entity that has entity_picture in its state attributes.
      const entityPictureUrl = allStates
        .filter((state): state is Record<string, unknown> => isRecord(state) && deviceEntityIds.has(asString(state.entity_id)))
        .map((state) => isRecord(state.attributes) ? asNullableString(state.attributes.entity_picture) : null)
        .find((url): url is string => Boolean(url));

      if (!entityPictureUrl) {
        reply.code(404);
        return { error: "No device image available for this device" };
      }

      const response = await wsClient.fetch(entityPictureUrl);
      if (!response.ok) {
        reply.code(404);
        return { error: "Device image could not be fetched from Home Assistant" };
      }

      const rawContentType = response.headers.get("content-type") ?? "image/jpeg";
      const contentType = rawContentType.startsWith("image/") ? rawContentType : "image/jpeg";
      void reply.header("Content-Type", contentType);
      return Buffer.from(await response.arrayBuffer());
    } catch (error) {
      request.log.error(error);
      reply.code(500);
      return { error: "Device image fetch failed" };
    }
  });

  app.post("/api/entities/control", async (request, reply) => {
    if (preferredBackend(wsClient) === "none") {
      reply.code(503);
      return { error: "HA_TOKEN is not configured" };
    }

    const body = request.body as { entityId?: string; action?: string; value?: unknown };
    if (typeof body?.entityId !== "string" || typeof body?.action !== "string") {
      reply.code(400);
      return { error: "entityId and action are required" };
    }

    try {
      await callEntityControl(wsClient, body.entityId, body.action, body.value);
      return { ok: true };
    } catch (error) {
      request.log.error(error);
      reply.code(400);
      return { error: errorMessage(error) };
    }
  });

  app.post("/api/configs/save", async (request, reply) => {
    if (preferredBackend(wsClient) === "none") {
      reply.code(503);
      return { error: "HA_TOKEN is not configured" };
    }

    const body = request.body as SaveConfigRequest | undefined;
    if (!body || !isRecord(body.config)) {
      reply.code(400);
      return { error: "Invalid config payload" };
    }

    const draft = body.config as SwitchManagerConfig;

    try {
      let result: { config_id: string; config: Record<string, unknown> };
      try {
        result = await wsClient.call<{ config_id: string; config: Record<string, unknown> }>({
          type: "switch_manager/config/save",
          config: normalizeConfigForSave(draft)
        });
      } catch (saveError) {
        // Some Switch Manager versions reject the metadata field — retry without it.
        if (draft.metadata) {
          request.log.warn("Config save failed with metadata, retrying without: %s", errorMessage(saveError));
          const stripped = normalizeConfigForSave({ ...draft, metadata: null });
          result = await wsClient.call<{ config_id: string; config: Record<string, unknown> }>({
            type: "switch_manager/config/save",
            config: stripped
          });
        } else {
          throw saveError;
        }
      }

      const savedId = asString(result.config_id) || draft.id;
      const savedConfig = normalizeConfigFromStore(savedId, isRecord(result.config) ? result.config : {});

      // HA may not round-trip metadata — carry it forward from the draft so
      // area sync and the client response both have the correct values.
      savedConfig.metadata = draft.metadata;

      try {
        await syncConfigArea(wsClient, savedConfig);
      } catch (syncError) {
        request.log.error(syncError, "Area sync failed after config save");
        return { ok: true, config: savedConfig, warning: "Config saved but area assignment failed: " + errorMessage(syncError) };
      }
      return { ok: true, config: savedConfig };
    } catch (error) {
      request.log.error(error);
      reply.code(400);
      return { error: errorMessage(error) };
    }
  });

  app.put("/api/configs/:id/enabled", async (request, reply) => {
    if (preferredBackend(wsClient) === "none") {
      reply.code(503);
      return { error: "HA_TOKEN is not configured" };
    }

    const params = request.params as { id: string };
    const body = request.body as { enabled?: unknown };
    if (typeof body?.enabled !== "boolean") {
      reply.code(400);
      return { error: "enabled must be a boolean" };
    }

    try {
      return await wsClient.call({
        type: "switch_manager/config/enabled",
        config_id: params.id,
        enabled: body.enabled
      });
    } catch (error) {
      request.log.error(error);
      reply.code(400);
      return { error: errorMessage(error) };
    }
  });

  app.delete("/api/configs/:id", async (request, reply) => {
    if (preferredBackend(wsClient) === "none") {
      reply.code(503);
      return { error: "HA_TOKEN is not configured" };
    }

    const params = request.params as { id: string };

    try {
      return await wsClient.call({
        type: "switch_manager/config/delete",
        config_id: params.id
      });
    } catch (error) {
      request.log.error(error);
      reply.code(400);
      return { error: errorMessage(error) };
    }
  });

  app.get("/api/blueprints/:id/image", async (request, reply) => {
    const params = request.params as { id: string };

    try {
      const overrideImage = await serveLocalBlueprintImage(config.blueprintImageOverrideDir, params.id);
      if (overrideImage) {
        reply.header("Content-Type", "image/png");
        reply.header("Cache-Control", "no-store");
        return overrideImage;
      }

      const localImage = await serveLocalBlueprintImage(config.blueprintImageDir, params.id);
      if (localImage) {
        reply.header("Content-Type", "image/png");
        reply.header("Cache-Control", "no-store");
        return localImage;
      }

      if (wsClient.hasToken) {
        const response = await wsClient.fetch(`/assets/switch_manager/${encodeURIComponent(params.id)}.png`);
        if (response.ok) {
          const bpContentType = response.headers.get("content-type") ?? "image/png";
          reply.header("Content-Type", bpContentType.startsWith("image/") ? bpContentType : "image/png");
          reply.header("Cache-Control", "no-store");
          return Buffer.from(await response.arrayBuffer());
        }
      }
    } catch (error) {
      request.log.error(error);
    }

    reply.code(404);
    return { error: `Blueprint image not available for ${params.id}` };
  });

  if (await fileExists(webRoot)) {
    await app.register(fastifyStatic, {
      root: webRoot,
      prefix: "/"
    });

    // When running behind HA ingress the supervisor sets INGRESS_ENTRY to the
    // path prefix (e.g. /api/hassio_ingress/TOKEN/). Injecting it as <base href>
    // makes all relative asset and API URLs resolve correctly under that prefix.
    const rawIngressEntry = process.env.INGRESS_ENTRY?.trim() || "/";
    // Sanitize for safe injection into an HTML attribute
    const ingressEntry = rawIngressEntry.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
    const indexHtml = await readFile(resolve(webRoot, "index.html"), "utf8");
    const indexHtmlWithBase = indexHtml.replace("<head>", `<head><base href="${ingressEntry}">`);

    app.setNotFoundHandler(async (request, reply) => {
      if (request.url.startsWith("/api/")) {
        reply.code(404);
        return { error: "Not found" };
      }
      void reply.header("content-type", "text/html; charset=utf-8");
      return indexHtmlWithBase;
    });
  }

  if (config.mmwave) {
    const lazyMmwave = new LazyMmwaveBridge(config.mmwave);
    await registerMmwaveRoutes(app, lazyMmwave);
  }

  // Startup token validation via REST — helps diagnose WebSocket auth failures
  if (config.haToken) {
    try {
      const res = await fetch(`${config.haBaseUrl}/api/`, {
        headers: { Authorization: `Bearer ${config.haToken}` }
      });
      if (res.ok) {
        app.log.info(`HA token validated via REST (${config.haBaseUrl})`);
      } else {
        app.log.warn(`HA token rejected by REST API: ${res.status} ${res.statusText}`);
      }
    } catch (err) {
      app.log.warn(`Could not reach HA REST API at ${config.haBaseUrl}: ${err instanceof Error ? err.message : err}`);
    }
  }

  await app.listen({ host: config.host, port: config.port });
}

void main();
