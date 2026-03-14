import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import type { AreaKind, AreaLabelCollection, AreaSlot, DeviceAreaLabels } from "../../shared/mmwaveTypes.js";
import { AREA_KINDS, AREA_SLOTS } from "../../shared/mmwaveUtils.js";

interface AreaLabelFile {
  version: 1;
  devices: Record<string, DeviceAreaLabels>;
}

function emptyCollection(): AreaLabelCollection {
  return {
    area1: "",
    area2: "",
    area3: "",
    area4: ""
  };
}

function emptyLabels(): DeviceAreaLabels {
  return {
    detection: emptyCollection(),
    interference: emptyCollection(),
    stay: emptyCollection()
  };
}

function sanitizeLabel(value: unknown): string {
  return typeof value === "string" ? value.trim().slice(0, 48) : "";
}

function normalizeLabels(input?: Partial<Record<AreaKind, Partial<Record<AreaSlot, unknown>>>> | null): DeviceAreaLabels {
  const labels = emptyLabels();
  for (const kind of AREA_KINDS) {
    for (const slot of AREA_SLOTS) {
      labels[kind][slot] = sanitizeLabel(input?.[kind]?.[slot]);
    }
  }
  return labels;
}

export class AreaLabelStore {
  private cache: Record<string, DeviceAreaLabels> = {};

  constructor(private readonly filePath: string) {}

  async load(): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    try {
      const raw = await readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as Partial<AreaLabelFile>;
      const devices =
        parsed.devices && typeof parsed.devices === "object" ? parsed.devices : {};
      this.cache = Object.fromEntries(
        Object.entries(devices).map(([name, labels]) => [name, normalizeLabels(labels)])
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        this.cache = {};
        await this.write();
        return;
      }
      if (error instanceof SyntaxError) {
        this.cache = {};
        await this.write();
        return;
      }
      throw error;
    }
  }

  getForDevice(deviceName: string): DeviceAreaLabels {
    return this.cache[deviceName] ?? emptyLabels();
  }

  async setLabel(deviceName: string, kind: AreaKind, slot: AreaSlot, label: string): Promise<DeviceAreaLabels> {
    const current = normalizeLabels(this.cache[deviceName]);
    current[kind][slot] = sanitizeLabel(label);
    this.cache[deviceName] = current;
    await this.write();
    return current;
  }

  private async write(): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    const tempPath = `${this.filePath}.tmp`;
    await writeFile(
      tempPath,
      JSON.stringify({ version: 1, devices: this.cache }, null, 2),
      "utf8"
    );
    await rename(tempPath, this.filePath);
  }
}
