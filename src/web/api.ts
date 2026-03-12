import type {
  AutomationSummary,
  DevicePropertiesResponse,
  DiscoveryCandidate,
  HealthResponse,
  LearningLibraryResponse,
  SaveConfigRequest,
  StudioSnapshot,
  SwitchManagerConfig
} from "../shared/types";

async function parseResponse<T>(response: Response): Promise<T> {
  const body = await response.text();
  const parsed = body ? (JSON.parse(body) as T & { error?: string }) : ({} as T & { error?: string });
  if (!response.ok) {
    throw new Error(parsed.error ?? `Request failed with ${response.status}`);
  }
  return parsed;
}

async function parseError(response: Response): Promise<Error> {
  const body = await response.text();
  try {
    const parsed = body ? (JSON.parse(body) as { error?: string }) : null;
    return new Error(parsed?.error ?? `Request failed with ${response.status}`);
  } catch {
    return new Error(body || `Request failed with ${response.status}`);
  }
}

function downloadNameFromDisposition(value: string | null, fallback: string): string {
  const match = value?.match(/filename="?([^";]+)"?/i);
  return match?.[1] ?? fallback;
}

export async function fetchHealth(): Promise<HealthResponse> {
  return parseResponse<HealthResponse>(await fetch("/api/health"));
}

export async function fetchSnapshot(): Promise<StudioSnapshot> {
  return parseResponse<StudioSnapshot>(await fetch("/api/snapshot"));
}

export async function fetchDiscovery(): Promise<DiscoveryCandidate[]> {
  const response = await parseResponse<{ candidates: DiscoveryCandidate[] }>(await fetch("/api/discovery"));
  return response.candidates;
}

export async function fetchAutomations(): Promise<AutomationSummary[]> {
  const response = await parseResponse<{ automations: AutomationSummary[] }>(await fetch("/api/automations"));
  return response.automations;
}

export async function fetchLearning(): Promise<LearningLibraryResponse> {
  return parseResponse<LearningLibraryResponse>(await fetch("/api/learning"));
}

export async function startLearningSession(body: {
  blueprintId?: string;
  configId?: string;
  identifier?: string;
  label?: string;
}): Promise<void> {
  await parseResponse(
    await fetch("/api/learning/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    })
  );
}

export async function stopLearningSession(): Promise<void> {
  await parseResponse(
    await fetch("/api/learning/stop", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}"
    })
  );
}

export async function clearLearningLibrary(): Promise<void> {
  await parseResponse(
    await fetch("/api/learning/clear", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}"
    })
  );
}

export async function fetchDeviceProperties(deviceId: string): Promise<DevicePropertiesResponse> {
  return parseResponse<DevicePropertiesResponse>(
    await fetch(`/api/devices/${encodeURIComponent(deviceId)}/properties`)
  );
}

export async function controlEntity(entityId: string, action: string, value?: unknown): Promise<void> {
  await parseResponse(
    await fetch("/api/entities/control", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entityId, action, value })
    })
  );
}

export async function exportAutomation(body: {
  configId: string;
  buttonIndex: number;
  actionIndex: number;
  pressCount?: number;
  virtual?: boolean;
  alias?: string;
}): Promise<void> {
  await parseResponse(
    await fetch("/api/automations/export", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    })
  );
}

export async function exportBlueprintPackage(config: SwitchManagerConfig): Promise<string> {
  const response = await fetch("/api/blueprints/export-package", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ config } satisfies SaveConfigRequest)
  });

  if (!response.ok) {
    throw await parseError(response);
  }

  const blob = await response.blob();
  const fileName = downloadNameFromDisposition(
    response.headers.get("content-disposition"),
    `switch-manager-blueprint-${config.blueprintId}.tar.gz`
  );
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.style.display = "none";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  return fileName;
}

export async function saveConfig(config: SwitchManagerConfig): Promise<SwitchManagerConfig> {
  const response = await parseResponse<{ config: SwitchManagerConfig }>(
    await fetch("/api/configs/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ config } satisfies SaveConfigRequest)
    })
  );
  return response.config;
}

export async function setConfigEnabled(id: string, enabled: boolean): Promise<void> {
  await parseResponse(
    await fetch(`/api/configs/${encodeURIComponent(id)}/enabled`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled })
    })
  );
}

export async function deleteConfig(id: string): Promise<void> {
  await parseResponse(
    await fetch(`/api/configs/${encodeURIComponent(id)}`, {
      method: "DELETE"
    })
  );
}
