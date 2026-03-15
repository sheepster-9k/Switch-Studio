import { stringify as stringifyYaml } from "yaml";

import type { JsonMap, SequenceStep, StudioSnapshot, TargetKind } from "../../../shared/types";
import { cloneValue } from "../../../shared/utils";
import { cloneStep, isRecord, matchesSearch } from "../../helpers";

// ── Types ──

export type StepTemplateKind =
  | "action"
  | "condition"
  | "delay"
  | "event"
  | "if"
  | "parallel"
  | "raw"
  | "sequence"
  | "stop"
  | "variables"
  | "wait_for_trigger"
  | "choose";

export type StepKind =
  | StepTemplateKind
  | "device_action"
  | "repeat"
  | "unsupported"
  | "wait_template";

export type ConditionType =
  | "and"
  | "not"
  | "numeric_state"
  | "or"
  | "raw"
  | "state"
  | "sun"
  | "template"
  | "time"
  | "trigger"
  | "zone";

export type TriggerType = "event" | "homeassistant" | "raw" | "state" | "template" | "time";

export interface TargetOption {
  detail: string;
  id: string;
  label: string;
}

export interface DurationParts {
  hours: number;
  milliseconds: number;
  minutes: number;
  seconds: number;
}

export const ZERO_DURATION: Readonly<DurationParts> = Object.freeze({
  hours: 0,
  milliseconds: 0,
  minutes: 0,
  seconds: 0
});

// ── Classifiers ──

export function classifyStep(step: SequenceStep): StepKind {
  if (typeof step.action === "string") {
    return "action";
  }
  if (Array.isArray(step.choose)) {
    return "choose";
  }
  if (Array.isArray(step.if)) {
    return "if";
  }
  if (step.delay !== undefined) {
    return "delay";
  }
  if (typeof step.condition === "string") {
    return "condition";
  }
  if (Array.isArray(step.parallel)) {
    return "parallel";
  }
  if (Array.isArray(step.sequence)) {
    return "sequence";
  }
  if (step.variables !== undefined) {
    return "variables";
  }
  if (step.wait_for_trigger !== undefined) {
    return "wait_for_trigger";
  }
  if (step.wait_template !== undefined) {
    return "wait_template";
  }
  if (step.stop !== undefined) {
    return "stop";
  }
  if (step.event !== undefined) {
    return "event";
  }
  if (step.repeat !== undefined) {
    return "repeat";
  }
  if (step.device_id && step.type && step.domain) {
    return "device_action";
  }
  return "unsupported";
}

export function classifyCondition(condition: SequenceStep): ConditionType {
  if (typeof condition.condition === "string") {
    if (
      condition.condition === "and" ||
      condition.condition === "not" ||
      condition.condition === "numeric_state" ||
      condition.condition === "or" ||
      condition.condition === "state" ||
      condition.condition === "sun" ||
      condition.condition === "template" ||
      condition.condition === "time" ||
      condition.condition === "trigger" ||
      condition.condition === "zone"
    ) {
      return condition.condition;
    }
  }
  return "raw";
}

export function classifyTrigger(trigger: SequenceStep): TriggerType {
  const type = typeof trigger.trigger === "string" ? trigger.trigger : typeof trigger.platform === "string" ? trigger.platform : "";
  if (type === "event" || type === "homeassistant" || type === "state" || type === "template" || type === "time") {
    return type;
  }
  return "raw";
}

export function isSupportedStepKind(kind: StepKind): kind is StepTemplateKind {
  return (
    kind === "action" ||
    kind === "choose" ||
    kind === "condition" ||
    kind === "delay" ||
    kind === "event" ||
    kind === "if" ||
    kind === "parallel" ||
    kind === "raw" ||
    kind === "sequence" ||
    kind === "stop" ||
    kind === "variables" ||
    kind === "wait_for_trigger"
  );
}

// ── Template builders ──

export function createStepTemplate(kind: StepTemplateKind): SequenceStep {
  switch (kind) {
    case "action":
      return createServiceTemplate();
    case "condition":
      return createConditionTemplate("state");
    case "delay":
      return { delay: { seconds: 1 } };
    case "event":
      return { event: "switch_manager_action", event_data: {} };
    case "if":
      return { if: [createConditionTemplate("state")], then: [createServiceTemplate()], else: [] };
    case "parallel":
      return { parallel: [createServiceTemplate(), createServiceTemplate("script.turn_on")] };
    case "sequence":
      return { sequence: [createServiceTemplate()] };
    case "stop":
      return { stop: "Stop sequence" };
    case "variables":
      return { variables: {} };
    case "wait_for_trigger":
      return { wait_for_trigger: [createTriggerTemplate("state")], timeout: { seconds: 30 } };
    case "choose":
      return { choose: [createChooseBranchTemplate()], default: [] };
    case "raw":
    default:
      return {};
  }
}

export function createServiceTemplate(service = "light.toggle"): SequenceStep {
  return {
    action: service,
    data: {},
    metadata: {},
    target: {}
  };
}

export function createChooseBranchTemplate(): Record<string, unknown> {
  return {
    alias: "Branch 1",
    conditions: [createConditionTemplate("state")],
    sequence: [createServiceTemplate()]
  };
}

export function createConditionTemplate(type: ConditionType): SequenceStep {
  switch (type) {
    case "template":
      return { condition: "template", value_template: "{{ true }}" };
    case "numeric_state":
      return { condition: "numeric_state", entity_id: "", above: "0" };
    case "time":
      return { condition: "time", after: "18:00:00", before: "23:00:00" };
    case "trigger":
      return { condition: "trigger", id: "trigger_id" };
    case "and":
      return { condition: "and", conditions: [createConditionTemplate("state")] };
    case "or":
      return { condition: "or", conditions: [createConditionTemplate("state"), createConditionTemplate("template")] };
    case "not":
      return { condition: "not", conditions: [createConditionTemplate("state")] };
    case "zone":
      return { condition: "zone", entity_id: "person.someone", zone: "zone.home", event: "enter" };
    case "sun":
      return { condition: "sun", after: "sunset" };
    case "raw":
      return {};
    case "state":
    default:
      return { condition: "state", entity_id: "", state: "on" };
  }
}

export function createTriggerTemplate(type: TriggerType): SequenceStep {
  switch (type) {
    case "event":
      return { trigger: "event", event_type: "timer.finished", event_data: {} };
    case "homeassistant":
      return { trigger: "homeassistant", event: "start" };
    case "template":
      return { trigger: "template", value_template: "{{ true }}" };
    case "time":
      return { trigger: "time", at: "23:00:00" };
    case "raw":
      return {};
    case "state":
    default:
      return { trigger: "state", entity_id: "", to: "on" };
  }
}

// ── YAML helpers ──

export function formatYaml(value: unknown): string {
  if (value === undefined) {
    return "{}\n";
  }
  const rendered = stringifyYaml(value);
  return rendered.trim().length > 0 ? rendered : "{}\n";
}

export function parseYamlRecord(parsed: unknown): Record<string, unknown> {
  if (!isRecord(parsed)) {
    throw new Error("YAML must resolve to an object.");
  }
  return parsed;
}

export function parseSequenceStep(parsed: unknown): SequenceStep {
  if (!isRecord(parsed)) {
    throw new Error("Step YAML must resolve to an object.");
  }
  return parsed;
}

// ── Field helpers ──

export function preserveCommonStepFields(current: SequenceStep, next: SequenceStep): SequenceStep {
  const merged = cloneStep(next);
  (["alias", "continue_on_error", "enabled", "metadata"] as const).forEach((key) => {
    if (current[key] !== undefined) {
      merged[key] = cloneValue(current[key]);
    }
  });
  return merged;
}

export function setOptionalStringField<T extends Record<string, unknown>>(entry: T, key: string, value: string): T {
  const next = cloneValue(entry);
  if (value.trim()) {
    next[key] = value;
  } else {
    delete next[key];
  }
  return next;
}

export function setBooleanField<T extends Record<string, unknown>>(entry: T, key: string, value: boolean, defaultValue: boolean): T {
  const next = cloneValue(entry);
  if (value === defaultValue) {
    delete next[key];
  } else {
    next[key] = value;
  }
  return next;
}

export function setObjectField<T extends Record<string, unknown>>(entry: T, key: string, value: Record<string, unknown>): T {
  const next = cloneValue(entry);
  if (Object.keys(value).length === 0) {
    delete next[key];
  } else {
    next[key] = value;
  }
  return next;
}

export function setScalarField<T extends Record<string, unknown>>(entry: T, key: string, value: unknown): T {
  const next = cloneValue(entry);
  if (value === undefined || value === null || value === "") {
    delete next[key];
  } else {
    next[key] = value;
  }
  return next;
}

export function setSequenceField<T extends Record<string, unknown>>(entry: T, key: string, sequence: SequenceStep[]): T {
  const next = cloneValue(entry);
  next[key] = sequence.map((step) => cloneStep(step));
  return next;
}

export function setListishField<T extends Record<string, unknown>>(entry: T, key: string, value: string): T {
  const next = cloneValue(entry);
  const listish = parseListish(value);
  if (listish === undefined) {
    delete next[key];
  } else {
    next[key] = listish;
  }
  return next;
}

export function setYamlValueField<T extends Record<string, unknown>>(entry: T, key: string, value: unknown): T {
  const next = cloneValue(entry);
  if (value === undefined) {
    delete next[key];
  } else {
    next[key] = value;
  }
  return next;
}

// ── Parsing helpers ──

export function parseDuration(value: unknown): DurationParts | null {
  if (value === undefined || value === null) {
    return ZERO_DURATION;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return { ...ZERO_DURATION, seconds: value };
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    const match = trimmed.match(/^(?:(\d+):)?(\d{1,2}):(\d{1,2})(?:\.(\d{1,3}))?$/);
    if (!match) {
      return null;
    }
    const hasHours = match[1] !== undefined;
    return {
      hours: hasHours ? Number.parseInt(match[1] ?? "0", 10) : 0,
      milliseconds: Number.parseInt((match[4] ?? "0").padEnd(3, "0"), 10),
      minutes: Number.parseInt(match[2], 10),
      seconds: Number.parseInt(match[3], 10)
    };
  }
  if (isRecord(value)) {
    return {
      hours: coerceNumericField(value.hours),
      milliseconds: coerceNumericField(value.milliseconds),
      minutes: coerceNumericField(value.minutes),
      seconds: coerceNumericField(value.seconds)
    };
  }
  return null;
}

export function coerceNumericField(value: unknown): number {
  if (value === undefined || value === null || value === "") {
    return 0;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && /^\d+$/.test(value.trim())) {
    return Number.parseInt(value, 10);
  }
  return 0;
}

export function durationToValue(parts: DurationParts): JsonMap {
  return {
    hours: Math.max(0, parts.hours),
    milliseconds: Math.max(0, parts.milliseconds),
    minutes: Math.max(0, parts.minutes),
    seconds: Math.max(0, parts.seconds)
  };
}

// ── Sequence manipulation ──

export function moveSequenceEntry<T>(items: T[], fromIndex: number, toIndex: number, onChange: (next: T[], nextIndex?: number) => void): void {
  if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0 || fromIndex >= items.length || toIndex >= items.length) {
    return;
  }
  const next = items.map((item) => cloneValue(item));
  const [moved] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, moved);
  onChange(next, toIndex);
}

export function moveArrayEntry<T extends Record<string, unknown>>(items: T[], fromIndex: number, toIndex: number, onChange: (next: T[], nextIndex?: number) => void): void {
  moveSequenceEntry(items, fromIndex, toIndex, onChange);
}

export function asSequence(value: unknown): SequenceStep[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((entry): entry is SequenceStep => isRecord(entry)).map((entry) => cloneStep(entry));
}

// ── Text conversion ──

export function listishToText(value: unknown): string {
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry)).join(", ");
  }
  if (typeof value === "string" || typeof value === "number") {
    return String(value);
  }
  return "";
}

export function parseListish(value: string): string | string[] | undefined {
  const parts = value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (parts.length === 0) {
    return undefined;
  }
  if (parts.length === 1) {
    return parts[0];
  }
  return parts;
}

export function scalarToText(value: unknown): string {
  if (value === undefined || value === null) {
    return "";
  }
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return "";
}

// ── Summaries ──

export function summarizeCondition(condition: SequenceStep): string {
  const type = classifyCondition(condition);
  if (type === "state") {
    return `state ${listishToText(condition.entity_id) || "entity"} = ${listishToText(condition.state) || "state"}`;
  }
  if (type === "template") {
    return "template condition";
  }
  if (type === "numeric_state") {
    return `numeric ${listishToText(condition.entity_id) || "entity"}`;
  }
  if (type === "trigger") {
    return `trigger ${listishToText(condition.id) || "id"}`;
  }
  if (type === "and" || type === "or" || type === "not") {
    return `${type.toUpperCase()} group`;
  }
  return "custom condition";
}

export function summarizeChooseOption(option: Record<string, unknown>, index: number): string {
  const conditions = asSequence(option.conditions);
  if (conditions.length === 0) {
    return `Option ${index + 1}: No conditions`;
  }
  if (conditions.length === 1) {
    return `Option ${index + 1}: If ${summarizeCondition(conditions[0])}`;
  }
  return `Option ${index + 1}: If ${conditions.length} conditions match`;
}

export function summarizeTrigger(trigger: SequenceStep): string {
  const type = classifyTrigger(trigger);
  if (type === "state") {
    return `state ${listishToText(trigger.entity_id) || "entity"} -> ${listishToText(trigger.to) || "state"}`;
  }
  if (type === "event") {
    return `event ${typeof trigger.event_type === "string" ? trigger.event_type : "event"}`;
  }
  if (type === "time") {
    return `time ${typeof trigger.at === "string" ? trigger.at : "at"}`;
  }
  if (type === "homeassistant") {
    return `homeassistant ${typeof trigger.event === "string" ? trigger.event : "start"}`;
  }
  if (type === "template") {
    return "template trigger";
  }
  return "custom trigger";
}

// ── Target options ──

export function buildTargetOptions(snapshot: StudioSnapshot | null, targetKind: TargetKind, search: string): TargetOption[] {
  const trimmedSearch = search.trim().toLowerCase();
  if (!snapshot) {
    return [];
  }
  if (targetKind === "device") {
    return snapshot.devices
      .filter((device) =>
        !trimmedSearch
          ? true
          : [device.name, device.manufacturer ?? "", device.model ?? "", device.id].some((value) =>
              matchesSearch(value, trimmedSearch)
            )
      )
      .slice(0, 50)
      .map((device) => ({
        id: device.id,
        label: device.name,
        detail: [device.manufacturer, device.model].filter(Boolean).join(" / ") || device.id
      }));
  }
  if (targetKind === "area") {
    return snapshot.areas
      .filter((area) =>
        !trimmedSearch ? true : [area.name, area.id, ...area.aliases].some((value) => matchesSearch(value, trimmedSearch))
      )
      .slice(0, 50)
      .map((area) => ({
        id: area.id,
        label: area.name,
        detail: area.aliases.join(", ") || area.id
      }));
  }
  return snapshot.entities
    .filter((entity) =>
      !trimmedSearch
        ? !entity.disabled
        : [entity.name, entity.entityId, entity.domain, entity.state ?? ""].some((value) =>
            matchesSearch(value, trimmedSearch)
          )
    )
    .slice(0, 80)
    .map((entity) => ({
      id: entity.entityId,
      label: entity.name,
      detail: `${entity.entityId}${entity.state ? ` / ${entity.state}` : ""}`
    }));
}

export function pluralizeTargetKind(targetKind: TargetKind): string {
  if (targetKind === "entity") {
    return "entities";
  }
  if (targetKind === "area") {
    return "areas";
  }
  return "devices";
}

// ── UI helpers ──

export function stepKindPillClass(kind: StepKind): string {
  switch (kind) {
    case "action":
    case "device_action":
      return "pill--step-action";
    case "condition":
      return "pill--step-condition";
    case "delay":
    case "wait_for_trigger":
    case "wait_template":
      return "pill--step-delay";
    case "if":
    case "choose":
      return "pill--step-branch";
    case "event":
    case "variables":
    case "parallel":
    case "sequence":
      return "pill--step-event";
    case "stop":
      return "pill--step-stop";
    default:
      return "pill--muted";
  }
}
