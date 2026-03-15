import {
  type AreaSummary,
  type DeviceSummary,
  type EntitySummary,
  type StudioSnapshot,
  type SwitchManagerBlueprint
} from "../shared/types.js";
import { isRecord, asString, asNullableString, asArray } from "../shared/utils.js";
import type { HomeAssistantClient } from "./haClient.js";
import { normalizeBlueprint, normalizeConfigFromStore } from "./normalization.js";
import {
  uniqueStrings,
  flattenStringValues,
  hydrateConfigLinks,
  type RegistryEntityLink,
  type RegistryDeviceLink
} from "./resolution.js";

export async function buildSnapshotWithWebsocket(client: HomeAssistantClient): Promise<StudioSnapshot> {
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

export function buildSnapshotFromRawData(input: {
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
          (isRecord(state?.attributes) ? asString(state.attributes.friendly_name) : "") ||
          entity.name ||
          entity.originalName ||
          entity.entityId,
        domain: entity.domain,
        areaId: entity.areaId,
        deviceId: entity.deviceId,
        state: asNullableString(state?.state),
        icon: asNullableString(rawEntity?.icon),
        entityPicture: state && isRecord(state.attributes) ? asNullableString(state.attributes.entity_picture) : null,
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
      entityIds: device.entityIds,
      identifiers: device.identifiers
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
