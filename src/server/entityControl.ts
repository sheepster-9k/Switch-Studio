import type { SwitchManagerConfig } from "../shared/types.js";
import { isRecord, asNullableString } from "../shared/utils.js";
import type { HomeAssistantClient } from "./haClient.js";

export const CONTROLLABLE_DOMAINS = new Set([
  "switch", "light", "fan", "cover", "lock", "climate", "media_player",
  "input_boolean", "input_number", "input_select", "input_button",
  "button", "number", "select", "scene", "script", "vacuum", "siren"
]);

export async function callEntityControl(
  wsClient: HomeAssistantClient,
  entityId: string,
  action: string,
  value?: unknown
): Promise<void> {
  const domain = entityId.split(".")[0];
  if (!CONTROLLABLE_DOMAINS.has(domain)) {
    throw new Error(`Domain "${domain}" is not allowed for entity control`);
  }
  const target = { entity_id: entityId };

  if (action === "toggle" || action === "turn_on" || action === "turn_off") {
    await wsClient.callService(domain, action, undefined, target);
    return;
  }
  if (action === "press") {
    await wsClient.callService(domain, "press", undefined, target);
    return;
  }
  if (action === "select_option") {
    await wsClient.callService(domain, "select_option", { option: value }, target);
    return;
  }
  if (action === "set_value") {
    await wsClient.callService(domain, "set_value", { value }, target);
    return;
  }

  throw new Error(`Unsupported control action ${action}`);
}

export function managedAreaIdFromConfig(configEntry: SwitchManagerConfig): string | null | undefined {
  if (!isRecord(configEntry.metadata) || configEntry.metadata.areaManaged !== true) {
    return undefined;
  }
  return asNullableString(configEntry.metadata.areaId) ?? null;
}

export async function syncConfigArea(
  wsClient: HomeAssistantClient,
  configEntry: SwitchManagerConfig
): Promise<void> {
  const areaId = managedAreaIdFromConfig(configEntry);
  if (areaId === undefined) {
    return;
  }

  if (configEntry.deviceId) {
    await wsClient.updateDeviceArea(configEntry.deviceId, areaId);
    return;
  }

  const entityId =
    configEntry.primaryEntityId ??
    configEntry.propertyEntityIds.find((entry) => entry.includes(".")) ??
    null;

  if (entityId) {
    await wsClient.updateEntityArea(entityId, areaId);
  }
}
