import type { AreaCollection, AreaKind, AreaRect, AreaSlot, DeviceAreaLabels, StudioProfile } from "./mmwaveTypes.js";
import { asNumber } from "./utils.js";
export { clamp } from "./utils.js";

export const ZERO_AREA: AreaRect = {
  width_min: 0,
  width_max: 0,
  depth_min: 0,
  depth_max: 0,
  height_min: -600,
  height_max: 600
};

export const AREA_SLOTS: readonly AreaSlot[] = ["area1", "area2", "area3", "area4"];
export const AREA_KINDS: readonly AreaKind[] = ["detection", "interference", "stay"];

export function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function cloneArea(area?: Partial<AreaRect> | null): AreaRect {
  return {
    width_min: asNumber(area?.width_min, ZERO_AREA.width_min),
    width_max: asNumber(area?.width_max, ZERO_AREA.width_max),
    depth_min: asNumber(area?.depth_min, ZERO_AREA.depth_min),
    depth_max: asNumber(area?.depth_max, ZERO_AREA.depth_max),
    height_min: asNumber(area?.height_min, ZERO_AREA.height_min),
    height_max: asNumber(area?.height_max, ZERO_AREA.height_max)
  };
}

export function cloneAreaCollection(collection: AreaCollection): AreaCollection {
  return {
    area1: cloneArea(collection.area1),
    area2: cloneArea(collection.area2),
    area3: cloneArea(collection.area3),
    area4: cloneArea(collection.area4)
  };
}

export function areaIsZero(area: AreaRect): boolean {
  return area.width_min === 0 && area.width_max === 0 && area.depth_min === 0 && area.depth_max === 0;
}

export function rangeSpan(min: number, max: number): number {
  return Math.abs(max - min);
}

export function areaDisplayLabel(labels: DeviceAreaLabels, kind: AreaKind, slot: AreaSlot): string {
  const raw = labels[kind]?.[slot];
  return raw?.trim() || slot;
}

export function sortProfiles(profiles: StudioProfile[]): StudioProfile[] {
  return [...profiles].sort((left, right) => {
    const updated = right.updatedAt.localeCompare(left.updatedAt);
    return updated !== 0 ? updated : left.name.localeCompare(right.name);
  });
}
