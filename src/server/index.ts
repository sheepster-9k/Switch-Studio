import { constants } from "node:fs";
import { access, readFile } from "node:fs/promises";
import { basename, dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import fastifyStatic from "@fastify/static";
import Fastify from "fastify";
import { stringify as stringifyYaml } from "yaml";

import type {
  AutomationSummary,
  AreaSummary,
  DevicePropertiesResponse,
  DeviceSummary,
  DiscoveryCandidate,
  EntitySummary,
  LearnedEvent,
  LearningLibraryResponse,
  LearningSession,
  PropertyControlType,
  PropertyEntity,
  SaveConfigRequest,
  SequenceStep,
  StudioSnapshot,
  SwitchManagerBlueprint,
  SwitchManagerConfig,
  SwitchManagerVirtualAction
} from "../shared/types.js";
import { HomeAssistantAgentClient } from "./agentClient.js";
import { loadConfig, type StudioConfig } from "./config.js";
import { HomeAssistantClient } from "./haClient.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

type StudioBackendMode = "agent" | "websocket" | "none";

interface SwitchManagerStoreFile {
  version?: number;
  minor_version?: number;
  key?: string;
  data?: {
    version?: string;
    managed_switches?: Record<string, Record<string, unknown>>;
  };
}

interface SwitchManagerLearningStoreFile {
  data?: {
    active_session?: Record<string, unknown> | null;
    library?: Array<Record<string, unknown>>;
  };
  active_session?: Record<string, unknown> | null;
  library?: Array<Record<string, unknown>>;
}

interface BlueprintFileEntry {
  path: string;
  name: string;
  modified: number;
  isYaml: boolean;
}

interface CachedBlueprintCatalog {
  signature: string;
  blueprints: SwitchManagerBlueprint[];
}

interface RegistryEntityLink {
  entityId: string;
  deviceId: string | null;
  areaId: string | null;
  uniqueId: string | null;
  name: string | null;
  originalName: string | null;
  platform: string | null;
  domain: string;
}

interface RegistryDeviceLink {
  id: string;
  name: string;
  nameByUser: string | null;
  areaId: string | null;
  manufacturer: string | null;
  model: string | null;
  identifiers: string[];
  entityIds: string[];
}

const blueprintCatalogCache = new Map<string, CachedBlueprintCatalog>();

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asNullableString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function asBoolean(value: unknown, fallback = false): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function asList<T>(value: unknown): T[] {
  if (Array.isArray(value)) {
    return value as T[];
  }
  if (value === undefined || value === null) {
    return [];
  }
  return [value as T];
}

function normalizeBlueprint(raw: Record<string, unknown>): SwitchManagerBlueprint {
  const buttons = asArray<Record<string, unknown>>(raw.buttons).map((button) => ({
    x: typeof button.x === "number" ? button.x : undefined,
    y: typeof button.y === "number" ? button.y : undefined,
    width: typeof button.width === "number" ? button.width : undefined,
    height: typeof button.height === "number" ? button.height : undefined,
    d: typeof button.d === "string" ? button.d : undefined,
    conditions: asArray<Record<string, unknown>>(button.conditions).map((condition) => ({
      key: asString(condition.key),
      value: asString(condition.value)
    })),
    actions: asArray<Record<string, unknown>>(button.actions).map((action, index) => ({
      title: asString(action.title, `Action ${index + 1}`),
      conditions: asArray<Record<string, unknown>>(action.conditions).map((condition) => ({
        key: asString(condition.key),
        value: asString(condition.value)
      }))
    }))
  }));

  return {
    id: asString(raw.id),
    name: asString(raw.name),
    service: asString(raw.service),
    eventType: asString(raw.event_type),
    identifierKey: asNullableString(raw.identifier_key),
    isMqtt: asBoolean(raw.is_mqtt, asString(raw.event_type) === "mqtt"),
    hasImage: asBoolean(raw.has_image),
    info: asNullableString(raw.info),
    buttons
  };
}

function normalizeConfig(raw: Record<string, unknown>): SwitchManagerConfig {
  const rawBlueprint = isRecord(raw.blueprint) ? raw.blueprint : null;
  const blueprintId = rawBlueprint ? asString(rawBlueprint.id) : asString(raw.blueprint);
  return {
    id: asString(raw.id),
    name: asString(raw.name),
    enabled: asBoolean(raw.enabled, true),
    blueprintId,
    identifier: asString(raw.identifier),
    variables: isRecord(raw.variables) ? raw.variables : null,
    deviceId: asNullableString(raw.device_id),
    primaryEntityId: asNullableString(raw.primary_entity_id),
    propertyEntityIds: asArray<string>(raw.property_entity_ids),
    metadata: isRecord(raw.metadata) ? raw.metadata : null,
    virtualMultiPress: {
      enabled: asBoolean(isRecord(raw.virtual_multi_press) ? raw.virtual_multi_press.enabled : undefined),
      pressWindowMs: asNumber(isRecord(raw.virtual_multi_press) ? raw.virtual_multi_press.press_window_ms : undefined, 450),
      maxPresses: asNumber(isRecord(raw.virtual_multi_press) ? raw.virtual_multi_press.max_presses : undefined, 3)
    },
    rotate: asNumber(raw.rotate),
    buttons: asArray<Record<string, unknown>>(raw.buttons).map((button) => ({
      actions: asArray<Record<string, unknown>>(button.actions).map((action) => ({
        mode: asString(action.mode, "single"),
        sequence: asArray<SequenceStep>(action.sequence)
      })),
      virtualActions: asArray<Record<string, unknown>>(button.virtual_actions).map((action, index) => ({
        title: asString(action.title, `press ${index + 1}x`),
        pressCount: asNumber(action.press_count, index + 1),
        mode: asString(action.mode, "single"),
        sequence: asArray<SequenceStep>(action.sequence)
      }))
    })),
    isMismatch: asBoolean(raw.is_mismatch),
    validBlueprint: asBoolean(raw.valid_blueprint, true),
    error: asNullableString(raw._error),
    buttonLastState: asArray<Record<string, unknown> | null>(raw.button_last_state)
  };
}

function normalizeConfigForSave(config: SwitchManagerConfig): Record<string, unknown> {
  return {
    id: config.id,
    name: config.name,
    enabled: config.enabled,
    blueprint: config.blueprintId,
    identifier: config.identifier,
    variables: config.variables,
    device_id: config.deviceId,
    primary_entity_id: config.primaryEntityId,
    property_entity_ids: config.propertyEntityIds,
    metadata: config.metadata,
    virtual_multi_press: {
      enabled: config.virtualMultiPress.enabled,
      press_window_ms: config.virtualMultiPress.pressWindowMs,
      max_presses: config.virtualMultiPress.maxPresses
    },
    rotate: config.rotate,
    buttons: config.buttons.map((button) => ({
      actions: button.actions.map((action) => ({
        mode: action.mode,
        sequence: action.sequence
      })),
      virtual_actions: button.virtualActions.map((action) => ({
        title: action.title,
        press_count: action.pressCount,
        mode: action.mode,
        sequence: action.sequence
      }))
    }))
  };
}

function normalizeStoreConfigForSave(config: SwitchManagerConfig): Record<string, unknown> {
  const { id: _ignoredId, ...next } = normalizeConfigForSave(config);
  return next;
}

function normalizeConfigFromStore(id: string, raw: Record<string, unknown>): SwitchManagerConfig {
  return normalizeConfig({ id, ...raw });
}

function normalizeStateSummary(raw: Record<string, unknown>): Record<string, unknown> {
  return {
    entity_id: asString(raw.entity_id),
    state: asNullableString(raw.state),
    friendly_name: asString(raw.friendly_name),
    domain: asString(raw.domain)
  };
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    if (typeof value !== "string" || !value.trim() || seen.has(value)) {
      continue;
    }
    seen.add(value);
    result.push(value);
  }
  return result;
}

function flattenStringValues(value: unknown): string[] {
  if (value === null || value === undefined) {
    return [];
  }
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    const normalized = String(value).trim();
    return normalized ? [normalized] : [];
  }
  if (Array.isArray(value)) {
    return value.flatMap((entry) => flattenStringValues(entry));
  }
  return [];
}

function normalizeComparableName(value: string | null | undefined): string {
  return (value ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isZwaveBlueprint(blueprint: SwitchManagerBlueprint | null | undefined): boolean {
  const haystack = `${blueprint?.id ?? ""} ${blueprint?.name ?? ""} ${blueprint?.service ?? ""} ${blueprint?.eventType ?? ""}`.toLowerCase();
  return haystack.includes("zwave") || haystack.includes("z-wave");
}

function isLutronBlueprint(blueprint: SwitchManagerBlueprint | null | undefined): boolean {
  const haystack = `${blueprint?.id ?? ""} ${blueprint?.name ?? ""} ${blueprint?.service ?? ""} ${blueprint?.eventType ?? ""}`.toLowerCase();
  return haystack.includes("lutron");
}

function extractMqttFriendlyName(identifier: string): string | null {
  const match = identifier.match(/^zigbee2mqtt\/(.+?)\/[^/]+$/i);
  if (!match?.[1]) {
    return null;
  }
  return match[1].trim() || null;
}

function matchesZwaveNodeIdentifier(value: string, nodeId: string): boolean {
  if (!/^\d+$/.test(nodeId.trim())) {
    return false;
  }
  const pattern = new RegExp(`(?:^|[-.])${escapeRegExp(nodeId.trim())}(?:$|[-.])`);
  return pattern.test(value);
}

function selectPrimaryEntity(entities: RegistryEntityLink[]): RegistryEntityLink | null {
  if (!entities.length) {
    return null;
  }

  const domainScore = new Map<string, number>([
    ["event", 70],
    ["button", 60],
    ["sensor", 50],
    ["binary_sensor", 45],
    ["select", 40],
    ["number", 35],
    ["switch", 30],
    ["light", 25]
  ]);

  return [...entities].sort((left, right) => {
    const scoreDelta = (domainScore.get(right.domain) ?? 0) - (domainScore.get(left.domain) ?? 0);
    if (scoreDelta !== 0) {
      return scoreDelta;
    }
    return left.entityId.localeCompare(right.entityId);
  })[0] ?? null;
}

function resolveAreaFromLinks(
  device: RegistryDeviceLink | null,
  entities: RegistryEntityLink[]
): string | null {
  for (const entity of entities) {
    if (entity.areaId) {
      return entity.areaId;
    }
  }
  return device?.areaId ?? null;
}

function findDirectEntityMatch(
  identifier: string,
  entityLinks: RegistryEntityLink[]
): RegistryEntityLink | null {
  const matches = entityLinks.filter(
    (entity) => entity.entityId === identifier || entity.uniqueId === identifier
  );
  return matches.length === 1 ? matches[0] : null;
}

function resolveDeviceForConfig(
  configEntry: SwitchManagerConfig,
  blueprint: SwitchManagerBlueprint | null,
  deviceLinks: RegistryDeviceLink[],
  entityLinks: RegistryEntityLink[]
): RegistryDeviceLink | null {
  const identifier = configEntry.identifier.trim();
  if (!identifier) {
    return null;
  }

  const exactDeviceMatches = deviceLinks.filter(
    (device) => device.id === identifier || device.identifiers.includes(identifier)
  );
  if (exactDeviceMatches.length === 1) {
    return exactDeviceMatches[0];
  }

  const directEntity = findDirectEntityMatch(identifier, entityLinks);
  if (directEntity?.deviceId) {
    const linkedDevice = deviceLinks.find((device) => device.id === directEntity.deviceId) ?? null;
    if (linkedDevice) {
      return linkedDevice;
    }
  }

  const mqttFriendlyName = extractMqttFriendlyName(identifier);
  if (mqttFriendlyName) {
    const normalizedFriendlyName = normalizeComparableName(mqttFriendlyName);
    const mqttMatches = deviceLinks.filter((device) =>
      [device.name, device.nameByUser]
        .map((entry) => normalizeComparableName(entry))
        .includes(normalizedFriendlyName)
    );
    if (mqttMatches.length === 1) {
      return mqttMatches[0];
    }
  }

  if (isZwaveBlueprint(blueprint)) {
    const zwaveMatches = deviceLinks.filter((device) =>
      device.identifiers.some((entry) => matchesZwaveNodeIdentifier(entry, identifier))
    );
    if (zwaveMatches.length === 1) {
      return zwaveMatches[0];
    }
  }

  if (isLutronBlueprint(blueprint)) {
    const lutronMatches = deviceLinks.filter(
      (device) =>
        device.id === identifier ||
        device.identifiers.some((entry) => entry === identifier)
    );
    if (lutronMatches.length === 1) {
      return lutronMatches[0];
    }
  }

  return null;
}

function hydrateConfigLinks(
  configs: SwitchManagerConfig[],
  blueprints: SwitchManagerBlueprint[],
  deviceLinks: RegistryDeviceLink[],
  entityLinks: RegistryEntityLink[]
): SwitchManagerConfig[] {
  const blueprintsById = new Map(blueprints.map((blueprint) => [blueprint.id, blueprint]));
  const devicesById = new Map(deviceLinks.map((device) => [device.id, device]));
  const entitiesById = new Map(entityLinks.map((entity) => [entity.entityId, entity]));
  const entitiesByDeviceId = new Map<string, RegistryEntityLink[]>();

  for (const entity of entityLinks) {
    if (!entity.deviceId) {
      continue;
    }
    const next = entitiesByDeviceId.get(entity.deviceId) ?? [];
    next.push(entity);
    entitiesByDeviceId.set(entity.deviceId, next);
  }

  return configs.map((configEntry) => {
    const blueprint = blueprintsById.get(configEntry.blueprintId) ?? null;
    const persistedPrimaryEntity = configEntry.primaryEntityId
      ? entitiesById.get(configEntry.primaryEntityId) ?? null
      : null;
    const persistedPropertyEntities = configEntry.propertyEntityIds
      .map((entityId) => entitiesById.get(entityId) ?? null)
      .filter((entity): entity is RegistryEntityLink => Boolean(entity));
    let device =
      (configEntry.deviceId ? devicesById.get(configEntry.deviceId) ?? null : null) ??
      (persistedPrimaryEntity?.deviceId ? devicesById.get(persistedPrimaryEntity.deviceId) ?? null : null);

    if (!device) {
      device = resolveDeviceForConfig(configEntry, blueprint, deviceLinks, entityLinks);
    }

    const deviceEntities = device ? entitiesByDeviceId.get(device.id) ?? [] : [];
    const propertyEntityIds =
      configEntry.propertyEntityIds.length > 0
        ? configEntry.propertyEntityIds
        : uniqueStrings([
            persistedPrimaryEntity?.entityId ?? null,
            ...persistedPropertyEntities.map((entity) => entity.entityId),
            ...deviceEntities.map((entity) => entity.entityId)
          ]);
    const linkedEntities = uniqueStrings([
      configEntry.primaryEntityId,
      ...propertyEntityIds
    ])
      .map((entityId) => entitiesById.get(entityId) ?? null)
      .filter((entity): entity is RegistryEntityLink => Boolean(entity));
    const primaryEntity =
      persistedPrimaryEntity ??
      selectPrimaryEntity(linkedEntities.length > 0 ? linkedEntities : deviceEntities);
    const resolvedAreaId = resolveAreaFromLinks(
      device,
      primaryEntity ? [primaryEntity, ...linkedEntities] : linkedEntities
    );

    let metadata = isRecord(configEntry.metadata)
      ? ({ ...configEntry.metadata } as SwitchManagerConfig["metadata"])
      : configEntry.metadata;
    if (isRecord(metadata) && metadata.areaManaged === true) {
      metadata = {
        ...metadata,
        areaId: resolvedAreaId
      };
    }

    return {
      ...configEntry,
      deviceId: device?.id ?? configEntry.deviceId,
      primaryEntityId: primaryEntity?.entityId ?? configEntry.primaryEntityId,
      propertyEntityIds,
      metadata
    };
  });
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function sanitizeBlueprintId(value: string): string | null {
  return /^[A-Za-z0-9._-]+$/.test(value) ? value : null;
}

function preferredBackend(agentClient: HomeAssistantAgentClient, wsClient: HomeAssistantClient): StudioBackendMode {
  if (agentClient.hasKey) {
    return "agent";
  }
  if (wsClient.hasToken) {
    return "websocket";
  }
  return "none";
}

async function buildSnapshotWithWebsocket(client: HomeAssistantClient): Promise<StudioSnapshot> {
  const [blueprintsResult, configsResult, areaResult, deviceResult, entityResult, statesResult] = await Promise.all([
    client.call<{ blueprints: Record<string, Record<string, unknown>> }>({ type: "switch_manager/blueprints" }),
    client.call<{ configs: Record<string, Record<string, unknown>> }>({ type: "switch_manager/configs" }),
    client.call<Array<Record<string, unknown>>>({ type: "config/area_registry/list" }),
    client.call<Array<Record<string, unknown>>>({ type: "config/device_registry/list" }),
    client.call<Array<Record<string, unknown>>>({ type: "config/entity_registry/list" }),
    client.call<Array<Record<string, unknown>>>({ type: "get_states" })
  ]);

  return buildSnapshotFromRawData({
    haBaseUrl: client.baseUrl,
    areasRaw: areaResult,
    blueprints: Object.entries(blueprintsResult.blueprints ?? {}).map(([id, raw]) =>
      normalizeBlueprint({ id, ...raw })
    ),
    configsRaw: Object.entries(configsResult.configs ?? {}).map(([id, raw]) => ({ id, raw })),
    devicesRaw: deviceResult,
    entityRegistryRaw: entityResult,
    entityStatesRaw: statesResult
  });
}

async function buildSnapshotWithAgent(
  client: HomeAssistantAgentClient,
  config: StudioConfig
): Promise<StudioSnapshot> {
  const [blueprints, store, areaResult, deviceResult, entityRegistry, entityStates] = await Promise.all([
    loadBlueprintCatalog(client, config),
    loadStore(client, config),
    client.listAreas(),
    client.listDevices(),
    client.listEntityRegistry(),
    client.listEntitySummaries()
  ]);

  return buildSnapshotFromRawData({
    haBaseUrl: config.haBaseUrl,
    areasRaw: areaResult,
    blueprints,
    configsRaw: Object.entries(store.data?.managed_switches ?? {}).map(([id, raw]) => ({ id, raw })),
    devicesRaw: deviceResult,
    entityRegistryRaw: entityRegistry,
    entityStatesRaw: entityStates.map((entry) => normalizeStateSummary(entry))
  });
}

function buildSnapshotFromRawData(input: {
  haBaseUrl: string;
  blueprints: SwitchManagerBlueprint[];
  configsRaw: Array<{ id: string; raw: Record<string, unknown> }>;
  areasRaw: Array<Record<string, unknown>>;
  devicesRaw: Array<Record<string, unknown>>;
  entityRegistryRaw: Array<Record<string, unknown>>;
  entityStatesRaw: Array<Record<string, unknown>>;
}): StudioSnapshot {
  const statesByEntityId = new Map<string, Record<string, unknown>>();
  for (const rawState of input.entityStatesRaw) {
    const entityId = asString(rawState.entity_id);
    if (entityId) {
      statesByEntityId.set(entityId, rawState);
    }
  }
  const rawEntityRegistryById = new Map<string, Record<string, unknown>>();
  for (const rawEntity of input.entityRegistryRaw) {
    const entityId = asString(rawEntity.entity_id);
    if (entityId) {
      rawEntityRegistryById.set(entityId, rawEntity);
    }
  }

  const areas: AreaSummary[] = input.areasRaw
    .map((area) => ({
      id: asString(area.area_id || area.id),
      name: asString(area.name),
      aliases: asArray<string>(area.aliases)
    }))
    .filter((area) => Boolean(area.id))
    .sort((left, right) => left.name.localeCompare(right.name));

  const entityIdsByDevice = new Map<string, string[]>();
  const entityLinks: RegistryEntityLink[] = input.entityRegistryRaw
    .map((entity) => {
      const entityId = asString(entity.entity_id);
      const state = statesByEntityId.get(entityId);
      const deviceId = asNullableString(entity.device_id);
      if (deviceId) {
        const next = entityIdsByDevice.get(deviceId) ?? [];
        next.push(entityId);
        entityIdsByDevice.set(deviceId, next);
      }

      return {
        entityId,
        deviceId,
        areaId: asNullableString(entity.area_id),
        uniqueId: asNullableString(entity.unique_id),
        name: asNullableString(asString(entity.name)),
        originalName: asNullableString(asString(entity.original_name)),
        platform: asNullableString(entity.platform),
        domain: asString(state?.domain) || entityId.split(".")[0] || "entity"
      };
    })
    .filter((entity) => Boolean(entity.entityId));

  const entities: EntitySummary[] = entityLinks
    .map((entity) => {
      const state = statesByEntityId.get(entity.entityId);
      const rawEntity = rawEntityRegistryById.get(entity.entityId);
      return {
        entityId: entity.entityId,
        name:
          asString(state?.friendly_name) ||
          entity.name ||
          entity.originalName ||
          entity.entityId,
        domain: entity.domain,
        areaId: entity.areaId,
        deviceId: entity.deviceId,
        state: asNullableString(state?.state),
        icon: asNullableString(rawEntity?.icon),
        disabled: Boolean(rawEntity?.disabled_by),
        hidden: Boolean(rawEntity?.hidden_by)
      };
    })
    .sort((left, right) => left.name.localeCompare(right.name));
  const entityNameById = new Map(
    entityLinks.map((entity) => [entity.entityId, entity.name ?? entity.originalName] satisfies [string, string | null])
  );

  const deviceLinks: RegistryDeviceLink[] = input.devicesRaw
    .map((device) => {
      const id = asString(device.id);
      const linkedEntityIds = entityIdsByDevice.get(id) ?? [];
      const linkedEntityName = linkedEntityIds
        .map((entityId) => entityNameById.get(entityId) ?? null)
        .find((name): name is string => Boolean(name));

      return {
        id,
        name: asString(device.name_by_user) || asString(device.name) || linkedEntityName || id,
        nameByUser: asNullableString(device.name_by_user),
        areaId: asNullableString(device.area_id),
        manufacturer: asNullableString(device.manufacturer),
        model: asNullableString(device.model),
        identifiers: uniqueStrings([
          ...flattenStringValues(device.identifiers),
          ...flattenStringValues(device.connections)
        ]),
        entityIds: linkedEntityIds.sort((left, right) => left.localeCompare(right))
      };
    })
    .filter((device) => Boolean(device.id));

  const devices: DeviceSummary[] = deviceLinks
    .map((device) => ({
      id: device.id,
      name: device.name,
      areaId: device.areaId,
      manufacturer: device.manufacturer,
      model: device.model,
      entityIds: device.entityIds
    }))
    .sort((left, right) => left.name.localeCompare(right.name));

  const blueprints = [...input.blueprints].sort((left, right) => left.name.localeCompare(right.name));
  const configs = hydrateConfigLinks(
    input.configsRaw.map(({ id, raw }) => normalizeConfigFromStore(id, raw)),
    blueprints,
    deviceLinks,
    entityLinks
  )
    .sort((left, right) => Number(left.id) - Number(right.id));

  return {
    generatedAt: new Date().toISOString(),
    haBaseUrl: input.haBaseUrl,
    blueprints,
    configs,
    areas,
    devices,
    entities
  };
}

async function loadStore(client: HomeAssistantAgentClient, config: StudioConfig): Promise<SwitchManagerStoreFile> {
  const content = await client.readFile(config.switchManagerStorePath);
  const parsed = JSON.parse(content) as SwitchManagerStoreFile;
  if (!isRecord(parsed) || !isRecord(parsed.data)) {
    throw new Error("Switch Manager store file is invalid");
  }
  if (!isRecord(parsed.data.managed_switches)) {
    parsed.data.managed_switches = {};
  }
  return parsed;
}

async function writeStore(
  client: HomeAssistantAgentClient,
  config: StudioConfig,
  store: SwitchManagerStoreFile
): Promise<void> {
  await client.writeFile(config.switchManagerStorePath, `${JSON.stringify(store, null, 2)}\n`);
}

async function loadLearningStore(
  client: HomeAssistantAgentClient,
  config: StudioConfig
): Promise<SwitchManagerLearningStoreFile> {
  try {
    const content = await client.readFile(config.switchManagerLearningStorePath);
    const parsed = JSON.parse(content) as SwitchManagerLearningStoreFile;
    const data = isRecord(parsed.data) ? parsed.data : parsed;
    return {
      active_session: isRecord(data.active_session) ? data.active_session : null,
      library: Array.isArray(data.library) ? data.library : []
    };
  } catch {
    return {
      active_session: null,
      library: []
    };
  }
}

function normalizeLearningSession(raw: Record<string, unknown> | null | undefined): LearningSession | null {
  if (!isRecord(raw)) {
    return null;
  }

  return {
    active: asBoolean(raw.active, true),
    blueprintId: asNullableString(raw.blueprint_id),
    configId: asNullableString(raw.config_id),
    identifier: asNullableString(raw.identifier),
    label: asNullableString(raw.label),
    startedAt: formatTimestamp(raw.started_at),
    updatedAt: formatTimestamp(raw.updated_at)
  };
}

function normalizeLearnedEvent(raw: Record<string, unknown>): LearnedEvent {
  return {
    capturedAt: formatTimestamp(raw.captured_at) ?? new Date().toISOString(),
    blueprintId: asNullableString(raw.blueprint_id),
    configId: asNullableString(raw.config_id),
    identifier: asNullableString(raw.identifier),
    button: typeof raw.button === "number" ? raw.button : null,
    action: typeof raw.action === "number" ? raw.action : null,
    actionTitle: asNullableString(raw.action_title),
    pressCount: typeof raw.press_count === "number" ? raw.press_count : null,
    virtual: asBoolean(raw.virtual),
    data: isRecord(raw.data) ? raw.data : {}
  };
}

function formatTimestamp(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return new Date(value * 1000).toISOString();
  }
  if (typeof value === "string" && value.trim()) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : date.toISOString();
  }
  return null;
}

function getNestedValue(record: Record<string, unknown>, path: string): unknown {
  return path.split(".").reduce<unknown>((current, key) => {
    if (!current || typeof current !== "object") {
      return undefined;
    }
    return (current as Record<string, unknown>)[key];
  }, record);
}

function pressCountFromTitle(title: string | null): number | null {
  if (!title) {
    return null;
  }
  const match = title.match(/press\s+(\d+)x/i);
  if (!match) {
    return title.toLowerCase() === "press" ? 1 : null;
  }
  const parsed = Number(match[1]);
  return Number.isInteger(parsed) ? parsed : null;
}

function normalizeAutomationEntry(
  raw: Record<string, unknown>,
  snapshot: StudioSnapshot | null
): AutomationSummary {
  const triggers = asList<Record<string, unknown>>(raw.triggers ?? raw.trigger).filter((entry) => isRecord(entry));
  const conditions = asList<SequenceStep>(raw.conditions ?? raw.condition);
  const actions = asList<SequenceStep>(raw.actions ?? raw.action);
  const match = inferAutomationMatch(triggers, snapshot);

  return {
    id: asString(raw.id, stableAutomationId(raw)),
    alias: asString(raw.alias, "Imported Automation"),
    description: asNullableString(raw.description),
    mode: asNullableString(raw.mode),
    triggers,
    conditions,
    actions,
    matchedConfigId: match.matchedConfigId,
    matchedButtonIndex: match.matchedButtonIndex,
    matchedActionIndex: match.matchedActionIndex,
    matchedPressCount: match.matchedPressCount,
    matchSummary: match.matchSummary,
    source: "automations.yaml"
  };
}

function stableAutomationId(raw: Record<string, unknown>): string {
  const alias = asString(raw.alias);
  const description = asString(raw.description);
  const basis = `${alias}|${description}`.trim() || JSON.stringify(raw);
  return `automation-${basis.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "generated"}`;
}

function inferAutomationMatch(
  triggers: Array<Record<string, unknown>>,
  snapshot: StudioSnapshot | null
): {
  matchedConfigId: string | null;
  matchedButtonIndex: number | null;
  matchedActionIndex: number | null;
  matchedPressCount: number | null;
  matchSummary: string | null;
} {
  if (!snapshot) {
    return {
      matchedConfigId: null,
      matchedButtonIndex: null,
      matchedActionIndex: null,
      matchedPressCount: null,
      matchSummary: null
    };
  }

  for (const trigger of triggers) {
    const triggerType = asString(trigger.trigger);
    if (triggerType === "event" && asString(trigger.event_type) === "switch_manager_action") {
      const eventData = isRecord(trigger.event_data) ? trigger.event_data : {};
      return {
        matchedConfigId: asNullableString(eventData.switch_id),
        matchedButtonIndex: typeof eventData.button === "number" ? eventData.button : null,
        matchedActionIndex: typeof eventData.action === "number" ? eventData.action : null,
        matchedPressCount: typeof eventData.press_count === "number" ? eventData.press_count : null,
        matchSummary: "Normalized Switch Manager automation"
      };
    }

    if (triggerType !== "event") {
      continue;
    }

    for (const config of snapshot.configs) {
      const blueprint = snapshot.blueprints.find((entry) => entry.id === config.blueprintId);
      if (!blueprint || asString(trigger.event_type) !== blueprint.eventType) {
        continue;
      }
      const eventData = isRecord(trigger.event_data) ? trigger.event_data : {};
      if (blueprint.identifierKey && String(eventData[blueprint.identifierKey] ?? "") !== config.identifier) {
        continue;
      }

      for (const [buttonIndex, button] of blueprint.buttons.entries()) {
        const rawButtonConditions = button.conditions ?? [];
        if (
          rawButtonConditions.length > 0 &&
          !rawButtonConditions.every((condition) => String(getNestedValue(eventData, condition.key)) === condition.value)
        ) {
          continue;
        }

        for (const [actionIndex, action] of button.actions.entries()) {
          const rawActionConditions = action.conditions ?? [];
          if (
            rawActionConditions.length > 0 &&
            !rawActionConditions.every((condition) => String(getNestedValue(eventData, condition.key)) === condition.value)
          ) {
            continue;
          }

          return {
            matchedConfigId: config.id,
            matchedButtonIndex: buttonIndex,
            matchedActionIndex: actionIndex,
            matchedPressCount: pressCountFromTitle(action.title),
            matchSummary: `${config.name} / ${action.title}`
          };
        }
      }
    }
  }

  return {
    matchedConfigId: null,
    matchedButtonIndex: null,
    matchedActionIndex: null,
    matchedPressCount: null,
    matchSummary: null
  };
}

async function loadAutomationsWithAgent(
  client: HomeAssistantAgentClient,
  config: StudioConfig,
  snapshot: StudioSnapshot | null
): Promise<AutomationSummary[]> {
  const parsed = (await client.parseYaml(config.automationsPath)) as unknown;
  const entries = Array.isArray(parsed) ? parsed : [];
  return entries
    .filter((entry): entry is Record<string, unknown> => isRecord(entry))
    .map((entry) => normalizeAutomationEntry(entry, snapshot))
    .sort((left, right) => left.alias.localeCompare(right.alias));
}

function probableProtocolFromStrings(...values: Array<string | null | undefined>): string | null {
  const text = values.filter(Boolean).join(" ").toLowerCase();
  if (text.includes("zwave") || text.includes("z-wave")) {
    return "Z-Wave";
  }
  if (text.includes("matter")) {
    return "Matter";
  }
  if (text.includes("zigbee") || text.includes("zha") || text.includes("zigbee2mqtt")) {
    return "Zigbee";
  }
  if (text.includes("mqtt")) {
    return "MQTT";
  }
  if (text.includes("deconz")) {
    return "deCONZ";
  }
  return null;
}

function tokenize(value: string | null | undefined): string[] {
  return (value ?? "")
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .filter((entry) => entry.length >= 2);
}

function scoreBlueprintSuggestion(device: DeviceSummary, blueprint: SwitchManagerBlueprint): number {
  const deviceTokens = new Set([
    ...tokenize(device.name),
    ...tokenize(device.manufacturer),
    ...tokenize(device.model)
  ]);
  const blueprintTokens = [...tokenize(blueprint.id), ...tokenize(blueprint.name), ...tokenize(blueprint.service)];
  return blueprintTokens.reduce((score, token) => score + (deviceTokens.has(token) ? 1 : 0), 0);
}

function automationReferencesEntities(automation: AutomationSummary, entityIds: string[]): boolean {
  const entitySet = new Set(entityIds);
  const haystack = JSON.stringify({
    triggers: automation.triggers,
    conditions: automation.conditions,
    actions: automation.actions
  });
  return [...entitySet].some((entityId) => haystack.includes(entityId));
}

function buildDiscoveryCandidates(
  snapshot: StudioSnapshot,
  automations: AutomationSummary[]
): DiscoveryCandidate[] {
  return snapshot.devices
    .filter((device) => device.entityIds.length > 0)
    .map((device) => {
      const probableProtocol = probableProtocolFromStrings(device.manufacturer, device.model, device.name);
      const suggestedBlueprintIds = snapshot.blueprints
        .map((blueprint) => ({
          id: blueprint.id,
          score: scoreBlueprintSuggestion(device, blueprint)
        }))
        .filter((entry) => entry.score > 0)
        .sort((left, right) => right.score - left.score)
        .slice(0, 3)
        .map((entry) => entry.id);
      const relatedAutomationIds = automations
        .filter((automation) => automationReferencesEntities(automation, device.entityIds))
        .slice(0, 8)
        .map((automation) => automation.id);

      return {
        id: device.id,
        name: device.name,
        manufacturer: device.manufacturer,
        model: device.model,
        areaId: device.areaId,
        deviceId: device.id,
        entityIds: device.entityIds,
        probableProtocol,
        suggestedBlueprintIds,
        relatedAutomationIds
      };
    })
    .filter((candidate) => {
      const hasSwitchLikeEntity = candidate.entityIds.some((entityId) =>
        ["event.", "button.", "switch.", "select.", "number."].some((prefix) => entityId.startsWith(prefix)) ||
        /action|scene|button|switch|remote|dimmer/i.test(entityId)
      );
      return hasSwitchLikeEntity || candidate.suggestedBlueprintIds.length > 0 || candidate.relatedAutomationIds.length > 0;
    })
    .sort((left, right) => {
      const rightScore = right.suggestedBlueprintIds.length + right.relatedAutomationIds.length;
      const leftScore = left.suggestedBlueprintIds.length + left.relatedAutomationIds.length;
      return rightScore - leftScore || left.name.localeCompare(right.name);
    });
}

function inferPropertyControlType(state: Record<string, unknown>): {
  controlType: PropertyControlType;
  options: string[];
  min: number | null;
  max: number | null;
  step: number | null;
  writable: boolean;
} {
  const entityId = asString(state.entity_id);
  const domain = entityId.split(".")[0] ?? "entity";
  const attributes = isRecord(state.attributes) ? state.attributes : {};

  if (domain === "select" || domain === "input_select") {
    return {
      controlType: "select",
      options: asArray<string>(attributes.options),
      min: null,
      max: null,
      step: null,
      writable: true
    };
  }

  if (domain === "number" || domain === "input_number") {
    return {
      controlType: "number",
      options: [],
      min: typeof attributes.min === "number" ? attributes.min : null,
      max: typeof attributes.max === "number" ? attributes.max : null,
      step: typeof attributes.step === "number" ? attributes.step : null,
      writable: true
    };
  }

  if (domain === "button") {
    return {
      controlType: "button",
      options: [],
      min: null,
      max: null,
      step: null,
      writable: true
    };
  }

  if (["switch", "input_boolean", "light", "fan"].includes(domain)) {
    return {
      controlType: "toggle",
      options: [],
      min: null,
      max: null,
      step: null,
      writable: true
    };
  }

  return {
    controlType: "readonly",
    options: [],
    min: null,
    max: null,
    step: null,
    writable: false
  };
}

function normalizePropertyEntity(state: Record<string, unknown>): PropertyEntity {
  const attributes = isRecord(state.attributes) ? state.attributes : {};
  const control = inferPropertyControlType(state);

  return {
    entityId: asString(state.entity_id),
    name: asString(attributes.friendly_name, asString(state.entity_id)),
    domain: asString(state.entity_id).split(".")[0] ?? "entity",
    state: asNullableString(state.state),
    icon: asNullableString(attributes.icon),
    attributes,
    controlType: control.controlType,
    options: control.options,
    min: control.min,
    max: control.max,
    step: control.step,
    writable: control.writable
  };
}

async function loadDevicePropertiesWithAgent(
  client: HomeAssistantAgentClient,
  snapshot: StudioSnapshot,
  deviceId: string
): Promise<DevicePropertiesResponse> {
  const device = snapshot.devices.find((entry) => entry.id === deviceId) ?? null;
  if (!device) {
    return {
      device: null,
      probableProtocol: null,
      entities: []
    };
  }

  const stateResults = await Promise.all(
    device.entityIds.map(async (entityId) => {
      const matches = await client.listEntities({
        pageSize: 10,
        search: entityId
      });
      return matches.find((entry) => asString(entry.entity_id) === entityId) ?? null;
    })
  );
  const stateMap = new Map(
    stateResults
      .filter((entry): entry is Record<string, unknown> => Boolean(entry))
      .map((entry) => [asString(entry.entity_id), entry] satisfies [string, Record<string, unknown>])
  );

  return {
    device,
    probableProtocol: probableProtocolFromStrings(device.manufacturer, device.model, device.name),
    entities: device.entityIds
      .map((entityId) => stateMap.get(entityId))
      .filter((entry): entry is Record<string, unknown> => Boolean(entry))
      .map((entry) => normalizePropertyEntity(entry))
      .sort((left, right) => left.name.localeCompare(right.name))
  };
}

async function callEntityControlWithAgent(
  client: HomeAssistantAgentClient,
  entityId: string,
  action: string,
  value?: unknown
): Promise<void> {
  const domain = entityId.split(".")[0];
  const target = { entity_id: entityId };

  if (action === "toggle" || action === "turn_on" || action === "turn_off") {
    await client.callService(domain, action, undefined, target);
    return;
  }
  if (action === "press") {
    await client.callService(domain, "press", undefined, target);
    return;
  }
  if (action === "select_option") {
    await client.callService(domain, "select_option", { option: value }, target);
    return;
  }
  if (action === "set_value") {
    await client.callService(domain, "set_value", { value }, target);
    return;
  }

  throw new Error(`Unsupported control action ${action}`);
}

function buildExportAutomation(
  configEntry: SwitchManagerConfig,
  blueprint: SwitchManagerBlueprint,
  buttonIndex: number,
  actionIndex: number,
  pressCount: number,
  virtual: boolean,
  sequence: SequenceStep[],
  alias?: string
): Record<string, unknown> {
  const nativeTitle = blueprint.buttons[buttonIndex]?.actions[actionIndex]?.title ?? `Action ${actionIndex + 1}`;
  const actionTitle =
    configEntry.buttons[buttonIndex]?.virtualActions.find((entry) => entry.pressCount === pressCount)?.title ??
    nativeTitle;

  return {
    id: `${configEntry.id}_${buttonIndex}_${virtual ? `virtual_${pressCount}` : actionIndex}`,
    alias: alias ?? `${configEntry.name} / Button ${buttonIndex + 1} / ${actionTitle}`,
    description: `Exported from Switch Manager Studio for ${configEntry.name}`,
    triggers: [
      {
        trigger: "event",
        event_type: "switch_manager_action",
        event_data: {
          switch_id: configEntry.id,
          button: buttonIndex,
          press_count: pressCount,
          virtual,
          ...(!virtual ? { action: actionIndex } : {})
        }
      }
    ],
    conditions: [],
    actions: sequence,
    mode: "single"
  };
}

async function exportAutomationWithAgent(
  client: HomeAssistantAgentClient,
  config: StudioConfig,
  snapshot: StudioSnapshot,
  payload: {
    configId: string;
    buttonIndex: number;
    actionIndex: number;
    pressCount?: number;
    virtual?: boolean;
    alias?: string;
  }
): Promise<AutomationSummary> {
  const configEntry = snapshot.configs.find((entry) => entry.id === payload.configId);
  if (!configEntry) {
    throw new Error(`Switch config ${payload.configId} was not found`);
  }
  const blueprint = snapshot.blueprints.find((entry) => entry.id === configEntry.blueprintId);
  if (!blueprint) {
    throw new Error(`Blueprint ${configEntry.blueprintId} was not found`);
  }

  const virtual = Boolean(payload.virtual);
  const pressCount = payload.pressCount ?? 1;
  const sequence = virtual
    ? configEntry.buttons[payload.buttonIndex]?.virtualActions.find((entry) => entry.pressCount === pressCount)?.sequence ?? []
    : configEntry.buttons[payload.buttonIndex]?.actions[payload.actionIndex]?.sequence ?? [];
  if (!sequence.length) {
    throw new Error("Selected action has no sequence to export");
  }

  const exported = buildExportAutomation(
    configEntry,
    blueprint,
    payload.buttonIndex,
    payload.actionIndex,
    pressCount,
    virtual,
    sequence,
    payload.alias
  );
  const currentContent = await client.readFile(config.automationsPath);
  const nextContent = `${currentContent.replace(/\s*$/, "\n")}${stringifyYaml([exported])}`;
  await client.writeFile(config.automationsPath, `${nextContent.replace(/\s*$/, "\n")}`);
  await client.callService("automation", "reload");

  return normalizeAutomationEntry(exported, snapshot);
}

function nextConfigId(store: SwitchManagerStoreFile): string {
  const managedSwitches = store.data?.managed_switches ?? {};
  const numericIds = Object.keys(managedSwitches)
    .map((entry) => Number(entry))
    .filter((value) => Number.isInteger(value) && value >= 0);

  if (!numericIds.length) {
    return "0";
  }

  return String(Math.max(...numericIds) + 1);
}

function managedAreaIdFromConfig(configEntry: SwitchManagerConfig): string | null | undefined {
  if (!isRecord(configEntry.metadata) || configEntry.metadata.areaManaged !== true) {
    return undefined;
  }
  return asNullableString(configEntry.metadata.areaId) ?? null;
}

async function syncConfigAreaWithAgent(
  client: HomeAssistantAgentClient,
  configEntry: SwitchManagerConfig
): Promise<void> {
  const areaId = managedAreaIdFromConfig(configEntry);
  if (areaId === undefined) {
    return;
  }

  if (configEntry.deviceId) {
    await client.updateDeviceArea(configEntry.deviceId, areaId);
    return;
  }

  const entityId =
    configEntry.primaryEntityId ??
    configEntry.propertyEntityIds.find((entry) => entry.includes(".")) ??
    null;

  if (entityId) {
    await client.updateEntityArea(entityId, areaId);
  }
}

async function saveConfigWithAgent(
  client: HomeAssistantAgentClient,
  config: StudioConfig,
  draft: SwitchManagerConfig
): Promise<SwitchManagerConfig> {
  const store = await loadStore(client, config);
  const managedSwitches = store.data?.managed_switches ?? {};
  const nextId = draft.id?.trim() ? draft.id : nextConfigId(store);

  managedSwitches[nextId] = normalizeStoreConfigForSave({
    ...draft,
    id: nextId
  });

  if (store.data) {
    store.data.managed_switches = managedSwitches;
  }

  await writeStore(client, config, store);
  await syncConfigAreaWithAgent(client, {
    ...draft,
    id: nextId
  });
  await client.callService("switch_manager", "reload");

  return normalizeConfigFromStore(nextId, managedSwitches[nextId]);
}

async function setConfigEnabledWithAgent(
  client: HomeAssistantAgentClient,
  config: StudioConfig,
  configId: string,
  enabled: boolean
): Promise<{ switch_id: string; enabled: boolean }> {
  const store = await loadStore(client, config);
  const managedSwitches = store.data?.managed_switches ?? {};
  const current = managedSwitches[configId];
  if (!isRecord(current)) {
    throw new Error(`Switch Manager config ${configId} was not found`);
  }

  current.enabled = enabled;
  await writeStore(client, config, store);
  await client.callService("switch_manager", "reload");

  return {
    switch_id: configId,
    enabled
  };
}

async function deleteConfigWithAgent(
  client: HomeAssistantAgentClient,
  config: StudioConfig,
  configId: string
): Promise<{ deleted: string }> {
  const store = await loadStore(client, config);
  const managedSwitches = store.data?.managed_switches ?? {};
  if (!(configId in managedSwitches)) {
    throw new Error(`Switch Manager config ${configId} was not found`);
  }

  delete managedSwitches[configId];
  await writeStore(client, config, store);
  await client.callService("switch_manager", "reload");

  return {
    deleted: configId
  };
}

async function loadBlueprintCatalog(
  client: HomeAssistantAgentClient,
  config: StudioConfig
): Promise<SwitchManagerBlueprint[]> {
  const files = (await client.listFiles(config.switchManagerBlueprintDir, "*"))
    .map((entry) => ({
      path: asString(entry.path),
      name: asString(entry.name),
      modified: asNumber(entry.modified),
      isYaml: asBoolean(entry.is_yaml)
    }))
    .filter((entry) => isDirectChild(config.switchManagerBlueprintDir, entry.path));

  const yamlFiles = files.filter((entry) => entry.isYaml && entry.name.toLowerCase().endsWith(".yaml"));
  const imageIds = new Set(
    files
      .filter((entry) => !entry.isYaml && extname(entry.name).toLowerCase() === ".png")
      .map((entry) => basename(entry.name, ".png"))
  );
  const signature = yamlFiles
    .map((entry) => `${entry.path}:${entry.modified}:${imageIds.has(basename(entry.name, ".yaml")) ? 1 : 0}`)
    .sort()
    .join("|");
  const cacheKey = client.baseUrl;
  const cached = blueprintCatalogCache.get(cacheKey);

  if (cached && cached.signature === signature) {
    return cached.blueprints;
  }

  const blueprints = (
    await Promise.all(
      yamlFiles.map(async (entry) => {
        const id = basename(entry.name, ".yaml");
        const parsed = await client.parseYaml(entry.path);
        if (!isRecord(parsed)) {
          return null;
        }
        return normalizeBlueprint({
          id,
          has_image: imageIds.has(id),
          ...parsed
        });
      })
    )
  )
    .filter((blueprint): blueprint is SwitchManagerBlueprint => Boolean(blueprint))
    .sort((left, right) => left.name.localeCompare(right.name));

  blueprintCatalogCache.set(cacheKey, {
    signature,
    blueprints
  });

  return blueprints;
}

function isDirectChild(directory: string, filePath: string): boolean {
  const normalizedDirectory = directory.replace(/\\/g, "/").replace(/\/+$/, "");
  const normalizedPath = filePath.replace(/\\/g, "/");
  if (!normalizedPath.startsWith(`${normalizedDirectory}/`)) {
    return false;
  }
  const relativePath = normalizedPath.slice(normalizedDirectory.length + 1);
  return Boolean(relativePath) && !relativePath.includes("/");
}

async function loadHomeAssistantVersionWithAgent(client: HomeAssistantAgentClient): Promise<string | null> {
  try {
    return (await client.readFile(".HA_VERSION")).trim() || null;
  } catch {
    return null;
  }
}

async function serveLocalBlueprintImage(
  imageRoot: string,
  blueprintId: string
): Promise<Buffer | null> {
  const safeBlueprintId = sanitizeBlueprintId(blueprintId);
  if (!safeBlueprintId) {
    return null;
  }

  const imagePath = resolve(imageRoot, `${safeBlueprintId}.png`);
  if (!(await fileExists(imagePath))) {
    return null;
  }

  return readFile(imagePath);
}

async function main(): Promise<void> {
  const config = loadConfig();
  const wsClient = new HomeAssistantClient(config);
  const agentClient = new HomeAssistantAgentClient(config);
  const app = Fastify({ logger: true });
  const webRoot = resolve(__dirname, "../web");

  app.get("/api/health", async (request, reply) => {
    const backend = preferredBackend(agentClient, wsClient);

    if (backend === "none") {
      reply.code(503);
      return {
        ok: false,
        haBaseUrl: config.haBaseUrl,
        hasToken: false,
        error: "Neither HA_AGENT_KEY nor HA_TOKEN is configured"
      };
    }

    if (backend === "agent") {
      try {
        const [agentHealth, haVersion] = await Promise.all([
          agentClient.health(),
          loadHomeAssistantVersionWithAgent(agentClient)
        ]);

        return {
          ok: true,
          haBaseUrl: config.haBaseUrl,
          hasToken: true,
          version: haVersion ?? `Agent ${agentHealth.version ?? "connected"}`
        };
      } catch (error) {
        request.log.error(error);
        reply.code(503);
        return {
          ok: false,
          haBaseUrl: config.haBaseUrl,
          hasToken: true,
          error: error instanceof Error ? error.message : String(error)
        };
      }
    }

    try {
      const result = await wsClient.call<{ version: string }>({ type: "get_config" });
      return {
        ok: true,
        haBaseUrl: wsClient.baseUrl,
        hasToken: true,
        version: result.version
      };
    } catch (error) {
      request.log.error(error);
      reply.code(503);
      return {
        ok: false,
        haBaseUrl: wsClient.baseUrl,
        hasToken: true,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  });

  app.get("/api/snapshot", async (request, reply) => {
    const backend = preferredBackend(agentClient, wsClient);

    try {
      if (backend === "agent") {
        return await buildSnapshotWithAgent(agentClient, config);
      }
      if (backend === "websocket") {
        return await buildSnapshotWithWebsocket(wsClient);
      }

      reply.code(503);
      return {
        error: "Neither HA_AGENT_KEY nor HA_TOKEN is configured"
      };
    } catch (error) {
      request.log.error(error);
      reply.code(503);
      return {
        error: error instanceof Error ? error.message : String(error)
      };
    }
  });

  app.get("/api/discovery", async (request, reply) => {
    const backend = preferredBackend(agentClient, wsClient);
    if (backend !== "agent") {
      reply.code(501);
      return { error: "Switch discovery requires HA agent mode" };
    }

    try {
      const snapshot = await buildSnapshotWithAgent(agentClient, config);
      const automations = await loadAutomationsWithAgent(agentClient, config, snapshot);
      return {
        candidates: buildDiscoveryCandidates(snapshot, automations)
      };
    } catch (error) {
      request.log.error(error);
      reply.code(400);
      return { error: error instanceof Error ? error.message : String(error) };
    }
  });

  app.get("/api/automations", async (request, reply) => {
    const backend = preferredBackend(agentClient, wsClient);
    if (backend !== "agent") {
      reply.code(501);
      return { error: "Automation import/export requires HA agent mode" };
    }

    try {
      const snapshot = await buildSnapshotWithAgent(agentClient, config);
      return {
        automations: await loadAutomationsWithAgent(agentClient, config, snapshot)
      };
    } catch (error) {
      request.log.error(error);
      reply.code(400);
      return { error: error instanceof Error ? error.message : String(error) };
    }
  });

  app.post("/api/automations/export", async (request, reply) => {
    const backend = preferredBackend(agentClient, wsClient);
    if (backend !== "agent") {
      reply.code(501);
      return { error: "Automation export requires HA agent mode" };
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
      const snapshot = await buildSnapshotWithAgent(agentClient, config);
      return {
        automation: await exportAutomationWithAgent(agentClient, config, snapshot, {
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
      return { error: error instanceof Error ? error.message : String(error) };
    }
  });

  app.get("/api/learning", async (request, reply) => {
    const backend = preferredBackend(agentClient, wsClient);
    if (backend !== "agent") {
      reply.code(501);
      return { error: "Learn mode requires HA agent mode" };
    }

    try {
      const store = await loadLearningStore(agentClient, config);
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
      return { error: error instanceof Error ? error.message : String(error) };
    }
  });

  app.post("/api/learning/start", async (request, reply) => {
    const backend = preferredBackend(agentClient, wsClient);
    if (backend !== "agent") {
      reply.code(501);
      return { error: "Learn mode requires HA agent mode" };
    }

    const body = request.body as {
      blueprintId?: string;
      configId?: string;
      identifier?: string;
      label?: string;
    };

    try {
      await agentClient.callService("switch_manager", "start_learning", {
        ...(body.blueprintId ? { blueprint_id: body.blueprintId } : {}),
        ...(body.configId ? { config_id: body.configId } : {}),
        ...(body.identifier ? { identifier: body.identifier } : {}),
        ...(body.label ? { label: body.label } : {})
      });
      const store = await loadLearningStore(agentClient, config);
      return {
        activeSession: normalizeLearningSession(store.active_session)
      };
    } catch (error) {
      request.log.error(error);
      reply.code(400);
      return { error: error instanceof Error ? error.message : String(error) };
    }
  });

  app.post("/api/learning/stop", async (request, reply) => {
    const backend = preferredBackend(agentClient, wsClient);
    if (backend !== "agent") {
      reply.code(501);
      return { error: "Learn mode requires HA agent mode" };
    }

    try {
      await agentClient.callService("switch_manager", "stop_learning");
      return { ok: true };
    } catch (error) {
      request.log.error(error);
      reply.code(400);
      return { error: error instanceof Error ? error.message : String(error) };
    }
  });

  app.post("/api/learning/clear", async (request, reply) => {
    const backend = preferredBackend(agentClient, wsClient);
    if (backend !== "agent") {
      reply.code(501);
      return { error: "Learn mode requires HA agent mode" };
    }

    try {
      await agentClient.callService("switch_manager", "clear_learning_library");
      return { ok: true };
    } catch (error) {
      request.log.error(error);
      reply.code(400);
      return { error: error instanceof Error ? error.message : String(error) };
    }
  });

  app.get("/api/devices/:id/properties", async (request, reply) => {
    const backend = preferredBackend(agentClient, wsClient);
    if (backend !== "agent") {
      reply.code(501);
      return { error: "Property inspection requires HA agent mode" };
    }

    try {
      const params = request.params as { id: string };
      const snapshot = await buildSnapshotWithAgent(agentClient, config);
      return await loadDevicePropertiesWithAgent(agentClient, snapshot, params.id);
    } catch (error) {
      request.log.error(error);
      reply.code(400);
      return { error: error instanceof Error ? error.message : String(error) };
    }
  });

  app.post("/api/entities/control", async (request, reply) => {
    const backend = preferredBackend(agentClient, wsClient);
    if (backend !== "agent") {
      reply.code(501);
      return { error: "Property editing requires HA agent mode" };
    }

    const body = request.body as { entityId?: string; action?: string; value?: unknown };
    if (typeof body?.entityId !== "string" || typeof body?.action !== "string") {
      reply.code(400);
      return { error: "entityId and action are required" };
    }

    try {
      await callEntityControlWithAgent(agentClient, body.entityId, body.action, body.value);
      return { ok: true };
    } catch (error) {
      request.log.error(error);
      reply.code(400);
      return { error: error instanceof Error ? error.message : String(error) };
    }
  });

  app.post("/api/configs/save", async (request, reply) => {
    const body = request.body as SaveConfigRequest | undefined;
    if (!body || !isRecord(body.config)) {
      reply.code(400);
      return { error: "Invalid config payload" };
    }

    const draft = body.config as SwitchManagerConfig;
    const backend = preferredBackend(agentClient, wsClient);

    try {
      if (backend === "agent") {
        const savedConfig = await saveConfigWithAgent(agentClient, config, draft);
        return {
          ok: true,
          config: savedConfig
        };
      }

      if (backend === "websocket") {
        const result = await wsClient.call<{ config: Record<string, unknown> }>({
          type: "switch_manager/config/save",
          config: normalizeConfigForSave(draft)
        });
        return {
          ok: true,
          config: normalizeConfig(isRecord(result.config) ? result.config : {})
        };
      }

      reply.code(503);
      return { error: "Neither HA_AGENT_KEY nor HA_TOKEN is configured" };
    } catch (error) {
      request.log.error(error);
      reply.code(400);
      return {
        error: error instanceof Error ? error.message : String(error)
      };
    }
  });

  app.put("/api/configs/:id/enabled", async (request, reply) => {
    const params = request.params as { id: string };
    const body = request.body as { enabled?: unknown };
    if (typeof body?.enabled !== "boolean") {
      reply.code(400);
      return { error: "enabled must be a boolean" };
    }

    const backend = preferredBackend(agentClient, wsClient);

    try {
      if (backend === "agent") {
        return await setConfigEnabledWithAgent(agentClient, config, params.id, body.enabled);
      }
      if (backend === "websocket") {
        return await wsClient.call({
          type: "switch_manager/config/enabled",
          config_id: params.id,
          enabled: body.enabled
        });
      }

      reply.code(503);
      return { error: "Neither HA_AGENT_KEY nor HA_TOKEN is configured" };
    } catch (error) {
      request.log.error(error);
      reply.code(400);
      return {
        error: error instanceof Error ? error.message : String(error)
      };
    }
  });

  app.delete("/api/configs/:id", async (request, reply) => {
    const params = request.params as { id: string };
    const backend = preferredBackend(agentClient, wsClient);

    try {
      if (backend === "agent") {
        return await deleteConfigWithAgent(agentClient, config, params.id);
      }
      if (backend === "websocket") {
        return await wsClient.call({
          type: "switch_manager/config/delete",
          config_id: params.id
        });
      }

      reply.code(503);
      return { error: "Neither HA_AGENT_KEY nor HA_TOKEN is configured" };
    } catch (error) {
      request.log.error(error);
      reply.code(400);
      return {
        error: error instanceof Error ? error.message : String(error)
      };
    }
  });

  app.get("/api/blueprints/:id/image", async (request, reply) => {
    const params = request.params as { id: string };
    const localImage = await serveLocalBlueprintImage(config.blueprintImageDir, params.id);
    if (localImage) {
      reply.header("Content-Type", "image/png");
      reply.header("Cache-Control", "public, max-age=300");
      return localImage;
    }

    if (wsClient.hasToken) {
      const response = await wsClient.fetch(`/assets/switch_manager/${encodeURIComponent(params.id)}.png`);
      if (response.ok) {
        reply.header("Content-Type", response.headers.get("content-type") ?? "image/png");
        reply.header("Cache-Control", "public, max-age=300");
        return Buffer.from(await response.arrayBuffer());
      }
    }

    reply.code(404);
    return { error: `Blueprint image not available for ${params.id}` };
  });

  if (await fileExists(webRoot)) {
    await app.register(fastifyStatic, {
      root: webRoot,
      prefix: "/"
    });

    app.setNotFoundHandler(async (request, reply) => {
      if (request.url.startsWith("/api/")) {
        reply.code(404);
        return { error: "Not found" };
      }
      return reply.sendFile("index.html");
    });
  }

  await app.listen({ host: config.host, port: config.port });
}

void main();
