import type {
  AreaSummary,
  DeviceSummary,
  DiscoveryCandidate,
  EntitySummary,
  SequenceStep,
  StudioSnapshot,
  SwitchManagerBlueprint,
  SwitchManagerBlueprintButton,
  SwitchManagerButtonLayoutOverride,
  SwitchManagerConfig,
  SwitchManagerGridSettings,
  SwitchManagerLayoutMetadata,
  SwitchManagerMetadata,
  TargetKind
} from "../shared/types";
import { cloneValue, isRecord, asNumber } from "../shared/utils";

export { isRecord };

export type WorkspaceMode = "editor" | "virtual" | "teach" | "automations" | "discovery" | "mmwave";
export type AutomationTarget = "native" | "virtual";
export type NoticeState = { kind: "error" | "success"; text: string };

export function cloneConfig(config: SwitchManagerConfig): SwitchManagerConfig {
  return cloneValue(config);
}

export function cloneStep(step: SequenceStep): SequenceStep {
  return cloneValue(step);
}

export function asArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((entry): entry is string => typeof entry === "string");
  }
  if (typeof value === "string" && value.trim()) {
    return [value];
  }
  return [];
}

export function compactTargetSelection(values: string[]): string | string[] | undefined {
  if (values.length === 0) {
    return undefined;
  }
  if (values.length === 1) {
    return values[0];
  }
  return values;
}

function chooseOptionCount(step: SequenceStep): number {
  return Array.isArray(step.choose) ? step.choose.length : 0;
}

export function summarizeStep(step: SequenceStep): string {
  if (typeof step.action === "string") {
    return step.action;
  }
  if (typeof step.delay === "number" || typeof step.delay === "string") {
    return `delay ${String(step.delay)}`;
  }
  if (typeof step.delay === "object" && step.delay) {
    return "delay";
  }
  if ("if" in step) {
    return "if / then / else";
  }
  if ("choose" in step) {
    const optionCount = chooseOptionCount(step);
    if (optionCount <= 1) {
      return "choose an option";
    }
    return `choose between ${optionCount} options`;
  }
  if ("parallel" in step) {
    return "parallel";
  }
  if ("sequence" in step) {
    return "grouped sequence";
  }
  if ("variables" in step) {
    return "variables";
  }
  if ("wait_for_trigger" in step) {
    return "wait for trigger";
  }
  if ("wait_template" in step) {
    return "wait template";
  }
  if ("repeat" in step) {
    return "repeat";
  }
  if ("stop" in step) {
    return typeof step.stop === "string" ? `stop: ${step.stop}` : "stop";
  }
  if ("event" in step) {
    return typeof step.event === "string" ? `event ${step.event}` : "event";
  }
  if ("condition" in step && typeof step.condition === "string") {
    return `${step.condition} condition`;
  }
  return Object.keys(step)[0] ?? "sequence step";
}

export function shouldDisplayStepAlias(step: SequenceStep): boolean {
  const alias = typeof step.alias === "string" ? step.alias.trim() : "";
  if (!alias) {
    return false;
  }

  const normalizedAlias = alias.toLowerCase();
  if (normalizedAlias === summarizeStep(step).toLowerCase()) {
    return false;
  }
  if (normalizedAlias === "choose branch") {
    return false;
  }
  if (/^branch \d+$/.test(normalizedAlias)) {
    return false;
  }
  return true;
}

export function countActiveActions(config: SwitchManagerConfig): number {
  return config.buttons
    .flatMap((button) => [...button.actions, ...button.virtualActions])
    .filter((action) => action.sequence.length > 0).length;
}

export function countTotalActions(config: SwitchManagerConfig): number {
  return config.buttons.flatMap((button) => [...button.actions, ...button.virtualActions]).length;
}

export function stepTargetKind(step: SequenceStep): TargetKind {
  if (isRecord(step.target)) {
    if (step.target.device_id) {
      return "device";
    }
    if (step.target.area_id) {
      return "area";
    }
  }
  return "entity";
}

export function selectedTargetIds(step: SequenceStep, kind: TargetKind): string[] {
  if (!isRecord(step.target)) {
    return [];
  }
  if (kind === "device") {
    return asArray(step.target.device_id);
  }
  if (kind === "area") {
    return asArray(step.target.area_id);
  }
  return asArray(step.target.entity_id);
}

export function updateStepTarget(step: SequenceStep, kind: TargetKind, values: string[]): SequenceStep {
  const next = cloneStep(step);
  if (!isRecord(next.target)) {
    next.target = {};
  }
  const target = next.target as Record<string, unknown>;
  delete target.entity_id;
  delete target.device_id;
  delete target.area_id;

  const compact = compactTargetSelection(values);
  if (!compact) {
    if (Object.keys(target).length === 0) {
      delete next.target;
    }
    return next;
  }

  if (kind === "device") {
    target.device_id = compact;
  } else if (kind === "area") {
    target.area_id = compact;
  } else {
    target.entity_id = compact;
  }
  next.target = target;
  return next;
}

const svgPathBoundsCache = new Map<
  string,
  {
    cx: number;
    cy: number;
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
  }
>();

function fallbackPathBounds(pathData: string): {
  cx: number;
  cy: number;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
} | null {
  const numbers = pathData.match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? [];
  const xs: number[] = [];
  const ys: number[] = [];
  for (let index = 0; index < numbers.length - 1; index += 2) {
    xs.push(numbers[index]);
    ys.push(numbers[index + 1]);
  }
  if (xs.length === 0 || ys.length === 0) {
    return null;
  }
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const x of xs) { if (x < minX) minX = x; if (x > maxX) maxX = x; }
  for (const y of ys) { if (y < minY) minY = y; if (y > maxY) maxY = y; }
  return {
    cx: minX + (maxX - minX) / 2,
    cy: minY + (maxY - minY) / 2,
    minX,
    minY,
    maxX,
    maxY
  };
}

function measureSvgPathBounds(pathData: string): {
  cx: number;
  cy: number;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
} | null {
  const cached = svgPathBoundsCache.get(pathData);
  if (cached) {
    return cached;
  }

  if (typeof document === "undefined") {
    const fallback = fallbackPathBounds(pathData);
    if (fallback) {
      svgPathBoundsCache.set(pathData, fallback);
    }
    return fallback;
  }

  let host: SVGSVGElement | null = null;

  try {
    host = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    host.setAttribute("aria-hidden", "true");
    host.setAttribute("focusable", "false");
    host.style.height = "0";
    host.style.left = "-10000px";
    host.style.opacity = "0";
    host.style.overflow = "hidden";
    host.style.pointerEvents = "none";
    host.style.position = "absolute";
    host.style.top = "-10000px";
    host.style.width = "0";

    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", pathData);
    host.append(path);
    (document.body ?? document.documentElement).append(host);

    const bbox = path.getBBox();

    if (bbox.width > 0 || bbox.height > 0) {
      const measured = {
        cx: bbox.x + bbox.width / 2,
        cy: bbox.y + bbox.height / 2,
        minX: bbox.x,
        minY: bbox.y,
        maxX: bbox.x + bbox.width,
        maxY: bbox.y + bbox.height
      };
      svgPathBoundsCache.set(pathData, measured);
      return measured;
    }
  } catch {
    // Fall through to the lightweight numeric fallback when SVG measurement is unavailable.
  } finally {
    host?.remove();
  }

  const fallback = fallbackPathBounds(pathData);
  if (fallback) {
    svgPathBoundsCache.set(pathData, fallback);
  }
  return fallback;
}

export function buttonBounds(button: SwitchManagerBlueprintButton): {
  cx: number;
  cy: number;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
} {
  if (typeof button.d === "string") {
    const measured = measureSvgPathBounds(button.d);
    if (measured) {
      return measured;
    }
  }

  if (typeof button.height === "number") {
    const minX = button.x ?? 0;
    const minY = button.y ?? 0;
    const maxX = minX + (button.width ?? 0);
    const maxY = minY + button.height;
    return {
      cx: minX + (button.width ?? 0) / 2,
      cy: minY + button.height / 2,
      minX,
      minY,
      maxX,
      maxY
    };
  }

  const radius = (button.width ?? 40) / 2;
  const cx = button.x ?? radius;
  const cy = button.y ?? radius;
  return {
    cx,
    cy,
    minX: cx - radius,
    minY: cy - radius,
    maxX: cx + radius,
    maxY: cy + radius
  };
}

export function defaultGridSettings(): SwitchManagerGridSettings {
  return {
    enabled: false,
    snap: true,
    cellWidth: 24,
    cellHeight: 24,
    offsetX: 0,
    offsetY: 0
  };
}

export function getSwitchMetadata(config: SwitchManagerConfig): SwitchManagerMetadata {
  return (isRecord(config.metadata) ? config.metadata : {}) as SwitchManagerMetadata;
}

export function ensureSwitchMetadata(config: SwitchManagerConfig): SwitchManagerMetadata {
  if (!isRecord(config.metadata)) {
    config.metadata = {};
  }
  return config.metadata as SwitchManagerMetadata;
}

export function getLayoutMetadata(config: SwitchManagerConfig, buttonCount: number): SwitchManagerLayoutMetadata {
  const metadata = getSwitchMetadata(config);
  const rawLayout = isRecord(metadata.layout) ? metadata.layout : {};
  const rawGrid = isRecord(rawLayout.grid) ? rawLayout.grid : {};
  const buttonOverrides = Array.from({ length: buttonCount }, (_, index) => {
    const entry = Array.isArray(rawLayout.buttonOverrides) ? rawLayout.buttonOverrides[index] : null;
    if (!isRecord(entry)) {
      return null;
    }
    const width = asNumber(entry.width, 0);
    const height = asNumber(entry.height, 0);
    if (width <= 0 || height <= 0) {
      return null;
    }
    return {
      shape: entry.shape === "circle" ? "circle" : "rect",
      x: asNumber(entry.x, 0),
      y: asNumber(entry.y, 0),
      width,
      height
    } satisfies SwitchManagerButtonLayoutOverride;
  });

  return {
    buttonOverrides,
    grid: {
      enabled: Boolean(rawGrid.enabled),
      snap: rawGrid.snap === undefined ? true : Boolean(rawGrid.snap),
      cellWidth: Math.max(8, asNumber(rawGrid.cellWidth, 24)),
      cellHeight: Math.max(8, asNumber(rawGrid.cellHeight, 24)),
      offsetX: asNumber(rawGrid.offsetX, 0),
      offsetY: asNumber(rawGrid.offsetY, 0)
    }
  };
}

export function ensureLayoutMetadata(config: SwitchManagerConfig, buttonCount: number): SwitchManagerLayoutMetadata {
  const metadata = ensureSwitchMetadata(config);
  const layout = getLayoutMetadata(config, buttonCount);
  metadata.layout = layout;
  return layout;
}

export function buttonLayoutBounds(
  button: SwitchManagerBlueprintButton,
  override: SwitchManagerButtonLayoutOverride | null | undefined
): {
  cx: number;
  cy: number;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
} {
  if (!override) {
    return buttonBounds(button);
  }
  return {
    cx: override.x + override.width / 2,
    cy: override.y + override.height / 2,
    minX: override.x,
    minY: override.y,
    maxX: override.x + override.width,
    maxY: override.y + override.height
  };
}

export function blueprintViewBox(
  blueprint: SwitchManagerBlueprint | null,
  overrides: Array<SwitchManagerButtonLayoutOverride | null> = []
): string {
  if (!blueprint || blueprint.buttons.length === 0) {
    return "0 0 320 420";
  }
  const bounds = blueprint.buttons.map((button, index) => buttonLayoutBounds(button, overrides[index]));
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const b of bounds) {
    if (b.minX < minX) minX = b.minX;
    if (b.maxX > maxX) maxX = b.maxX;
    if (b.minY < minY) minY = b.minY;
    if (b.maxY > maxY) maxY = b.maxY;
  }
  minX -= 24; minY -= 24; maxX += 24; maxY += 24;
  return `${minX} ${minY} ${maxX - minX} ${maxY - minY}`;
}

export function targetLabel(
  kind: TargetKind,
  id: string,
  snapshot: StudioSnapshot | null,
  devicesById: Map<string, DeviceSummary>,
  entitiesById: Map<string, EntitySummary>
): string {
  if (!snapshot) {
    return id;
  }
  if (kind === "device") {
    return devicesById.get(id)?.name ?? id;
  }
  if (kind === "area") {
    return snapshot.areas.find((area) => area.id === id)?.name ?? id;
  }
  return entitiesById.get(id)?.name ?? id;
}

export function renderBlueprintShape(
  button: SwitchManagerBlueprintButton,
  className: string,
  override?: SwitchManagerButtonLayoutOverride | null
) {
  if (override) {
    if (override.shape === "circle") {
      return (
        <ellipse
          className={className}
          cx={override.x + override.width / 2}
          cy={override.y + override.height / 2}
          rx={override.width / 2}
          ry={override.height / 2}
        />
      );
    }
    return (
      <rect
        className={className}
        height={override.height}
        rx={18}
        ry={18}
        width={override.width}
        x={override.x}
        y={override.y}
      />
    );
  }
  if (typeof button.d === "string") {
    return <path className={className} d={button.d} />;
  }
  if (typeof button.height === "number") {
    return (
      <rect
        className={className}
        height={button.height}
        rx={18}
        ry={18}
        width={button.width ?? 48}
        x={button.x ?? 0}
        y={button.y ?? 0}
      />
    );
  }
  return (
    <circle
      className={className}
      cx={button.x ?? 0}
      cy={button.y ?? 0}
      r={(button.width ?? 44) / 2}
    />
  );
}

export function matchesSearch(value: string, search: string): boolean {
  return value.toLowerCase().includes(search.toLowerCase());
}

export function resolvedConfigAreaId(
  config: SwitchManagerConfig,
  devicesById: Map<string, DeviceSummary>,
  entitiesById: Map<string, EntitySummary>
): string | null {
  const metadata = getSwitchMetadata(config);
  if (metadata.areaManaged) {
    return typeof metadata.areaId === "string" && metadata.areaId.trim() ? metadata.areaId : null;
  }
  const linkedEntityIds = [config.primaryEntityId, ...config.propertyEntityIds].filter(
    (entityId): entityId is string => typeof entityId === "string" && entityId.trim().length > 0
  );
  for (const entityId of linkedEntityIds) {
    const areaId = entitiesById.get(entityId)?.areaId ?? null;
    if (areaId) {
      return areaId;
    }
  }
  if (config.deviceId) {
    const areaId = devicesById.get(config.deviceId)?.areaId ?? null;
    if (areaId) {
      return areaId;
    }
  }
  if (typeof metadata.areaId === "string" && metadata.areaId.trim()) {
    return metadata.areaId;
  }
  return null;
}

export function areaNameById(areas: AreaSummary[], areaId: string | null): string {
  if (!areaId) {
    return "Unassigned";
  }
  return areas.find((area) => area.id === areaId)?.name ?? "Unassigned";
}

export function snapValueToGrid(value: number, size: number, offset: number): number {
  if (!Number.isFinite(size) || size <= 0) {
    return value;
  }
  return Math.round((value - offset) / size) * size + offset;
}

export function snapOverrideToGrid(
  override: SwitchManagerButtonLayoutOverride,
  grid: SwitchManagerGridSettings
): SwitchManagerButtonLayoutOverride {
  return {
    ...override,
    x: snapValueToGrid(override.x, grid.cellWidth, grid.offsetX),
    y: snapValueToGrid(override.y, grid.cellHeight, grid.offsetY),
    width: Math.max(grid.cellWidth, snapValueToGrid(override.width, grid.cellWidth, 0)),
    height: Math.max(grid.cellHeight, snapValueToGrid(override.height, grid.cellHeight, 0))
  };
}

export function createDraftFromBlueprint(
  blueprint: SwitchManagerBlueprint,
  partial: Partial<SwitchManagerConfig> = {}
): SwitchManagerConfig {
  return {
    id: partial.id ?? "",
    name: partial.name ?? blueprint.name,
    enabled: partial.enabled ?? true,
    blueprintId: blueprint.id,
    identifier: partial.identifier ?? "",
    variables: partial.variables ?? null,
    deviceId: partial.deviceId ?? null,
    primaryEntityId: partial.primaryEntityId ?? null,
    propertyEntityIds: partial.propertyEntityIds ?? [],
    metadata: partial.metadata ?? null,
    virtualMultiPress: partial.virtualMultiPress ?? {
      enabled: false,
      pressWindowMs: 450,
      maxPresses: 3
    },
    rotate: partial.rotate ?? 0,
    buttons:
      partial.buttons ??
      blueprint.buttons.map((button) => ({
        actions: button.actions.map(() => ({
          mode: "single",
          sequence: []
        })),
        virtualActions: []
      })),
    isMismatch: false,
    validBlueprint: true,
    error: null,
    buttonLastState: Array.from({ length: blueprint.buttons.length }, () => null)
  };
}

export function createDraftFromDiscovery(
  candidate: DiscoveryCandidate,
  blueprint: SwitchManagerBlueprint
): SwitchManagerConfig {
  return createDraftFromBlueprint(blueprint, {
    name: candidate.name,
    identifier: candidate.suggestedIdentifier,
    deviceId: candidate.deviceId,
    primaryEntityId: candidate.entityIds.find((entityId) => entityId.startsWith("event.")) ?? candidate.entityIds[0] ?? null,
    propertyEntityIds: candidate.entityIds,
    metadata: {
      areaId: candidate.areaId,
      areaManaged: Boolean(candidate.areaId),
      probableProtocol: candidate.probableProtocol,
      source: "discovery"
    }
  });
}
