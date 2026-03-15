import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import type {
  AreaCollection,
  AreaRect,
  AreaSlot,
  BaseBounds,
  DeviceProfileSettings,
  StudioProfile,
  UpsertProfileRequest
} from "../../shared/mmwaveTypes.js";
import { ZERO_AREA, finiteOr, clamp, cloneArea, sortProfiles } from "../../shared/mmwaveUtils.js";

interface ProfileFile {
  version: 1;
  profiles: StudioProfile[];
}

const EMPTY_COLLECTION: AreaCollection = {
  area1: { ...ZERO_AREA },
  area2: { ...ZERO_AREA },
  area3: { ...ZERO_AREA },
  area4: { ...ZERO_AREA }
};

function cloneCollection(input?: Partial<Record<AreaSlot, Partial<AreaRect> | null>> | null): AreaCollection {
  return {
    area1: cloneArea(input?.area1),
    area2: cloneArea(input?.area2),
    area3: cloneArea(input?.area3),
    area4: cloneArea(input?.area4)
  };
}

function cloneBounds(bounds?: Partial<BaseBounds> | null): BaseBounds {
  return {
    width_min: finiteOr(bounds?.width_min, -600),
    width_max: finiteOr(bounds?.width_max, 600),
    depth_min: finiteOr(bounds?.depth_min, 0),
    depth_max: finiteOr(bounds?.depth_max, 600),
    height_min: finiteOr(bounds?.height_min, -300),
    height_max: finiteOr(bounds?.height_max, 300)
  };
}

function normalizeSettings(input: Partial<DeviceProfileSettings> | null | undefined): DeviceProfileSettings {
  return {
    roomPreset: typeof input?.roomPreset === "string" ? input.roomPreset : "Custom",
    detectSensitivity: typeof input?.detectSensitivity === "string" ? input.detectSensitivity : "Medium",
    detectTrigger:
      typeof input?.detectTrigger === "string" ? input.detectTrigger : "Fast (0.2s, default)",
    holdTime: finiteOr(input?.holdTime, 30),
    stayLife: finiteOr(input?.stayLife, 300),
    targetInfoReport:
      typeof input?.targetInfoReport === "string" ? input.targetInfoReport : "Enable",
    controlWiredDevice:
      typeof input?.controlWiredDevice === "string"
        ? input.controlWiredDevice
        : "Occupancy (default)",
    defaultLevelLocal: clamp(Math.round(finiteOr(input?.defaultLevelLocal, 255)), 1, 255),
    baseBounds: cloneBounds(input?.baseBounds)
  };
}

function normalizeProfile(input: Partial<StudioProfile> & Pick<StudioProfile, "name" | "sourceDevice">): StudioProfile {
  const now = new Date().toISOString();
  return {
    id: typeof input.id === "string" && input.id ? input.id : randomUUID(),
    name: input.name.trim(),
    notes: typeof input.notes === "string" ? input.notes : "",
    model: typeof input.model === "string" && input.model ? input.model : "VZM32-SN",
    sourceDevice: input.sourceDevice.trim(),
    createdAt: typeof input.createdAt === "string" && input.createdAt ? input.createdAt : now,
    updatedAt: typeof input.updatedAt === "string" && input.updatedAt ? input.updatedAt : now,
    settings: normalizeSettings(input.settings),
    areas: {
      detection: cloneCollection(input.areas?.detection ?? EMPTY_COLLECTION),
      interference: cloneCollection(input.areas?.interference ?? EMPTY_COLLECTION),
      stay: cloneCollection(input.areas?.stay ?? EMPTY_COLLECTION)
    }
  };
}

function importCandidates(payload: unknown): unknown[] {
  if (Array.isArray(payload)) {
    return payload;
  }
  if (payload && typeof payload === "object") {
    const record = payload as { profiles?: unknown };
    if (Array.isArray(record.profiles)) {
      return record.profiles;
    }
  }
  return [payload];
}

export class FileProfileStore {
  constructor(private readonly filePath: string) {}

  private async readStore(): Promise<ProfileFile> {
    await mkdir(dirname(this.filePath), { recursive: true });
    try {
      const raw = await readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as Partial<ProfileFile>;
      const profiles = Array.isArray(parsed.profiles)
        ? parsed.profiles
            .filter((profile): profile is StudioProfile => Boolean(profile) && typeof profile === "object")
            .map((profile) =>
              normalizeProfile({
                ...profile,
                name: String(profile.name ?? "Imported profile"),
                sourceDevice: String(profile.sourceDevice ?? "Unknown switch")
              })
            )
        : [];
      return { version: 1, profiles: sortProfiles(profiles) };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT" || error instanceof SyntaxError) {
        const fresh: ProfileFile = { version: 1, profiles: [] };
        await this.writeStore(fresh);
        return fresh;
      }
      throw error;
    }
  }

  private async writeStore(store: ProfileFile): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    const tempPath = `${this.filePath}.tmp`;
    const payload = JSON.stringify({ version: 1, profiles: sortProfiles(store.profiles) }, null, 2);
    await writeFile(tempPath, payload, "utf8");
    await rename(tempPath, this.filePath);
  }

  async list(): Promise<StudioProfile[]> {
    return (await this.readStore()).profiles;
  }

  async get(id: string): Promise<StudioProfile | null> {
    return (await this.readStore()).profiles.find((profile) => profile.id === id) ?? null;
  }

  async create(input: UpsertProfileRequest): Promise<StudioProfile> {
    const store = await this.readStore();
    const profile = normalizeProfile({
      name: input.name,
      notes: input.notes,
      model: input.model,
      sourceDevice: input.sourceDevice,
      settings: input.settings,
      areas: input.areas
    });
    store.profiles = [profile, ...store.profiles.filter((entry) => entry.id !== profile.id)];
    await this.writeStore(store);
    return profile;
  }

  async update(id: string, input: UpsertProfileRequest): Promise<StudioProfile | null> {
    const store = await this.readStore();
    const current = store.profiles.find((profile) => profile.id === id);
    if (!current) {
      return null;
    }
    const updated = normalizeProfile({
      ...current,
      id,
      name: input.name,
      notes: input.notes,
      model: input.model ?? current.model,
      sourceDevice: input.sourceDevice,
      settings: input.settings,
      areas: input.areas,
      createdAt: current.createdAt,
      updatedAt: new Date().toISOString()
    });
    store.profiles = [updated, ...store.profiles.filter((profile) => profile.id !== id)];
    await this.writeStore(store);
    return updated;
  }

  async delete(id: string): Promise<boolean> {
    const store = await this.readStore();
    const next = store.profiles.filter((profile) => profile.id !== id);
    if (next.length === store.profiles.length) {
      return false;
    }
    store.profiles = next;
    await this.writeStore(store);
    return true;
  }

  async import(payload: unknown): Promise<StudioProfile[]> {
    const incoming = importCandidates(payload);
    const store = await this.readStore();
    const byId = new Map(store.profiles.map((profile) => [profile.id, profile]));

    for (const candidate of incoming) {
      if (!candidate || typeof candidate !== "object") {
        continue;
      }
      const record = candidate as Partial<StudioProfile>;
      if (!record.name || !record.sourceDevice) {
        continue;
      }
      const profile = normalizeProfile({
        ...record,
        updatedAt: new Date().toISOString(),
        createdAt: typeof record.createdAt === "string" && record.createdAt ? record.createdAt : undefined,
        name: String(record.name),
        sourceDevice: String(record.sourceDevice)
      });
      byId.set(profile.id, profile);
    }

    store.profiles = sortProfiles(Array.from(byId.values()));
    await this.writeStore(store);
    return store.profiles;
  }
}
