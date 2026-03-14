import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import YAML from "yaml";

export interface MmwaveConfig {
  mqttUrl: string;
  mqttUser?: string;
  mqttPassword?: string;
  baseTopic: string;
}

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
  mmwave: MmwaveConfig | null;
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

  const mmwave = loadMmwaveConfig();

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
    automationsPath: process.env.SWITCH_MANAGER_AUTOMATIONS_PATH ?? "automations.yaml",
    mmwave
  };
}

interface Z2mConfigFile {
  mqtt?: {
    server?: string;
    user?: string;
    password?: string;
    base_topic?: string;
  };
}

function loadMmwaveConfig(): MmwaveConfig | null {
  const envMqttUrl = process.env.MQTT_URL;
  const envBaseTopic = process.env.Z2M_BASE_TOPIC;
  const envMqttUser = process.env.MQTT_USER;
  const envMqttPassword = process.env.MQTT_PASSWORD;

  if (envMqttUrl && envBaseTopic) {
    return {
      mqttUrl: envMqttUrl,
      mqttUser: envMqttUser,
      mqttPassword: envMqttPassword,
      baseTopic: envBaseTopic
    };
  }

  const z2mCandidates = [
    process.env.Z2M_CONFIG,
    resolve(process.cwd(), "../../zigbee2mqtt/configuration.yaml"),
    resolve(process.cwd(), "../zigbee2mqtt/configuration.yaml"),
    resolve(process.cwd(), "zigbee2mqtt/configuration.yaml")
  ].filter((v): v is string => Boolean(v));

  const z2mConfigPath = z2mCandidates.find((c) => existsSync(c));
  if (!z2mConfigPath) {
    return null;
  }

  try {
    const parsed = YAML.parse(readFileSync(z2mConfigPath, "utf8")) as Z2mConfigFile;
    const mqtt = parsed.mqtt ?? {};
    return {
      mqttUrl: envMqttUrl ?? mqtt.server ?? "mqtt://127.0.0.1:1883",
      mqttUser: envMqttUser ?? mqtt.user,
      mqttPassword: envMqttPassword ?? mqtt.password,
      baseTopic: envBaseTopic ?? mqtt.base_topic ?? "zigbee2mqtt"
    };
  } catch {
    return null;
  }
}
