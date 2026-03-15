import {
  type SequenceStep,
  type SwitchManagerBlueprint,
  type SwitchManagerConfig
} from "../shared/types.js";
import { isRecord, asString, asNullableString, asNumber, asBoolean, asArray } from "../shared/utils.js";

export function normalizeBlueprint(raw: Record<string, unknown>): SwitchManagerBlueprint {
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

  const explicitType = asNullableString(raw.type);
  let blueprintType: "switch" | "sensor";
  if (explicitType === "sensor") {
    blueprintType = "sensor";
  } else if (explicitType === "switch") {
    blueprintType = "switch";
  } else {
    // Infer from blueprint content: sensor blueprints have no positional button geometry
    // and their service/event_type contains sensor-domain keywords.
    const service = asString(raw.service).toLowerCase();
    const eventType = asString(raw.event_type).toLowerCase();
    const hasSensorKeyword =
      service.includes("binary_sensor") ||
      service.includes("motion") ||
      service.includes("occupancy") ||
      eventType.includes("binary_sensor") ||
      eventType.includes("motion") ||
      eventType.includes("occupancy");
    const hasGeometry = buttons.some(
      (b) => typeof b.x === "number" || typeof b.y === "number" || typeof b.d === "string"
    );
    blueprintType = !hasGeometry && hasSensorKeyword ? "sensor" : "switch";
  }

  return {
    id: asString(raw.id),
    name: asString(raw.name),
    service: asString(raw.service),
    eventType: asString(raw.event_type),
    identifierKey: asNullableString(raw.identifier_key),
    isMqtt: asBoolean(raw.is_mqtt, asString(raw.event_type) === "mqtt"),
    hasImage: asBoolean(raw.has_image),
    info: asNullableString(raw.info),
    blueprintType,
    buttons
  };
}

export function normalizeConfig(raw: Record<string, unknown>): SwitchManagerConfig {
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

export function normalizeConfigForSave(config: SwitchManagerConfig): Record<string, unknown> {
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

export function normalizeConfigFromStore(id: string, raw: Record<string, unknown>): SwitchManagerConfig {
  return normalizeConfig({ ...raw, id });
}
