import { resolve } from "node:path";

export interface StudioConfig {
  authSessionStorePath: string;
  host: string;
  port: number;
  haBaseUrl: string;
  haToken: string | null;
  haConfigPath: string | null;
  requestTimeoutMs: number;
  blueprintImageDir: string;
  blueprintImageOverrideDir: string;
  switchManagerBlueprintDir: string;
  switchManagerLearningStorePath: string;
  automationsPath: string;
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

function resolveDataPath(value: string): string {
  return resolve(process.cwd(), value.trim());
}

export function loadConfig(): StudioConfig {
  const haBaseUrl = cleanBaseUrl(
    firstEnvValue("HA_BASE_URL", "HASS_URL", "HOME_ASSISTANT_URL") ?? "http://127.0.0.1:8123"
  );

  const rawConfigPath = firstEnvValue("HA_CONFIG_PATH");
  const haConfigPath = rawConfigPath
    ? rawConfigPath.trim().replace(/\\/g, "/").replace(/\/+$/, "")
    : null;

  return {
    authSessionStorePath: resolveDataPath(process.env.SWITCH_MANAGER_AUTH_SESSION_STORE ?? "data/auth-sessions.json"),
    host: process.env.HOST ?? "0.0.0.0",
    port: Number(process.env.PORT ?? "8878"),
    haBaseUrl,
    haToken: process.env.HA_TOKEN?.trim() || null,
    haConfigPath,
    requestTimeoutMs: Number(process.env.HA_REQUEST_TIMEOUT_MS ?? "10000"),
    blueprintImageDir: resolveDataPath(process.env.SWITCH_MANAGER_BLUEPRINT_IMAGE_DIR ?? "data/blueprints"),
    blueprintImageOverrideDir: resolveDataPath(
      process.env.SWITCH_MANAGER_BLUEPRINT_OVERRIDE_IMAGE_DIR ?? "data/blueprints-overrides"
    ),
    switchManagerBlueprintDir: process.env.SWITCH_MANAGER_BLUEPRINT_DIR ?? "blueprints/switch_manager",
    switchManagerLearningStorePath:
      process.env.SWITCH_MANAGER_LEARNING_STORE_PATH ?? ".storage/switch_manager_learning",
    automationsPath: process.env.SWITCH_MANAGER_AUTOMATIONS_PATH ?? "automations.yaml"
  };
}
