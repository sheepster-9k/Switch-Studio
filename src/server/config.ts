import { resolve } from "node:path";
import { URL } from "node:url";

export interface StudioConfig {
  host: string;
  port: number;
  haBaseUrl: string;
  haToken: string | null;
  haAgentUrl: string;
  haAgentKey: string | null;
  requestTimeoutMs: number;
  switchManagerStorePath: string;
  switchManagerLearningStorePath: string;
  switchManagerBlueprintDir: string;
  automationsPath: string;
  blueprintImageDir: string;
}

function cleanBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/, "");
}

function firstEnvValue(...keys: string[]): string | null {
  for (const key of keys) {
    const value = process.env[key]?.trim();
    if (value) {
      return value;
    }
  }
  return null;
}

function cleanConfigPath(value: string): string {
  return value.trim().replace(/\\/g, "/").replace(/^\/+/, "").replace(/\/+$/, "");
}

function resolveDataPath(value: string): string {
  return resolve(process.cwd(), value.trim());
}

function deriveAgentUrl(haBaseUrl: string): string {
  try {
    const url = new URL(haBaseUrl);
    url.port = process.env.HA_AGENT_PORT?.trim() || "8099";
    return cleanBaseUrl(url.toString());
  } catch {
    return "http://127.0.0.1:8099";
  }
}

export function loadConfig(): StudioConfig {
  const haBaseUrl = cleanBaseUrl(
    firstEnvValue("HA_BASE_URL", "HASS_URL", "HOME_ASSISTANT_URL") ?? "http://127.0.0.1:8123"
  );
  const haAgentUrl = cleanBaseUrl(firstEnvValue("HA_AGENT_URL") ?? deriveAgentUrl(haBaseUrl));

  return {
    host: process.env.HOST ?? "0.0.0.0",
    port: Number(process.env.PORT ?? "8878"),
    haBaseUrl,
    haToken: process.env.HA_TOKEN?.trim() || null,
    haAgentUrl,
    haAgentKey: process.env.HA_AGENT_KEY?.trim() || null,
    requestTimeoutMs: Number(process.env.HA_REQUEST_TIMEOUT_MS ?? "10000"),
    switchManagerStorePath: cleanConfigPath(process.env.SWITCH_MANAGER_STORE_PATH ?? ".storage/switch_manager"),
    switchManagerLearningStorePath: cleanConfigPath(
      process.env.SWITCH_MANAGER_LEARNING_STORE_PATH ?? ".storage/switch_manager_learning"
    ),
    switchManagerBlueprintDir: cleanConfigPath(
      process.env.SWITCH_MANAGER_BLUEPRINT_DIR ?? "blueprints/switch_manager"
    ),
    automationsPath: cleanConfigPath(process.env.AUTOMATIONS_PATH ?? "automations.yaml"),
    blueprintImageDir: resolveDataPath(process.env.SWITCH_MANAGER_BLUEPRINT_IMAGE_DIR ?? "data/blueprints")
  };
}
