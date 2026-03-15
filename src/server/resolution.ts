import {
  type SwitchManagerBlueprint,
  type SwitchManagerConfig
} from "../shared/types.js";
import { isRecord, asString, asNullableString, cloneValue } from "../shared/utils.js";

export interface RegistryEntityLink {
  entityId: string;
  deviceId: string | null;
  areaId: string | null;
  uniqueId: string | null;
  name: string | null;
  originalName: string | null;
  platform: string | null;
  domain: string;
}

export interface RegistryDeviceLink {
  id: string;
  name: string;
  nameByUser: string | null;
  areaId: string | null;
  manufacturer: string | null;
  model: string | null;
  identifiers: string[];
  entityIds: string[];
}

export function uniqueStrings(values: Array<string | null | undefined>): string[] {
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

export function flattenStringValues(value: unknown): string[] {
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

export function normalizeComparableName(value: string | null | undefined): string {
  return (value ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function isZwaveBlueprint(blueprint: SwitchManagerBlueprint | null | undefined): boolean {
  const haystack = `${blueprint?.id ?? ""} ${blueprint?.name ?? ""} ${blueprint?.service ?? ""} ${blueprint?.eventType ?? ""}`.toLowerCase();
  return haystack.includes("zwave") || haystack.includes("z-wave");
}

export function isLutronBlueprint(blueprint: SwitchManagerBlueprint | null | undefined): boolean {
  const haystack = `${blueprint?.id ?? ""} ${blueprint?.name ?? ""} ${blueprint?.service ?? ""} ${blueprint?.eventType ?? ""}`.toLowerCase();
  return haystack.includes("lutron");
}

export function extractMqttFriendlyName(identifier: string): string | null {
  const match = identifier.match(/^zigbee2mqtt\/(.+?)\/[^/]+$/i);
  if (!match?.[1]) {
    return null;
  }
  return match[1].trim() || null;
}

export function matchesZwaveNodeIdentifier(value: string, nodeId: string): boolean {
  if (!/^\d+$/.test(nodeId.trim())) {
    return false;
  }
  const pattern = new RegExp(`(?:^|[-.])${escapeRegExp(nodeId.trim())}(?:$|[-.])`);
  return pattern.test(value);
}

export function selectPrimaryEntity(entities: RegistryEntityLink[]): RegistryEntityLink | null {
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

export function resolveAreaFromLinks(
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

export function findDirectEntityMatch(
  identifier: string,
  entityLinks: RegistryEntityLink[]
): RegistryEntityLink | null {
  const matches = entityLinks.filter(
    (entity) => entity.entityId === identifier || entity.uniqueId === identifier
  );
  return matches.length === 1 ? matches[0] : null;
}

export function resolveDeviceForConfig(
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

export function hydrateConfigLinks(
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
      ? (cloneValue(configEntry.metadata) as SwitchManagerConfig["metadata"])
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
