import type {
  AreaKind,
  AreaRect,
  AreaSlot,
  DeviceSnapshot,
  StudioProfile,
  StudioSnapshot,
  UpsertProfileRequest,
  UpdateSettingsRequest,
  WsServerMessage
} from "../shared/mmwaveTypes";

async function requestJson<T>(input: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers ?? {});
  if (init?.body !== undefined && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  const response = await fetch(input, { ...init, headers });
  if (!response.ok) {
    let detail = "";
    try {
      const contentType = response.headers.get("content-type") ?? "";
      if (contentType.includes("application/json")) {
        const payload = (await response.json()) as { error?: unknown; message?: unknown };
        detail =
          typeof payload.error === "string"
            ? payload.error
            : typeof payload.message === "string"
              ? payload.message
              : "";
      } else {
        detail = (await response.text()).trim();
      }
    } catch {
      detail = "";
    }
    throw new Error(detail ? `${response.status} ${detail}` : `${response.status} ${response.statusText}`);
  }
  return (await response.json()) as T;
}

export function fetchMmwaveStudio(): Promise<StudioSnapshot> {
  return requestJson<StudioSnapshot>("/api/mmwave/studio");
}

export function fetchMmwaveProfiles(): Promise<StudioProfile[]> {
  return requestJson<StudioProfile[]>("/api/mmwave/profiles");
}

export function createMmwaveProfile(payload: UpsertProfileRequest): Promise<StudioProfile> {
  return requestJson<StudioProfile>("/api/mmwave/profiles", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function updateMmwaveProfile(profileId: string, payload: UpsertProfileRequest): Promise<StudioProfile> {
  return requestJson<StudioProfile>(`/api/mmwave/profiles/${encodeURIComponent(profileId)}`, {
    method: "PUT",
    body: JSON.stringify(payload)
  });
}

export function deleteMmwaveProfile(profileId: string): Promise<{ ok: true }> {
  return requestJson<{ ok: true }>(`/api/mmwave/profiles/${encodeURIComponent(profileId)}`, {
    method: "DELETE"
  });
}

export function importMmwaveProfiles(payload: unknown): Promise<StudioProfile[]> {
  return requestJson<StudioProfile[]>("/api/mmwave/profiles/import", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function applyMmwaveProfile(profileId: string, deviceName: string): Promise<DeviceSnapshot> {
  return requestJson<DeviceSnapshot>(
    `/api/mmwave/profiles/${encodeURIComponent(profileId)}/apply/${encodeURIComponent(deviceName)}`,
    { method: "POST" }
  );
}

export function mmwaveFindMe(deviceName: string): Promise<DeviceSnapshot> {
  return requestJson<DeviceSnapshot>(`/api/mmwave/devices/${encodeURIComponent(deviceName)}/actions/find-me`, {
    method: "POST"
  });
}

export function mmwaveQueryAreas(deviceName: string): Promise<DeviceSnapshot> {
  return requestJson<DeviceSnapshot>(`/api/mmwave/devices/${encodeURIComponent(deviceName)}/actions/query-areas`, {
    method: "POST"
  });
}

export function mmwaveResetDetection(deviceName: string): Promise<DeviceSnapshot> {
  return requestJson<DeviceSnapshot>(
    `/api/mmwave/devices/${encodeURIComponent(deviceName)}/actions/reset-detection`,
    { method: "POST" }
  );
}

export function mmwaveClearInterference(deviceName: string): Promise<DeviceSnapshot> {
  return requestJson<DeviceSnapshot>(
    `/api/mmwave/devices/${encodeURIComponent(deviceName)}/actions/clear-interference`,
    { method: "POST" }
  );
}

export function mmwaveClearStay(deviceName: string): Promise<DeviceSnapshot> {
  return requestJson<DeviceSnapshot>(`/api/mmwave/devices/${encodeURIComponent(deviceName)}/actions/clear-stay`, {
    method: "POST"
  });
}

export function mmwaveUpdateArea(
  deviceName: string,
  kind: AreaKind,
  slot: AreaSlot,
  area: AreaRect
): Promise<DeviceSnapshot> {
  return requestJson<DeviceSnapshot>(
    `/api/mmwave/devices/${encodeURIComponent(deviceName)}/areas/${kind}/${slot}`,
    { method: "PUT", body: JSON.stringify({ area }) }
  );
}

export function mmwaveUpdateAreaLabel(
  deviceName: string,
  kind: AreaKind,
  slot: AreaSlot,
  label: string
): Promise<DeviceSnapshot> {
  return requestJson<DeviceSnapshot>(
    `/api/mmwave/devices/${encodeURIComponent(deviceName)}/labels/${kind}/${slot}`,
    { method: "PUT", body: JSON.stringify({ label }) }
  );
}

export function mmwaveUpdateSettings(
  deviceName: string,
  patch: UpdateSettingsRequest
): Promise<DeviceSnapshot> {
  return requestJson<DeviceSnapshot>(`/api/mmwave/devices/${encodeURIComponent(deviceName)}/settings`, {
    method: "PUT",
    body: JSON.stringify(patch)
  });
}

export function connectMmwaveStream(onMessage: (message: WsServerMessage) => void): () => void {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const url = `${protocol}//${window.location.host}/ws/mmwave`;
  let socket: WebSocket | null = null;
  let reconnectTimer: number | null = null;
  let reconnectDelayMs = 1000;
  let disposed = false;

  const clearReconnectTimer = () => {
    if (reconnectTimer !== null) {
      window.clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  };

  const scheduleReconnect = () => {
    if (disposed || reconnectTimer !== null) {
      return;
    }
    reconnectTimer = window.setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, reconnectDelayMs);
    reconnectDelayMs = Math.min(reconnectDelayMs * 2, 10000);
  };

  const connect = () => {
    if (disposed) {
      return;
    }
    clearReconnectTimer();
    socket = new WebSocket(url);
    socket.onopen = () => {
      reconnectDelayMs = 1000;
    };
    socket.onmessage = (event) => {
      try {
        onMessage(JSON.parse(event.data) as WsServerMessage);
      } catch {
        // Ignore malformed messages
      }
    };
    socket.onerror = () => {
      socket?.close();
    };
    socket.onclose = () => {
      socket = null;
      scheduleReconnect();
    };
  };

  connect();

  return () => {
    disposed = true;
    clearReconnectTimer();
    socket?.close();
  };
}
