import { readFile, writeFile } from "node:fs/promises";

import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

/** Simple in-process mutex to serialize automations.yaml writes. */
let automationsFileLock: Promise<void> = Promise.resolve();
function withAutomationsLock<T>(fn: () => Promise<T>): Promise<T> {
  const next = automationsFileLock.then(fn, fn);
  automationsFileLock = next.then(() => {}, () => {});
  return next;
}

import {
  type AutomationSummary,
  type DevicePropertiesResponse,
  type DeviceSummary,
  type DiscoveryCandidate,
  type LearnedEvent,
  type LearningSession,
  type PropertyControlType,
  type PropertyEntity,
  type SequenceStep,
  type StudioSnapshot,
  type SwitchManagerBlueprint,
  type SwitchManagerConfig
} from "../shared/types.js";
import { isRecord, asString, asNullableString, asNumber, asBoolean, asArray, asList } from "../shared/utils.js";
import { resolveHaPath } from "./blueprintUtils.js";
import type { StudioConfig } from "./config.js";
import type { HomeAssistantClient } from "./haClient.js";

export interface SwitchManagerLearningStoreFile {
  data?: {
    active_session?: Record<string, unknown> | null;
    library?: Array<Record<string, unknown>>;
  };
  active_session?: Record<string, unknown> | null;
  library?: Array<Record<string, unknown>>;
}

export async function loadLearningStore(config: StudioConfig): Promise<SwitchManagerLearningStoreFile> {
  const filePath = resolveHaPath(config, config.switchManagerLearningStorePath);
  if (!filePath) {
    return { active_session: null, library: [] };
  }

  try {
    const content = await readFile(filePath, "utf8");
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

export function formatTimestamp(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return new Date(value * 1000).toISOString();
  }
  if (typeof value === "string" && value.trim()) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : date.toISOString();
  }
  return null;
}

export function normalizeLearningSession(raw: Record<string, unknown> | null | undefined): LearningSession | null {
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

export function normalizeLearnedEvent(raw: Record<string, unknown>): LearnedEvent {
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

export function getNestedValue(record: Record<string, unknown>, path: string): unknown {
  return path.split(".").reduce<unknown>((current, key) => {
    if (!current || typeof current !== "object") {
      return undefined;
    }
    return (current as Record<string, unknown>)[key];
  }, record);
}

export function pressCountFromTitle(title: string | null): number | null {
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

export function normalizeAutomationEntry(
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

export function stableAutomationId(raw: Record<string, unknown>): string {
  const alias = asString(raw.alias);
  const description = asString(raw.description);
  const basis = `${alias}|${description}`.trim() || JSON.stringify(raw);
  return `automation-${basis.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "generated"}`;
}

export function inferAutomationMatch(
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

export async function loadAutomations(
  config: StudioConfig,
  snapshot: StudioSnapshot | null
): Promise<AutomationSummary[]> {
  const filePath = resolveHaPath(config, config.automationsPath);
  if (!filePath) {
    throw new Error("HA_CONFIG_PATH is not configured");
  }

  const content = await readFile(filePath, "utf8");
  const parsed = parseYaml(content) as unknown;
  const entries = Array.isArray(parsed) ? parsed : [];
  return entries
    .filter((entry): entry is Record<string, unknown> => isRecord(entry))
    .map((entry) => normalizeAutomationEntry(entry, snapshot))
    .sort((left, right) => left.alias.localeCompare(right.alias));
}

export function inferSuggestedIdentifier(device: DeviceSummary): string {
  const ids = device.identifiers;

  // ZHA: contains "zha" and an IEEE address like 00:11:22:33:44:55:66:77
  if (ids.includes("zha")) {
    const ieee = ids.find((id) => /^([0-9a-f]{2}:){7}[0-9a-f]{2}$/i.test(id));
    if (ieee) {
      return ieee;
    }
  }

  // Z-Wave JS: contains "zwave_js" and a home_id-node_id string
  if (ids.includes("zwave_js")) {
    const nodeRef = ids.find((id) => /^\d+-\d+$/.test(id));
    if (nodeRef) {
      // SM z-wave blueprints use the node_id (the part after the last dash)
      const nodeId = nodeRef.split("-").at(-1);
      if (nodeId) {
        return nodeId;
      }
    }
  }

  // Matter: contains "matter" and a numeric node id
  if (ids.includes("matter")) {
    const nodeId = ids.find((id) => /^\d+$/.test(id) && id.length > 4);
    if (nodeId) {
      return nodeId;
    }
  }

  // MQTT / Zigbee2MQTT: HA marks Z2M devices with "mqtt" as the integration domain in their identifiers
  if (ids.includes("mqtt") && device.name) {
    return `zigbee2mqtt/${device.name}/action`;
  }

  return "";
}

export function probableProtocolFromStrings(...values: Array<string | null | undefined>): string | null {
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

export function tokenize(value: string | null | undefined): string[] {
  return (value ?? "")
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .filter((entry) => entry.length >= 2);
}

export function scoreBlueprintSuggestion(device: DeviceSummary, blueprint: SwitchManagerBlueprint): number {
  const deviceTokens = new Set([
    ...tokenize(device.name),
    ...tokenize(device.manufacturer),
    ...tokenize(device.model)
  ]);
  const blueprintTokens = [...tokenize(blueprint.id), ...tokenize(blueprint.name), ...tokenize(blueprint.service)];
  return blueprintTokens.reduce((score, token) => score + (deviceTokens.has(token) ? 1 : 0), 0);
}

export function automationReferencesEntities(haystack: string, entityIds: string[]): boolean {
  return entityIds.some((entityId) => haystack.includes(entityId));
}

function stringifyAutomation(automation: AutomationSummary): string {
  return JSON.stringify({
    triggers: automation.triggers,
    conditions: automation.conditions,
    actions: automation.actions
  });
}

export function buildDiscoveryCandidates(
  snapshot: StudioSnapshot,
  automations: AutomationSummary[]
): DiscoveryCandidate[] {
  const automationHaystacks = automations.map((automation) => ({
    id: automation.id,
    haystack: stringifyAutomation(automation)
  }));
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
      const relatedAutomationIds = automationHaystacks
        .filter((entry) => automationReferencesEntities(entry.haystack, device.entityIds))
        .slice(0, 8)
        .map((entry) => entry.id);

      return {
        id: device.id,
        name: device.name,
        manufacturer: device.manufacturer,
        model: device.model,
        areaId: device.areaId,
        deviceId: device.id,
        entityIds: device.entityIds,
        identifiers: device.identifiers,
        probableProtocol,
        suggestedIdentifier: inferSuggestedIdentifier(device),
        suggestedBlueprintIds,
        relatedAutomationIds
      };
    })
    .filter((candidate) => {
      const hasControllableLikeEntity = candidate.entityIds.some((entityId) =>
        ["event.", "button.", "switch.", "select.", "number.", "binary_sensor."].some((prefix) =>
          entityId.startsWith(prefix)
        ) ||
        /action|scene|button|switch|remote|dimmer/i.test(entityId)
      );
      return hasControllableLikeEntity || candidate.suggestedBlueprintIds.length > 0 || candidate.relatedAutomationIds.length > 0;
    })
    .sort((left, right) => {
      const rightScore = right.suggestedBlueprintIds.length + right.relatedAutomationIds.length;
      const leftScore = left.suggestedBlueprintIds.length + left.relatedAutomationIds.length;
      return rightScore - leftScore || left.name.localeCompare(right.name);
    });
}

export function inferPropertyControlType(state: Record<string, unknown>): {
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

export function normalizePropertyEntity(state: Record<string, unknown>): PropertyEntity {
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

export async function loadDeviceProperties(
  wsClient: HomeAssistantClient,
  snapshot: StudioSnapshot,
  deviceId: string
): Promise<DevicePropertiesResponse> {
  const device = snapshot.devices.find((entry) => entry.id === deviceId) ?? null;
  if (!device) {
    return { device: null, probableProtocol: null, entities: [] };
  }

  const allStates = await wsClient.call<Array<Record<string, unknown>>>({ type: "get_states" });
  const stateMap = new Map(
    allStates
      .filter((s): s is Record<string, unknown> => isRecord(s) && typeof s.entity_id === "string")
      .map((s) => [s.entity_id as string, s])
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

export function buildExportAutomation(
  configEntry: SwitchManagerConfig,
  blueprint: SwitchManagerBlueprint,
  buttonIndex: number,
  actionIndex: number,
  pressCount: number,
  virtual: boolean,
  sequence: SequenceStep[],
  alias?: string,
  mode?: string
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
      virtual
        ? {
            trigger: "event",
            event_type: "switch_manager_virtual_action",
            event_data: {
              switch_id: configEntry.id,
              button: buttonIndex,
              press_count: pressCount
            }
          }
        : (() => {
            const eventData: Record<string, unknown> = {};
            if (blueprint.identifierKey) {
              eventData[blueprint.identifierKey] = configEntry.identifier;
            }
            for (const cond of blueprint.buttons[buttonIndex]?.conditions ?? []) {
              eventData[cond.key] = cond.value;
            }
            for (const cond of blueprint.buttons[buttonIndex]?.actions[actionIndex]?.conditions ?? []) {
              eventData[cond.key] = cond.value;
            }
            return {
              trigger: "event",
              event_type: blueprint.eventType,
              ...(Object.keys(eventData).length > 0 ? { event_data: eventData } : {})
            };
          })()
    ],
    conditions: [],
    actions: sequence,
    mode: mode ?? "single"
  };
}

export async function exportAutomation(
  wsClient: HomeAssistantClient,
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

  const buttonEntry = configEntry.buttons[payload.buttonIndex];
  if (!buttonEntry) {
    throw new Error(`Button index ${payload.buttonIndex} is out of range`);
  }

  const sequence = virtual
    ? buttonEntry.virtualActions.find((entry) => entry.pressCount === pressCount)?.sequence ?? []
    : buttonEntry.actions[payload.actionIndex]?.sequence ?? [];

  if (!virtual && !buttonEntry.actions[payload.actionIndex]) {
    throw new Error(`Action index ${payload.actionIndex} is out of range`);
  }

  if (!sequence.length) {
    throw new Error("Selected action has no sequence steps to export");
  }

  const actionMode = virtual
    ? buttonEntry.virtualActions.find((entry) => entry.pressCount === pressCount)?.mode
    : buttonEntry.actions[payload.actionIndex]?.mode;

  const exported = buildExportAutomation(
    configEntry,
    blueprint,
    payload.buttonIndex,
    payload.actionIndex,
    pressCount,
    virtual,
    sequence,
    payload.alias,
    actionMode ?? undefined
  );

  const filePath = resolveHaPath(config, config.automationsPath);
  if (!filePath) {
    throw new Error("HA_CONFIG_PATH is not configured");
  }

  await withAutomationsLock(async () => {
    let existing: unknown[] = [];
    try {
      const currentContent = await readFile(filePath, "utf8");
      const parsed = parseYaml(currentContent);
      if (Array.isArray(parsed)) {
        existing = parsed;
      }
    } catch {
      // File missing or unparseable — start fresh
    }
    existing.push(exported);
    await writeFile(filePath, stringifyYaml(existing), "utf8");
  });
  await wsClient.callService("automation", "reload");

  return normalizeAutomationEntry(exported, snapshot);
}
