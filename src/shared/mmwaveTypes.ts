export type AreaKind = "detection" | "interference" | "stay";
export type AreaSlot = "area1" | "area2" | "area3" | "area4";

export interface AreaRect {
  width_min: number;
  width_max: number;
  depth_min: number;
  depth_max: number;
  height_min: number;
  height_max: number;
}

export type AreaCollection = Record<AreaSlot, AreaRect>;
export type AreaLabelCollection = Record<AreaSlot, string>;
export type DeviceAreaLabels = Record<AreaKind, AreaLabelCollection>;

export interface BaseBounds extends AreaRect {}

export interface DeviceProfileSettings {
  roomPreset: string;
  detectSensitivity: string;
  detectTrigger: string;
  holdTime: number;
  stayLife: number;
  targetInfoReport: string;
  controlWiredDevice: string;
  defaultLevelLocal: number;
  baseBounds: BaseBounds;
}

export interface DeviceMeta {
  friendlyName: string;
  ieeeAddress: string;
  model: string;
  vendor: string;
  description?: string;
}

export interface DeviceSettings {
  roomPreset: string;
  detectSensitivity: string;
  detectTrigger: string;
  holdTime: number;
  stayLife: number;
  targetInfoReport: string;
  controlWiredDevice: string;
  defaultLevelLocal: number;
  mmwaveVersion: number | null;
  baseBounds: BaseBounds;
  state: string;
  brightness: number | null;
  occupancy: boolean;
  illuminance: number | null;
  areaOccupancy: Record<AreaSlot, boolean | null>;
}

export interface StudioProfile {
  id: string;
  name: string;
  notes: string;
  model: string;
  sourceDevice: string;
  createdAt: string;
  updatedAt: string;
  settings: DeviceProfileSettings;
  areas: Record<AreaKind, AreaCollection>;
}

export interface TargetPoint {
  x: number;
  y: number;
  z?: number;
  id?: number;
  speed?: number;
  confidence?: number;
  label?: string;
}

export interface TargetTrail {
  key: string;
  label: string;
  lastSeenAt: string;
  points: TargetPoint[];
}

export type TargetTrackingState = "disabled" | "waiting" | "armed" | "live";

export interface DeviceSnapshot {
  meta: DeviceMeta;
  availability: string;
  updatedAt: string | null;
  settings: DeviceSettings;
  areas: Record<AreaKind, AreaCollection>;
  areaLabels: DeviceAreaLabels;
  supportsTargetDots: boolean;
  targetPoints: TargetPoint[];
  targetTrails: TargetTrail[];
  targetTelemetryAt: string | null;
  targetTrackingState: TargetTrackingState;
  notes: string[];
  rawState?: Record<string, unknown>;
}

export interface BridgeSummary {
  connected: boolean;
  brokerUrl: string;
  baseTopic: string;
  connectedAt: string | null;
  lastMessageAt: string | null;
  z2mBridgeState?: string | null;
  lastError?: string | null;
}

export interface StudioSnapshot {
  bridge: BridgeSummary;
  devices: DeviceSnapshot[];
}

export interface UpdateAreaRequest {
  area: AreaRect;
}

export interface UpdateAreaLabelRequest {
  label: string;
}

export interface UpdateSettingsRequest {
  roomPreset?: string;
  detectSensitivity?: string;
  detectTrigger?: string;
  holdTime?: number;
  stayLife?: number;
  targetInfoReport?: string;
  controlWiredDevice?: string;
  defaultLevelLocal?: number;
  baseBounds?: Partial<BaseBounds>;
}

export interface UpsertProfileRequest {
  name: string;
  notes?: string;
  model?: string;
  sourceDevice: string;
  settings: DeviceProfileSettings;
  areas: Record<AreaKind, AreaCollection>;
}

export type WsServerMessage =
  | { type: "snapshot"; snapshot: StudioSnapshot }
  | { type: "device_update"; device: DeviceSnapshot }
  | { type: "bridge_update"; bridge: BridgeSummary };
