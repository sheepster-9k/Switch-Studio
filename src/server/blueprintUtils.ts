import { constants } from "node:fs";
import { access, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { gzipSync } from "node:zlib";

import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

import {
  type BlueprintImageStatus,
  type SwitchManagerBlueprint,
  type SwitchManagerButtonLayoutOverride,
  type SwitchManagerConfig
} from "../shared/types.js";
import { isRecord, asString, asNumber, asArray, cloneValue } from "../shared/utils.js";
import type { StudioConfig } from "./config.js";
import type { HomeAssistantClient } from "./haClient.js";
import { buildTarArchive, type BlueprintPackageEntry } from "./tarBuilder.js";

export async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export function sanitizeBlueprintId(value: string): string | null {
  return /^[A-Za-z0-9._-]+$/.test(value) ? value : null;
}

export function slugifyBlueprintPart(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

export function exportBlueprintStem(blueprint: SwitchManagerBlueprint): string {
  const blueprintId = slugifyBlueprintPart(blueprint.id);
  if (blueprintId) {
    return blueprintId;
  }
  const service = slugifyBlueprintPart(blueprint.service);
  const name = slugifyBlueprintPart(blueprint.name);
  const combined = [service, name].filter(Boolean).join("-");
  return combined || "switch-manager-blueprint";
}

export function resolveHaPath(config: StudioConfig, relativePath: string): string | null {
  return config.haConfigPath ? `${config.haConfigPath}/${relativePath}` : null;
}

export function buttonLayoutOverridesFromConfig(
  configEntry: SwitchManagerConfig,
  expectedCount: number
): Array<SwitchManagerButtonLayoutOverride | null> {
  const metadata = isRecord(configEntry.metadata) ? configEntry.metadata : null;
  const layout = metadata && isRecord(metadata.layout) ? metadata.layout : null;
  const rawOverrides = layout && Array.isArray(layout.buttonOverrides) ? layout.buttonOverrides : [];

  return Array.from({ length: expectedCount }, (_, index) => {
    const rawOverride = rawOverrides[index];
    if (!isRecord(rawOverride)) {
      return null;
    }

    const width = Math.max(12, asNumber(rawOverride.width, 12));
    const height = Math.max(12, asNumber(rawOverride.height, width));

    return {
      shape: rawOverride.shape === "circle" ? "circle" : "rect",
      x: asNumber(rawOverride.x, 0),
      y: asNumber(rawOverride.y, 0),
      width,
      height
    };
  });
}

export function fallbackBlueprintDefinition(blueprint: SwitchManagerBlueprint): Record<string, unknown> {
  return {
    name: blueprint.name,
    service: blueprint.service,
    event_type: blueprint.eventType,
    ...(blueprint.identifierKey ? { identifier_key: blueprint.identifierKey } : {}),
    ...(blueprint.info ? { info: blueprint.info } : {}),
    buttons: blueprint.buttons.map((button) => ({
      ...(typeof button.x === "number" ? { x: button.x } : {}),
      ...(typeof button.y === "number" ? { y: button.y } : {}),
      ...(typeof button.width === "number" ? { width: button.width } : {}),
      ...(typeof button.height === "number" ? { height: button.height } : {}),
      ...(typeof button.d === "string" ? { d: button.d } : {}),
      ...(button.conditions?.length ? { conditions: button.conditions } : {}),
      actions: button.actions.map((action) => ({
        title: action.title,
        ...(action.conditions?.length ? { conditions: action.conditions } : {})
      }))
    }))
  };
}

export function applyLayoutOverridesToBlueprintDefinition(
  definition: Record<string, unknown>,
  configEntry: SwitchManagerConfig,
  warnings: string[]
): Record<string, unknown> {
  const nextDefinition = cloneValue(definition);
  const rawButtons = asArray<Record<string, unknown>>(nextDefinition.buttons).map((button) =>
    isRecord(button) ? cloneValue(button) : {}
  );
  const overrides = buttonLayoutOverridesFromConfig(configEntry, rawButtons.length);
  const singleButton = rawButtons.length <= 1;

  nextDefinition.buttons = rawButtons.map((rawButton, index) => {
    const nextButton = cloneValue(rawButton);
    const hadShape = ["x", "y", "width", "height", "d"].some((key) => key in nextButton);
    delete nextButton.x;
    delete nextButton.y;
    delete nextButton.width;
    delete nextButton.height;
    delete nextButton.d;

    if (singleButton) {
      if (hadShape || overrides[index]) {
        warnings.push("Single-button exports omit shape properties to match Switch Manager blueprint rules.");
      }
      return nextButton;
    }

    const override = overrides[index];
    if (!override) {
      if ("x" in rawButton) {
        nextButton.x = rawButton.x;
      }
      if ("y" in rawButton) {
        nextButton.y = rawButton.y;
      }
      if ("width" in rawButton) {
        nextButton.width = rawButton.width;
      }
      if ("height" in rawButton) {
        nextButton.height = rawButton.height;
      }
      if ("d" in rawButton) {
        nextButton.d = rawButton.d;
      }
      return nextButton;
    }

    if (override.shape === "circle") {
      if (Math.abs(override.width - override.height) > 1) {
        warnings.push(
          `Button ${index + 1} used a non-uniform circle override. Export normalized it to a single width value.`
        );
      }

      nextButton.x = Math.round(override.x + override.width / 2);
      nextButton.y = Math.round(override.y + override.height / 2);
      nextButton.width = Math.round(Math.max(override.width, override.height));
      return nextButton;
    }

    nextButton.x = Math.round(override.x);
    nextButton.y = Math.round(override.y);
    nextButton.width = Math.round(override.width);
    nextButton.height = Math.round(override.height);
    return nextButton;
  });

  return nextDefinition;
}

export function isPngBuffer(buffer: Buffer): boolean {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  return buffer.length >= signature.length && signature.every((value, index) => buffer[index] === value);
}

export function readPngDimensions(buffer: Buffer): { height: number; width: number } | null {
  if (buffer.length < 24 || !isPngBuffer(buffer)) {
    return null;
  }

  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20)
  };
}

export function blueprintImagePath(root: string, blueprintId: string): string | null {
  const safeBlueprintId = sanitizeBlueprintId(blueprintId);
  return safeBlueprintId ? resolve(root, `${safeBlueprintId}.png`) : null;
}

export async function serveLocalBlueprintImage(
  imageRoot: string,
  blueprintId: string
): Promise<Buffer | null> {
  const safeBlueprintId = sanitizeBlueprintId(blueprintId);
  if (!safeBlueprintId) {
    return null;
  }

  const imagePath = resolve(imageRoot, `${safeBlueprintId}.png`);
  try {
    return await readFile(imagePath);
  } catch {
    return null;
  }
}

export async function loadBlueprintImageBuffer(
  blueprintId: string,
  config: StudioConfig,
  wsClient: HomeAssistantClient
): Promise<Buffer | null> {
  const overrideImage = await serveLocalBlueprintImage(config.blueprintImageOverrideDir, blueprintId);
  if (overrideImage) {
    return overrideImage;
  }

  const bundledImage = await serveLocalBlueprintImage(config.blueprintImageDir, blueprintId);
  if (bundledImage) {
    return bundledImage;
  }

  const response = await wsClient.fetch(`/assets/switch_manager/${encodeURIComponent(blueprintId)}.png`);
  if (!response.ok) {
    return null;
  }

  return Buffer.from(await response.arrayBuffer());
}

export async function saveBlueprintImageOverride(
  overrideRoot: string,
  blueprintId: string,
  imageBuffer: Buffer
): Promise<void> {
  const imagePath = blueprintImagePath(overrideRoot, blueprintId);
  if (!imagePath) {
    throw new Error("Blueprint id is invalid");
  }
  if (!isPngBuffer(imageBuffer)) {
    throw new Error("Uploaded image must already be PNG formatted");
  }

  await mkdir(overrideRoot, { recursive: true });
  const tmpPath = imagePath + ".tmp";
  await writeFile(tmpPath, imageBuffer);
  await rename(tmpPath, imagePath);
}

export async function removeBlueprintImageOverride(overrideRoot: string, blueprintId: string): Promise<void> {
  const imagePath = blueprintImagePath(overrideRoot, blueprintId);
  if (!imagePath) {
    return;
  }
  try {
    await unlink(imagePath);
  } catch {
    // File already gone — nothing to do.
  }
}

export async function loadBlueprintImageStatus(
  blueprintId: string,
  config: StudioConfig,
  wsClient: HomeAssistantClient
): Promise<BlueprintImageStatus> {
  const overrideBuffer = await serveLocalBlueprintImage(config.blueprintImageOverrideDir, blueprintId);
  if (overrideBuffer) {
    const dimensions = readPngDimensions(overrideBuffer);
    return {
      blueprintId,
      hasImage: true,
      hasOverride: true,
      width: dimensions?.width ?? null,
      height: dimensions?.height ?? null
    };
  }

  const bundledBuffer = await serveLocalBlueprintImage(config.blueprintImageDir, blueprintId);
  if (bundledBuffer) {
    const dimensions = readPngDimensions(bundledBuffer);
    return {
      blueprintId,
      hasImage: true,
      hasOverride: false,
      width: dimensions?.width ?? null,
      height: dimensions?.height ?? null
    };
  }

  const response = await wsClient.fetch(`/assets/switch_manager/${encodeURIComponent(blueprintId)}.png`);
  if (response.ok) {
    const buffer = Buffer.from(await response.arrayBuffer());
    const dimensions = readPngDimensions(buffer);
    return {
      blueprintId,
      hasImage: true,
      hasOverride: false,
      width: dimensions?.width ?? null,
      height: dimensions?.height ?? null
    };
  }

  return {
    blueprintId,
    hasImage: false,
    hasOverride: false,
    width: null,
    height: null
  };
}

export function buildBlueprintSubmissionNotes(args: {
  fileStem: string;
  imageDimensions: { height: number; width: number } | null;
  includesImage: boolean;
  sourceBlueprintId: string;
  usedRawBlueprint: boolean;
  warnings: string[];
}): string {
  const lines = [
    "# Switch Manager Blueprint Export",
    "",
    `Generated from source blueprint \`${args.sourceBlueprintId}\`.`,
    `Target blueprint file: \`${args.fileStem}.yaml\`.`,
    args.includesImage
      ? `Included image: \`${args.fileStem}.png\`${args.imageDimensions ? ` (${args.imageDimensions.width}x${args.imageDimensions.height})` : ""}.`
      : "Included image: none.",
    args.usedRawBlueprint
      ? "This export started from the raw blueprint YAML and applied the current layout overrides from Switch Manager Studio."
      : "This export used the in-memory Switch Manager blueprint data because raw YAML access was unavailable.",
    "Live switch identifiers, rooms, automations, and action sequences are not included.",
    "",
    "Submission checklist",
    "",
    "- Use a lowercase filename in the form `{service-name}-{switch-name-or-type}.yaml`.",
    "- If you include an image, keep the same filename stem and use `.png`.",
    "- PNG images should stay within 500px height or 800px width.",
    "- Transparent backgrounds are preferred.",
    "- Single-button blueprints should not contain shape properties.",
    "- Keep action titles lowercase and ordered `init`, `press`, `press 2x`, `press 3x`, `hold`, `hold (released)`, then unique actions.",
    "- For shared MQTT blueprints, use the integration's default topic format rather than a customized one.",
    "",
    "Reference",
    "",
    "- https://github.com/Sian-Lee-SA/Home-Assistant-Switch-Manager",
    "- https://raw.githubusercontent.com/Sian-Lee-SA/Home-Assistant-Switch-Manager/master/README.md"
  ];

  if (args.warnings.length) {
    lines.push("", "Warnings", "");
    for (const warning of args.warnings) {
      lines.push(`- ${warning}`);
    }
  }

  return `${lines.join("\n")}\n`;
}

async function loadRawBlueprintDefinition(
  config: StudioConfig,
  blueprintId: string
): Promise<Record<string, unknown> | null> {
  const safeBlueprintId = sanitizeBlueprintId(blueprintId);
  const filePath = safeBlueprintId
    ? resolveHaPath(config, `${config.switchManagerBlueprintDir}/${safeBlueprintId}.yaml`)
    : null;
  if (!filePath) {
    return null;
  }

  try {
    const content = await readFile(filePath, "utf8");
    const parsed = parseYaml(content);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export async function buildBlueprintExportPackage(args: {
  wsClient: HomeAssistantClient;
  config: StudioConfig;
  draft: SwitchManagerConfig;
  blueprint: SwitchManagerBlueprint;
}): Promise<{ content: Buffer; fileName: string }> {
  const rawBlueprint = await loadRawBlueprintDefinition(args.config, args.blueprint.id);
  const exportWarnings: string[] = [];
  const exportDefinition = applyLayoutOverridesToBlueprintDefinition(
    rawBlueprint ?? fallbackBlueprintDefinition(args.blueprint),
    args.draft,
    exportWarnings
  );
  if (!rawBlueprint) {
    exportWarnings.unshift(
      "Raw blueprint YAML was unavailable, so this package was generated from the loaded Switch Manager blueprint data."
    );
    if (args.blueprint.isMqtt) {
      exportWarnings.push(
        "MQTT topic format details are not exposed by the loaded blueprint snapshot. Review and add `mqtt_topic_format` before submitting."
      );
    }
  }
  const fileStem = exportBlueprintStem(args.blueprint);
  const imageBuffer = await loadBlueprintImageBuffer(args.blueprint.id, args.config, args.wsClient);
  const imageDimensions = imageBuffer ? readPngDimensions(imageBuffer) : null;

  if (args.blueprint.buttons.length > 1 && !imageBuffer) {
    exportWarnings.push("Multiple-button blueprints should include a matching PNG, but no image was available to package.");
  }
  if (imageDimensions && (imageDimensions.height > 500 || imageDimensions.width > 800)) {
    exportWarnings.push(
      `The packaged PNG is ${imageDimensions.width}x${imageDimensions.height}; Switch Manager recommends a maximum of 800px width or 500px height.`
    );
  }

  const notes = buildBlueprintSubmissionNotes({
    fileStem,
    imageDimensions,
    includesImage: Boolean(imageBuffer),
    sourceBlueprintId: args.blueprint.id,
    usedRawBlueprint: Boolean(rawBlueprint),
    warnings: exportWarnings
  });

  const entries: BlueprintPackageEntry[] = [
    {
      name: `${fileStem}.yaml`,
      data: Buffer.from(stringifyYaml(exportDefinition).replace(/\s*$/, "\n"), "utf8")
    },
    {
      name: "SUBMISSION_NOTES.md",
      data: Buffer.from(notes, "utf8")
    }
  ];

  if (imageBuffer) {
    entries.push({
      name: `${fileStem}.png`,
      data: imageBuffer
    });
  }

  return {
    fileName: `switch-manager-blueprint-${fileStem}.tar.gz`,
    content: gzipSync(buildTarArchive(entries))
  };
}
