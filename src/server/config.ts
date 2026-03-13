import { resolve } from "node:path";

export interface StudioConfig {
  authSessionStorePath: string;
  host: string;
  port: number;
  defaultHaBaseUrl: string | null;
  requestTimeoutMs: number;
  blueprintImageDir: string;
  blueprintImageOverrideDir: string;
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
  const defaultHaBaseUrl = firstEnvValue("HA_BASE_URL", "HASS_URL", "HOME_ASSISTANT_URL");

  return {
    authSessionStorePath: resolveDataPath(process.env.SWITCH_MANAGER_AUTH_SESSION_STORE ?? "data/auth-sessions.json"),
    host: process.env.HOST ?? "0.0.0.0",
    port: Number(process.env.PORT ?? "8878"),
    defaultHaBaseUrl: defaultHaBaseUrl ? cleanBaseUrl(defaultHaBaseUrl) : null,
    requestTimeoutMs: Number(process.env.HA_REQUEST_TIMEOUT_MS ?? "10000"),
    blueprintImageDir: resolveDataPath(process.env.SWITCH_MANAGER_BLUEPRINT_IMAGE_DIR ?? "data/blueprints"),
    blueprintImageOverrideDir: resolveDataPath(
      process.env.SWITCH_MANAGER_BLUEPRINT_OVERRIDE_IMAGE_DIR ?? "data/blueprints-overrides"
    )
  };
}
