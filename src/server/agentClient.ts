import type { StudioConfig } from "./config.js";

interface AgentFilesListResponse {
  files?: Array<{
    path?: string;
    name?: string;
    size?: number;
    modified?: number;
    is_yaml?: boolean;
  }>;
}

interface AgentFileReadResponse {
  content?: string;
}

interface AgentParseYamlResponse {
  data?: Record<string, unknown>;
}

interface AgentAreasResponse {
  areas?: Array<Record<string, unknown>>;
}

interface AgentDevicesResponse {
  devices?: Array<Record<string, unknown>>;
}

interface AgentEntityRegistryResponse {
  entities?: Array<Record<string, unknown>>;
}

interface AgentEntitiesPageResponse {
  entities?: Array<Record<string, unknown>>;
  total_pages?: number;
}

export interface AgentHealthResponse {
  status?: string;
  version?: string;
}

export class HomeAssistantAgentClient {
  private readonly config: StudioConfig;

  constructor(config: StudioConfig) {
    this.config = config;
  }

  get hasKey(): boolean {
    return Boolean(this.config.haAgentKey);
  }

  get baseUrl(): string {
    return this.config.haAgentUrl;
  }

  async health(): Promise<AgentHealthResponse> {
    return this.request<AgentHealthResponse>("/api/health");
  }

  async listFiles(directory: string, pattern = "*"): Promise<NonNullable<AgentFilesListResponse["files"]>> {
    const params = new URLSearchParams({ directory, pattern });
    const result = await this.request<AgentFilesListResponse>(`/api/files/list?${params.toString()}`);
    return result.files ?? [];
  }

  async readFile(path: string): Promise<string> {
    const params = new URLSearchParams({ path });
    const result = await this.request<AgentFileReadResponse>(`/api/files/read?${params.toString()}`);
    return result.content ?? "";
  }

  async writeFile(path: string, content: string): Promise<void> {
    await this.request("/api/files/write", {
      method: "POST",
      body: JSON.stringify({
        path,
        content,
        create_backup: false
      })
    });
  }

  async parseYaml(path: string): Promise<Record<string, unknown>> {
    const params = new URLSearchParams({ path });
    const result = await this.request<AgentParseYamlResponse>(`/api/files/parse_yaml?${params.toString()}`);
    return result.data ?? {};
  }

  async listAreas(): Promise<Array<Record<string, unknown>>> {
    const result = await this.request<AgentAreasResponse>("/api/registries/areas/list");
    return result.areas ?? [];
  }

  async listDevices(): Promise<Array<Record<string, unknown>>> {
    const result = await this.request<AgentDevicesResponse>("/api/registries/devices/list");
    return result.devices ?? [];
  }

  async listEntityRegistry(): Promise<Array<Record<string, unknown>>> {
    const result = await this.request<AgentEntityRegistryResponse>("/api/registries/entities/list");
    return result.entities ?? [];
  }

  async updateDeviceArea(deviceId: string, areaId: string | null): Promise<void> {
    await this.request("/api/registries/devices/update", {
      method: "POST",
      body: JSON.stringify({
        device_id: deviceId,
        area_id: areaId
      })
    });
  }

  async updateEntityArea(entityId: string, areaId: string | null): Promise<void> {
    await this.request("/api/registries/entities/update", {
      method: "POST",
      body: JSON.stringify({
        entity_id: entityId,
        area_id: areaId
      })
    });
  }

  async listEntitySummaries(pageSize = 500): Promise<Array<Record<string, unknown>>> {
    return this.listEntities({ pageSize, summaryOnly: true });
  }

  async listEntityStates(pageSize = 500): Promise<Array<Record<string, unknown>>> {
    return this.listEntities({ pageSize, summaryOnly: false });
  }

  async listEntities(options: {
    pageSize?: number;
    summaryOnly?: boolean;
    search?: string;
  } = {}): Promise<Array<Record<string, unknown>>> {
    const pageSize = options.pageSize ?? 500;
    const params = new URLSearchParams({
      page: "1",
      page_size: String(pageSize)
    });
    if (options.summaryOnly) {
      params.set("summary_only", "true");
    }
    if (options.search) {
      params.set("search", options.search);
    }
    const firstPage = await this.request<AgentEntitiesPageResponse>(
      `/api/entities/list?${params.toString()}`
    );

    const entities = [...(firstPage.entities ?? [])];
    const totalPages =
      typeof firstPage.total_pages === "number" && firstPage.total_pages > 1 ? firstPage.total_pages : 1;

    if (totalPages === 1) {
      return entities;
    }

    const laterPages = await Promise.all(
      Array.from({ length: totalPages - 1 }, (_, index) =>
        this.request<AgentEntitiesPageResponse>(`/api/entities/list?${new URLSearchParams({
          ...(options.summaryOnly ? { summary_only: "true" } : {}),
          ...(options.search ? { search: options.search } : {}),
          page: String(index + 2),
          page_size: String(pageSize)
        }).toString()}`)
      )
    );

    for (const page of laterPages) {
      entities.push(...(page.entities ?? []));
    }

    return entities;
  }

  async callService(
    domain: string,
    service: string,
    serviceData?: Record<string, unknown>,
    target?: Record<string, unknown>
  ): Promise<void> {
    await this.request("/api/entities/call_service", {
      method: "POST",
      body: JSON.stringify({
        domain,
        service,
        ...(serviceData ? { service_data: serviceData } : {}),
        ...(target ? { target } : {})
      })
    });
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    if (!this.config.haAgentKey) {
      throw new Error("HA_AGENT_KEY is not configured");
    }

    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${this.config.haAgentKey}`);
    if (init.body && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }

    const response = await fetch(`${this.config.haAgentUrl}${path}`, {
      ...init,
      headers
    });

    const body = await response.text();
    const parsed = body ? safeJsonParse(body) : null;

    if (!response.ok) {
      throw new Error(extractErrorMessage(parsed) ?? `${response.status} ${response.statusText}`);
    }

    if (!body) {
      return {} as T;
    }

    if (parsed === null) {
      throw new Error(`HA agent returned non-JSON data for ${path}`);
    }

    return parsed as T;
  }
}

function safeJsonParse(value: string): unknown | null {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function extractErrorMessage(value: unknown): string | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (typeof record.detail === "string" && record.detail.trim()) {
    return record.detail;
  }
  if (typeof record.error === "string" && record.error.trim()) {
    return record.error;
  }
  if (typeof record.message === "string" && record.message.trim()) {
    return record.message;
  }
  return null;
}
