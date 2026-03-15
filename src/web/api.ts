import type {
  AuthSessionRequest,
  AuthStatusResponse,
  AutomationSummary,
  BlueprintImageStatus,
  DevicePropertiesResponse,
  DiscoveryCandidate,
  HealthResponse,
  LearningLibraryResponse,
  SaveConfigRequest,
  StudioSnapshot,
  SwitchManagerConfig
} from "../shared/types";

export const AUTH_EXPIRED_EVENT = "switch-manager-studio:auth-expired";

function notifyAuthExpired(): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(AUTH_EXPIRED_EVENT));
  }
}

export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

export function isAuthError(error: unknown): error is ApiError {
  return error instanceof ApiError && error.status === 401;
}

async function parseResponse<T>(response: Response): Promise<T> {
  const body = await response.text();
  let parsed: T & { error?: string };
  try {
    parsed = body ? (JSON.parse(body) as T & { error?: string }) : ({} as T & { error?: string });
  } catch {
    throw new ApiError(
      response.ok ? "Received non-JSON response from server" : `Request failed with ${response.status}`,
      response.status
    );
  }
  if (!response.ok) {
    if (response.status === 401) {
      notifyAuthExpired();
    }
    throw new ApiError(parsed.error ?? `Request failed with ${response.status}`, response.status);
  }
  return parsed;
}

async function blobToBase64(blob: Blob): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== "string") {
        reject(new Error("Could not read image data"));
        return;
      }
      const [, base64 = ""] = result.split(",", 2);
      resolve(base64);
    };
    reader.onerror = () => reject(reader.error ?? new Error("Could not read image data"));
    reader.readAsDataURL(blob);
  });
}

async function parseError(response: Response): Promise<ApiError> {
  const body = await response.text();
  try {
    const parsed = body ? (JSON.parse(body) as { error?: string }) : null;
    if (response.status === 401) {
      notifyAuthExpired();
    }
    return new ApiError(parsed?.error ?? `Request failed with ${response.status}`, response.status);
  } catch {
    if (response.status === 401) {
      notifyAuthExpired();
    }
    return new ApiError(body || `Request failed with ${response.status}`, response.status);
  }
}

function downloadNameFromDisposition(value: string | null, fallback: string): string {
  const match = value?.match(/filename="?([^";]+)"?/i);
  return match?.[1]?.trim() || fallback;
}

export async function fetchHealth(): Promise<HealthResponse> {
  return parseResponse<HealthResponse>(await fetch("api/health"));
}

export async function fetchBlueprintImageStatus(blueprintId: string): Promise<BlueprintImageStatus> {
  return parseResponse<BlueprintImageStatus>(
    await fetch(`api/blueprints/${encodeURIComponent(blueprintId)}/image-status`)
  );
}

export async function fetchSnapshot(): Promise<StudioSnapshot> {
  return parseResponse<StudioSnapshot>(await fetch("api/snapshot"));
}

export async function fetchAuthStatus(): Promise<AuthStatusResponse> {
  return parseResponse<AuthStatusResponse>(await fetch("api/auth/status", { cache: "no-store" }));
}

export async function createAuthSession(body: AuthSessionRequest): Promise<AuthStatusResponse> {
  return parseResponse<AuthStatusResponse>(
    await fetch("api/auth/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    })
  );
}

export async function clearAuthSession(): Promise<AuthStatusResponse> {
  return parseResponse<AuthStatusResponse>(
    await fetch("api/auth/session", {
      method: "DELETE"
    })
  );
}

export async function fetchDiscovery(): Promise<DiscoveryCandidate[]> {
  const response = await parseResponse<{ candidates: DiscoveryCandidate[] }>(await fetch("api/discovery"));
  return response.candidates;
}

export async function fetchAutomations(): Promise<AutomationSummary[]> {
  const response = await parseResponse<{ automations: AutomationSummary[] }>(await fetch("api/automations"));
  return response.automations;
}

export async function fetchLearning(): Promise<LearningLibraryResponse> {
  return parseResponse<LearningLibraryResponse>(await fetch("api/learning"));
}

export async function startLearningSession(body: {
  blueprintId?: string;
  configId?: string;
  identifier?: string;
  label?: string;
}): Promise<void> {
  await parseResponse(
    await fetch("api/learning/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    })
  );
}

export async function stopLearningSession(): Promise<void> {
  await parseResponse(
    await fetch("api/learning/stop", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}"
    })
  );
}

export async function clearLearningLibrary(): Promise<void> {
  await parseResponse(
    await fetch("api/learning/clear", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}"
    })
  );
}

export async function fetchDeviceProperties(deviceId: string): Promise<DevicePropertiesResponse> {
  return parseResponse<DevicePropertiesResponse>(
    await fetch(`api/devices/${encodeURIComponent(deviceId)}/properties`)
  );
}

export async function controlEntity(entityId: string, action: string, value?: unknown): Promise<void> {
  await parseResponse(
    await fetch("api/entities/control", {
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
    await fetch("api/automations/export", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    })
  );
}

export async function exportBlueprintPackage(config: SwitchManagerConfig): Promise<string> {
  const response = await fetch("api/blueprints/export-package", {
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
  window.setTimeout(() => URL.revokeObjectURL(url), 10000);
  return fileName;
}

export async function uploadBlueprintImageOverride(
  blueprintId: string,
  image: Blob,
  sourceFileName: string
): Promise<BlueprintImageStatus> {
  const imageBase64 = await blobToBase64(image);
  return parseResponse<BlueprintImageStatus>(
    await fetch(`api/blueprints/${encodeURIComponent(blueprintId)}/image-override`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        imageBase64,
        sourceFileName
      })
    })
  );
}

export async function deleteBlueprintImageOverride(blueprintId: string): Promise<BlueprintImageStatus> {
  return parseResponse<BlueprintImageStatus>(
    await fetch(`api/blueprints/${encodeURIComponent(blueprintId)}/image-override`, {
      method: "DELETE"
    })
  );
}

export async function fetchDeviceImage(deviceId: string): Promise<Blob> {
  const response = await fetch(`api/devices/${encodeURIComponent(deviceId)}/image`);
  if (!response.ok) {
    if (response.status === 401) {
      notifyAuthExpired();
    }
    const body = await response.json().catch(() => ({})) as { error?: string };
    throw new Error(body.error ?? "Device image not available");
  }
  return response.blob();
}

export async function saveConfig(config: SwitchManagerConfig): Promise<{ config: SwitchManagerConfig; warning?: string }> {
  const response = await parseResponse<{ config: SwitchManagerConfig; warning?: string }>(
    await fetch("api/configs/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ config } satisfies SaveConfigRequest)
    })
  );
  return { config: response.config, warning: response.warning };
}

export async function setConfigEnabled(id: string, enabled: boolean): Promise<void> {
  await parseResponse(
    await fetch(`api/configs/${encodeURIComponent(id)}/enabled`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled })
    })
  );
}

export async function deleteConfig(id: string): Promise<void> {
  await parseResponse(
    await fetch(`api/configs/${encodeURIComponent(id)}`, {
      method: "DELETE"
    })
  );
}
