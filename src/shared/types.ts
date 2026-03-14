export type TargetKind = "entity" | "device" | "area";
export type JsonMap = Record<string, unknown>;
export type SequenceStep = JsonMap;
export type PropertyControlType = "toggle" | "select" | "number" | "button" | "readonly";

export interface SwitchManagerBlueprintAction {
  title: string;
  conditions?: Array<{ key: string; value: string }>;
}

export interface SwitchManagerBlueprintButton {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  d?: string;
  conditions?: Array<{ key: string; value: string }>;
  actions: SwitchManagerBlueprintAction[];
}

export interface SwitchManagerBlueprint {
  id: string;
  name: string;
  service: string;
  eventType: string;
  identifierKey: string | null;
  isMqtt: boolean;
  hasImage: boolean;
  info: string | null;
  blueprintType: "switch" | "sensor";
  buttons: SwitchManagerBlueprintButton[];
}

export interface BlueprintImageStatus {
  blueprintId: string;
  hasImage: boolean;
  hasOverride: boolean;
  width: number | null;
  height: number | null;
}

export interface SwitchManagerConfigAction {
  mode: string;
  sequence: SequenceStep[];
}

export interface SwitchManagerVirtualAction extends SwitchManagerConfigAction {
  title: string;
  pressCount: number;
}

export interface SwitchManagerConfigButton {
  actions: SwitchManagerConfigAction[];
  virtualActions: SwitchManagerVirtualAction[];
}

export interface VirtualMultiPressSettings {
  enabled: boolean;
  pressWindowMs: number;
  maxPresses: number;
}

export interface SwitchManagerButtonLayoutOverride {
  shape: "rect" | "circle";
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SwitchManagerGridSettings {
  enabled: boolean;
  snap: boolean;
  cellWidth: number;
  cellHeight: number;
  offsetX: number;
  offsetY: number;
}

export interface SwitchManagerLayoutMetadata {
  buttonOverrides: Array<SwitchManagerButtonLayoutOverride | null>;
  grid: SwitchManagerGridSettings;
}

export interface SwitchManagerMetadata extends JsonMap {
  areaId?: string | null;
  areaManaged?: boolean;
  layout?: SwitchManagerLayoutMetadata;
}

export interface SwitchManagerConfig {
  id: string;
  name: string;
  enabled: boolean;
  blueprintId: string;
  identifier: string;
  variables: JsonMap | null;
  deviceId: string | null;
  primaryEntityId: string | null;
  propertyEntityIds: string[];
  metadata: SwitchManagerMetadata | null;
  virtualMultiPress: VirtualMultiPressSettings;
  rotate: number;
  buttons: SwitchManagerConfigButton[];
  isMismatch: boolean;
  validBlueprint: boolean;
  error: string | null;
  buttonLastState: Array<JsonMap | null>;
}

export interface AreaSummary {
  id: string;
  name: string;
  aliases: string[];
}

export interface DeviceSummary {
  id: string;
  name: string;
  areaId: string | null;
  manufacturer: string | null;
  model: string | null;
  entityIds: string[];
  /** Flattened HA device-registry identifiers and connections (e.g. IEEE address, Z-Wave node ref). */
  identifiers: string[];
}

export interface EntitySummary {
  entityId: string;
  name: string;
  domain: string;
  areaId: string | null;
  deviceId: string | null;
  state: string | null;
  icon: string | null;
  /** Relative HA URL for a device image, when provided by the integration (ZHA, Z-Wave JS, etc.). */
  entityPicture: string | null;
  disabled: boolean;
  hidden: boolean;
}

export interface StudioSnapshot {
  generatedAt: string;
  haBaseUrl: string;
  blueprints: SwitchManagerBlueprint[];
  configs: SwitchManagerConfig[];
  areas: AreaSummary[];
  devices: DeviceSummary[];
  entities: EntitySummary[];
}

export interface HealthResponse {
  ok: boolean;
  haBaseUrl: string;
  hasToken: boolean;
  version?: string;
  error?: string;
}

export interface AuthStatusResponse {
  authenticated: boolean;
  haBaseUrl: string | null;
  defaultHaBaseUrl: string | null;
}

export interface AuthSessionRequest {
  haBaseUrl: string;
  accessToken: string;
}

export interface SaveConfigRequest {
  config: SwitchManagerConfig;
}

export interface DiscoveryCandidate {
  id: string;
  name: string;
  manufacturer: string | null;
  model: string | null;
  areaId: string | null;
  deviceId: string | null;
  entityIds: string[];
  /** Flattened HA device-registry identifiers (IEEE address, Z-Wave node ref, etc.). */
  identifiers: string[];
  probableProtocol: string | null;
  /** Identifier pre-filled from device registry data; may be empty if no confident match. */
  suggestedIdentifier: string;
  suggestedBlueprintIds: string[];
  relatedAutomationIds: string[];
}

export interface AutomationSummary {
  id: string;
  alias: string;
  description: string | null;
  mode: string | null;
  triggers: JsonMap[];
  conditions: SequenceStep[];
  actions: SequenceStep[];
  matchedConfigId: string | null;
  matchedButtonIndex: number | null;
  matchedActionIndex: number | null;
  matchedPressCount: number | null;
  matchSummary: string | null;
  source: "automations.yaml";
}

export interface LearningSession {
  active: boolean;
  blueprintId: string | null;
  configId: string | null;
  identifier: string | null;
  label: string | null;
  startedAt: string | null;
  updatedAt: string | null;
}

export interface LearnedEvent {
  capturedAt: string;
  blueprintId: string | null;
  configId: string | null;
  identifier: string | null;
  button: number | null;
  action: number | null;
  actionTitle: string | null;
  pressCount: number | null;
  virtual: boolean;
  data: JsonMap;
}

export interface LearningLibraryResponse {
  activeSession: LearningSession | null;
  events: LearnedEvent[];
}

export interface PropertyEntity {
  entityId: string;
  name: string;
  domain: string;
  state: string | null;
  icon: string | null;
  attributes: JsonMap;
  controlType: PropertyControlType;
  options: string[];
  min: number | null;
  max: number | null;
  step: number | null;
  writable: boolean;
}

export interface DevicePropertiesResponse {
  device: DeviceSummary | null;
  probableProtocol: string | null;
  entities: PropertyEntity[];
}
