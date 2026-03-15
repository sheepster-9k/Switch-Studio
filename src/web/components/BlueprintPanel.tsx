import { useEffect, useRef, useState } from "react";

import {
  deleteBlueprintImageOverride,
  fetchBlueprintImageStatus,
  fetchDeviceImage,
  uploadBlueprintImageOverride
} from "../api";
import { blueprintImageUrl, convertToPng, loadImageElement } from "../imageUtils";
import type {
  AreaSummary,
  BlueprintImageStatus,
  SwitchManagerBlueprint,
  SwitchManagerButtonLayoutOverride,
  SwitchManagerConfig,
  SwitchManagerGridSettings
} from "../../shared/types";
import { clamp } from "../../shared/utils";
import {
  blueprintViewBox,
  buttonBounds,
  buttonLayoutBounds,
  countActiveActions,
  getLayoutMetadata,
  renderBlueprintShape,
  snapOverrideToGrid
} from "../helpers";

interface BlueprintPanelProps {
  areas: AreaSummary[];
  draft: SwitchManagerConfig;
  exportingPackage: boolean;
  onAreaChange: (areaId: string | null) => void;
  onButtonLayoutChange: (index: number, override: SwitchManagerButtonLayoutOverride | null) => void;
  onDelete: () => void;
  onEnabledToggle: (enabled: boolean) => void;
  onExportPackage: () => void;
  onGridChange: (grid: Partial<SwitchManagerGridSettings>) => void;
  onIdentifierChange: (value: string) => void;
  onNameChange: (value: string) => void;
  onNotify: (notice: { kind: "error" | "success"; text: string }) => void;
  onResetToSaved: (() => void) | null;
  onRotateChange: (value: number) => void;
  onSelectButton: (index: number) => void;
  selectedAreaId: string | null;
  selectedBlueprint: SwitchManagerBlueprint;
  selectedButtonIndex: number;
}

interface PointerDragState {
  buttonIndex: number;
  pointerId: number;
  startX: number;
  startY: number;
  startOverride: SwitchManagerButtonLayoutOverride;
}

interface BlueprintImageSize {
  width: number;
  height: number;
}

interface BlueprintViewport {
  minX: number;
  minY: number;
  width: number;
  height: number;
}

const blueprintImageSizeCache = new Map<string, BlueprintImageSize>();

function editableSeed(
  blueprint: SwitchManagerBlueprint,
  selectedIndex: number,
  override: SwitchManagerButtonLayoutOverride | null
): SwitchManagerButtonLayoutOverride {
  if (override) {
    return override;
  }
  const bounds = buttonBounds(blueprint.buttons[selectedIndex]);
  return {
    shape:
      typeof blueprint.buttons[selectedIndex]?.height === "number" ||
      typeof blueprint.buttons[selectedIndex]?.d === "string"
        ? "rect"
        : "circle",
    x: bounds.minX,
    y: bounds.minY,
    width: bounds.maxX - bounds.minX,
    height: bounds.maxY - bounds.minY
  };
}

function svgPoint(svg: SVGSVGElement, clientX: number, clientY: number): { x: number; y: number } | null {
  const point = svg.createSVGPoint();
  point.x = clientX;
  point.y = clientY;
  const matrix = svg.getScreenCTM();
  if (!matrix) {
    return null;
  }
  const transformed = point.matrixTransform(matrix.inverse());
  return {
    x: transformed.x,
    y: transformed.y
  };
}

async function loadBlueprintImage(blueprintId: string, revision = 0): Promise<HTMLImageElement> {
  return loadImageElement(blueprintImageUrl(blueprintId, revision));
}

async function loadBlueprintImageSize(blueprintId: string, revision = 0): Promise<BlueprintImageSize> {
  const cacheKey = `${blueprintId}:${revision}`;
  const cached = blueprintImageSizeCache.get(cacheKey);
  if (cached) {
    return cached;
  }
  const image = await loadBlueprintImage(blueprintId, revision);
  const size = {
    width: image.naturalWidth,
    height: image.naturalHeight
  };
  blueprintImageSizeCache.set(cacheKey, size);
  return size;
}


function resolveBlueprintViewport(
  blueprint: SwitchManagerBlueprint,
  imageSize: BlueprintImageSize | null
): BlueprintViewport {
  if (imageSize && imageSize.width > 0 && imageSize.height > 0) {
    return {
      minX: 0,
      minY: 0,
      width: imageSize.width,
      height: imageSize.height
    };
  }

  const [minX, minY, width, height] = blueprintViewBox(blueprint).split(" ").map(Number);
  return {
    minX,
    minY,
    width,
    height
  };
}

function clampOverrideToViewport(
  override: SwitchManagerButtonLayoutOverride,
  viewport: BlueprintViewport
): SwitchManagerButtonLayoutOverride {
  const width = clamp(override.width, 12, viewport.width);
  const height = clamp(override.height, 12, viewport.height);
  const maxX = viewport.minX + Math.max(0, viewport.width - width);
  const maxY = viewport.minY + Math.max(0, viewport.height - height);

  return {
    ...override,
    width,
    height,
    x: clamp(override.x, viewport.minX, maxX),
    y: clamp(override.y, viewport.minY, maxY)
  };
}

function grayscale(data: Uint8ClampedArray, x: number, y: number, width: number): number {
  const index = (y * width + x) * 4;
  return data[index] * 0.299 + data[index + 1] * 0.587 + data[index + 2] * 0.114;
}

function edgeColumnScore(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  x: number,
  top: number,
  bottom: number
): number {
  const clampedX = Math.max(0, Math.min(width - 2, Math.round(x)));
  const minY = Math.max(0, Math.min(height - 1, Math.round(top)));
  const maxY = Math.max(minY + 1, Math.min(height - 1, Math.round(bottom)));
  let score = 0;
  for (let y = minY; y < maxY; y += 1) {
    score += Math.abs(grayscale(data, clampedX, y, width) - grayscale(data, clampedX + 1, y, width));
  }
  return score / Math.max(1, maxY - minY);
}

function edgeRowScore(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  y: number,
  left: number,
  right: number
): number {
  const clampedY = Math.max(0, Math.min(height - 2, Math.round(y)));
  const minX = Math.max(0, Math.min(width - 1, Math.round(left)));
  const maxX = Math.max(minX + 1, Math.min(width - 1, Math.round(right)));
  let score = 0;
  for (let x = minX; x < maxX; x += 1) {
    score += Math.abs(grayscale(data, x, clampedY, width) - grayscale(data, x, clampedY + 1, width));
  }
  return score / Math.max(1, maxX - minX);
}

function strongestPosition(
  start: number,
  end: number,
  scorer: (position: number) => number
): { position: number; score: number } {
  let best = {
    position: Math.round(start),
    score: -1
  };
  for (let position = Math.round(start); position <= Math.round(end); position += 1) {
    const score = scorer(position);
    if (score > best.score) {
      best = {
        position,
        score
      };
    }
  }
  return best;
}

export function BlueprintPanel(props: BlueprintPanelProps) {
  const {
    areas,
    draft,
    exportingPackage,
    onAreaChange,
    onButtonLayoutChange,
    onDelete,
    onEnabledToggle,
    onExportPackage,
    onGridChange,
    onIdentifierChange,
    onNameChange,
    onNotify,
    onResetToSaved,
    onRotateChange,
    onSelectButton,
    selectedAreaId,
    selectedBlueprint,
    selectedButtonIndex
  } = props;
  const svgRef = useRef<SVGSVGElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [dragState, setDragState] = useState<PointerDragState | null>(null);
  const [layoutEditingEnabled, setLayoutEditingEnabled] = useState(false);
  const [imageStatus, setImageStatus] = useState<BlueprintImageStatus | null>(null);
  const [imageRevision, setImageRevision] = useState(0);
  const [imageBusy, setImageBusy] = useState(false);
  const [imageSize, setImageSize] = useState<BlueprintImageSize | null>(null);
  const layout = getLayoutMetadata(draft, selectedBlueprint.buttons.length);
  const overrides = layout.buttonOverrides;
  const grid = layout.grid;
  const viewport = resolveBlueprintViewport(selectedBlueprint, imageSize);
  const viewBox = `${viewport.minX} ${viewport.minY} ${viewport.width} ${viewport.height}`;
  const { minX: viewMinX, minY: viewMinY, width: viewWidth, height: viewHeight } = viewport;
  const selectedOverride = overrides[selectedButtonIndex] ?? null;
  const selectedSeed = editableSeed(selectedBlueprint, selectedButtonIndex, selectedOverride);
  const imageAvailable = Boolean(imageStatus?.hasImage && imageSize);
  const imageSrc = blueprintImageUrl(selectedBlueprint.id, imageRevision);

  useEffect(() => {
    let cancelled = false;
    setImageStatus(null);
    setImageSize(null);

    void fetchBlueprintImageStatus(selectedBlueprint.id)
      .then((status) => {
        if (cancelled) {
          return;
        }
        setImageStatus(status);
        if (!status.hasImage) {
          setImageSize(null);
          return;
        }

        const cacheKey = `${selectedBlueprint.id}:${imageRevision}`;
        const cached = blueprintImageSizeCache.get(cacheKey) ?? null;
        setImageSize(cached);

        void loadBlueprintImageSize(selectedBlueprint.id, imageRevision)
          .then((nextSize) => {
            if (!cancelled) {
              setImageSize(nextSize);
            }
          })
          .catch(() => {
            if (!cancelled) {
              setImageSize(null);
              setImageStatus((current) =>
                current
                  ? {
                      ...current,
                      hasImage: false,
                      width: null,
                      height: null
                    }
                  : current
              );
            }
          });
      })
      .catch(() => {
        if (!cancelled) {
          setImageStatus({
            blueprintId: selectedBlueprint.id,
            hasImage: false,
            hasOverride: false,
            width: null,
            height: null
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [imageRevision, selectedBlueprint.id]);

  useEffect(() => {
    if (!layoutEditingEnabled && dragState) {
      finishDrag(dragState.pointerId);
    }
  }, [dragState, layoutEditingEnabled]);

  // Prevent page scroll while dragging a button (non-passive so preventDefault works).
  useEffect(() => {
    if (!dragState || !svgRef.current) {
      return;
    }
    const svg = svgRef.current;
    const handler = (event: PointerEvent) => {
      event.preventDefault();
    };
    svg.addEventListener("pointermove", handler, { passive: false });
    return () => svg.removeEventListener("pointermove", handler);
  }, [dragState]);

  useEffect(() => {
    setImageRevision(0);
  }, [selectedBlueprint.id]);

  const verticalLines: number[] = [];
  const horizontalLines: number[] = [];
  if (grid.enabled) {
    let x = grid.offsetX;
    while (x > viewMinX) {
      x -= grid.cellWidth;
    }
    while (x <= viewMinX + viewWidth) {
      verticalLines.push(x);
      x += grid.cellWidth;
    }

    let y = grid.offsetY;
    while (y > viewMinY) {
      y -= grid.cellHeight;
    }
    while (y <= viewMinY + viewHeight) {
      horizontalLines.push(y);
      y += grid.cellHeight;
    }
  }

  function applyOverride(index: number, next: SwitchManagerButtonLayoutOverride | null): void {
    if (!next) {
      onButtonLayoutChange(index, null);
      return;
    }
    const normalized = {
      ...next,
      width: Math.max(12, next.width),
      height: Math.max(12, next.height)
    };
    const snapped = grid.enabled && grid.snap ? snapOverrideToGrid(normalized, grid) : normalized;
    onButtonLayoutChange(index, clampOverrideToViewport(snapped, viewport));
  }

  function finishDrag(pointerId?: number): void {
    if (svgRef.current && typeof pointerId === "number") {
      try {
        if (svgRef.current.hasPointerCapture(pointerId)) {
          svgRef.current.releasePointerCapture(pointerId);
        }
      } catch {
        // Ignore unsupported pointer capture environments.
      }
    }
    setDragState(null);
  }

  async function autoDetectSelected(): Promise<void> {
    try {
      if (!imageAvailable) {
        throw new Error("Import a blueprint image before using auto-detect.");
      }
      const seed = editableSeed(selectedBlueprint, selectedButtonIndex, selectedOverride);
      const image = await loadBlueprintImage(selectedBlueprint.id, imageRevision);
      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext("2d");
      if (!context) {
        throw new Error("Canvas context is unavailable");
      }
      context.drawImage(image, 0, 0);
      const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
      const marginX = Math.max(seed.width * 0.8, 18);
      const marginY = Math.max(seed.height * 0.8, 18);
      const searchLeft = Math.max(0, seed.x - marginX);
      const searchRight = Math.min(canvas.width - 1, seed.x + seed.width + marginX);
      const searchTop = Math.max(0, seed.y - marginY);
      const searchBottom = Math.min(canvas.height - 1, seed.y + seed.height + marginY);

      const left = strongestPosition(
        searchLeft,
        Math.min(searchRight - 6, seed.x + marginX),
        (position) => edgeColumnScore(imageData.data, canvas.width, canvas.height, position, searchTop, searchBottom)
      );
      const right = strongestPosition(
        Math.max(searchLeft + 6, seed.x + seed.width - marginX),
        searchRight,
        (position) => edgeColumnScore(imageData.data, canvas.width, canvas.height, position, searchTop, searchBottom)
      );
      const top = strongestPosition(
        searchTop,
        Math.min(searchBottom - 6, seed.y + marginY),
        (position) => edgeRowScore(imageData.data, canvas.width, canvas.height, position, searchLeft, searchRight)
      );
      const bottom = strongestPosition(
        Math.max(searchTop + 6, seed.y + seed.height - marginY),
        searchBottom,
        (position) => edgeRowScore(imageData.data, canvas.width, canvas.height, position, searchLeft, searchRight)
      );

      const next = {
        shape: seed.shape,
        x: left.position,
        y: top.position,
        width: right.position - left.position,
        height: bottom.position - top.position
      } satisfies SwitchManagerButtonLayoutOverride;

      const scoreFloor = 6;
      const valid =
        next.width >= 12 &&
        next.height >= 12 &&
        left.score >= scoreFloor &&
        right.score >= scoreFloor &&
        top.score >= scoreFloor &&
        bottom.score >= scoreFloor &&
        next.width <= seed.width * 3 &&
        next.height <= seed.height * 3;

      if (!valid) {
        throw new Error("No clear button outline found near the current bounds. Try adjusting the position manually.");
      }

      applyOverride(selectedButtonIndex, next);
      onNotify({
        kind: "success",
        text: `Auto-detected an outline for button ${selectedButtonIndex + 1}.`
      });
    } catch (error) {
      onNotify({
        kind: "error",
        text: error instanceof Error ? error.message : "Auto-detect failed for this button."
      });
    }
  }

  async function handleImportImage(file: File | null): Promise<void> {
    if (!file) {
      return;
    }

    try {
      setImageBusy(true);
      const pngBlob = await convertToPng(file);
      const status = await uploadBlueprintImageOverride(selectedBlueprint.id, pngBlob, file.name);
      setImageStatus(status);
      setImageRevision((current) => current + 1);
      setLayoutEditingEnabled(true);
      onNotify({
        kind: "success",
        text: `Imported ${file.name} as PNG${status.width && status.height ? ` (${status.width}x${status.height})` : ""}.`
      });
    } catch (error) {
      onNotify({
        kind: "error",
        text: error instanceof Error ? error.message : "Blueprint image import failed."
      });
    } finally {
      setImageBusy(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  }

  async function handleResetImage(): Promise<void> {
    try {
      setImageBusy(true);
      const status = await deleteBlueprintImageOverride(selectedBlueprint.id);
      setImageStatus(status);
      setImageRevision((current) => current + 1);
      onNotify({
        kind: "success",
        text: status.hasImage
          ? "Removed the custom blueprint image."
          : "Removed the custom blueprint image. No image remains for this blueprint."
      });
    } catch (error) {
      onNotify({
        kind: "error",
        text: error instanceof Error ? error.message : "Blueprint image reset failed."
      });
    } finally {
      setImageBusy(false);
    }
  }

  async function handleFetchDeviceImage(): Promise<void> {
    if (!draft.deviceId) {
      return;
    }
    try {
      setImageBusy(true);
      const blob = await fetchDeviceImage(draft.deviceId);
      const pngBlob = await convertToPng(blob);
      const status = await uploadBlueprintImageOverride(selectedBlueprint.id, pngBlob, "device-image.jpg");
      setImageStatus(status);
      setImageRevision((current) => current + 1);
      setLayoutEditingEnabled(true);
      onNotify({ kind: "success", text: `Fetched device image${status.width && status.height ? ` (${status.width}x${status.height})` : ""}.` });
    } catch (error) {
      onNotify({ kind: "error", text: error instanceof Error ? error.message : "Device image fetch failed." });
    } finally {
      setImageBusy(false);
    }
  }

  return (
    <section className="panel panel--form">
      <div className="panel-head">
        <div>
          <p className="eyebrow">Config</p>
          <h3>Switch identity</h3>
        </div>
        <div className="inline-actions">
          {onResetToSaved ? (
            <button
              className="button button--ghost"
              onClick={onResetToSaved}
              type="button"
            >
              Reset to saved
            </button>
          ) : null}
          <button
            className="button button--danger"
            onClick={onDelete}
            type="button"
          >
            Delete
          </button>
        </div>
      </div>

      <div className="field-grid">
        <label className="field">
          <span>Name</span>
          <input
            onChange={(event) => onNameChange(event.target.value)}
            type="text"
            value={draft.name}
          />
        </label>

        <label className="field">
          <span>Identifier</span>
          <input
            onChange={(event) => onIdentifierChange(event.target.value)}
            type="text"
            value={draft.identifier}
          />
        </label>

        <label className="field">
          <span>Room</span>
          <select
            onChange={(event) => onAreaChange(event.target.value || null)}
            value={selectedAreaId ?? ""}
          >
            <option value="">Unassigned</option>
            {areas.map((area) => (
              <option key={area.id} value={area.id}>
                {area.name}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span>Rotate</span>
          <input
            onChange={(event) => onRotateChange(Number(event.target.value) || 0)}
            step={90}
            type="number"
            value={draft.rotate}
          />
        </label>

        <label className="toggle-field">
          <span>Enabled</span>
          <button
            className={`toggle ${draft.enabled ? "toggle--on" : ""}`}
            onClick={() => onEnabledToggle(!draft.enabled)}
            type="button"
          >
            <span />
          </button>
        </label>
      </div>

      {draft.isMismatch || draft.error ? (
        <div className="warning-block">
          {draft.error ?? "Blueprint mismatch detected. Review before saving."}
        </div>
      ) : null}

      <div className="blueprint-stage">
        <div className="blueprint-stage__header">
          <div>
            <p className="eyebrow">Blueprint</p>
            <h3>{selectedBlueprint.name}</h3>
          </div>
          <div className="inline-actions">
            <span className="pill">{selectedBlueprint.buttons.length} buttons</span>
            <span className={`pill ${imageStatus?.hasOverride ? "" : "pill--muted"}`}>
              {imageStatus?.hasOverride ? "Custom image" : imageAvailable ? "Image available" : "No image"}
            </span>
            {draft.deviceId ? (
              <button
                className="button button--ghost"
                disabled={imageBusy}
                onClick={() => void handleFetchDeviceImage()}
                type="button"
              >
                Fetch from device
              </button>
            ) : null}
            <button
              className="button button--ghost"
              disabled={imageBusy}
              onClick={() => fileInputRef.current?.click()}
              type="button"
            >
              {imageBusy ? "Importing..." : "Import image"}
            </button>
            <button
              className="button button--ghost"
              disabled={imageBusy || !imageStatus?.hasOverride}
              onClick={() => void handleResetImage()}
              type="button"
            >
              Reset image
            </button>
            <button
              className="button button--ghost"
              disabled={exportingPackage || imageBusy}
              onClick={onExportPackage}
              type="button"
            >
              {exportingPackage ? "Preparing..." : "Export package"}
            </button>
          </div>
        </div>

        <input
          accept=".png,.jpg,.jpeg,.webp,.gif,.svg,image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
          hidden
          onChange={(event) => void handleImportImage(event.target.files?.[0] ?? null)}
          ref={fileInputRef}
          type="file"
        />

        <div className="blueprint-canvas-frame">
          <svg
            className={`blueprint-canvas ${layoutEditingEnabled ? "blueprint-canvas--editable" : "blueprint-canvas--locked"} ${dragState ? "blueprint-canvas--dragging" : ""}`}
            onPointerMove={(event) => {
              if (!layoutEditingEnabled || !dragState || event.pointerId !== dragState.pointerId || !svgRef.current) {
                return;
              }
              event.preventDefault();
              const point = svgPoint(svgRef.current, event.clientX, event.clientY);
              if (!point) {
                return;
              }
              applyOverride(dragState.buttonIndex, {
                ...dragState.startOverride,
                x: dragState.startOverride.x + (point.x - dragState.startX),
                y: dragState.startOverride.y + (point.y - dragState.startY)
              });
            }}
            onPointerCancel={(event) => finishDrag(event.pointerId)}
            onPointerLeave={(event) => {
              if (dragState?.pointerId === event.pointerId) {
                finishDrag(event.pointerId);
              }
            }}
            onPointerUp={(event) => finishDrag(event.pointerId)}
            preserveAspectRatio="xMidYMid meet"
            ref={svgRef}
            viewBox={viewBox}
          >
            {grid.enabled ? (
              <g className="blueprint-grid">
                {verticalLines.map((line) => (
                  <line
                    key={`grid-x-${line}`}
                    x1={line}
                    x2={line}
                    y1={viewMinY}
                    y2={viewMinY + viewHeight}
                  />
                ))}
                {horizontalLines.map((line) => (
                  <line
                    key={`grid-y-${line}`}
                    x1={viewMinX}
                    x2={viewMinX + viewWidth}
                    y1={line}
                    y2={line}
                  />
                ))}
              </g>
            ) : null}

            {imageAvailable ? (
              <image
                draggable="false"
                height={imageSize?.height ?? viewHeight}
                href={imageSrc}
                preserveAspectRatio="none"
                width={imageSize?.width ?? viewWidth}
                x={imageSize ? 0 : viewMinX}
                y={imageSize ? 0 : viewMinY}
              />
            ) : null}

            {selectedBlueprint.buttons.map((button, index) => {
              const bounds = buttonLayoutBounds(button, overrides[index]);
              const active = countActiveActions({
                ...draft,
                buttons: [draft.buttons[index] ?? { actions: [], virtualActions: [] }]
              }) > 0;

              return (
                <g
                  className={index === selectedButtonIndex ? "blueprint-hitbox blueprint-hitbox--selected" : "blueprint-hitbox"}
                  key={`${selectedBlueprint.id}-${index}`}
                  onClick={() => onSelectButton(index)}
                  onPointerDown={(event) => {
                    onSelectButton(index);
                    if (!layoutEditingEnabled || !svgRef.current) {
                      return;
                    }
                    event.preventDefault();
                    const point = svgPoint(svgRef.current, event.clientX, event.clientY);
                    if (!point) {
                      return;
                    }
                    try {
                      svgRef.current.setPointerCapture(event.pointerId);
                    } catch {
                      // Ignore unsupported pointer capture environments.
                    }
                    setDragState({
                      buttonIndex: index,
                      pointerId: event.pointerId,
                      startX: point.x,
                      startY: point.y,
                      startOverride: editableSeed(selectedBlueprint, index, overrides[index])
                    });
                  }}
                >
                  {renderBlueprintShape(
                    button,
                    `blueprint-shape ${
                      index === selectedButtonIndex
                        ? "blueprint-shape--selected"
                        : active
                          ? "blueprint-shape--active"
                          : ""
                    }`,
                    overrides[index]
                  )}
                  <text
                    className="blueprint-label"
                    textAnchor="middle"
                    x={bounds.cx}
                    y={bounds.cy}
                  >
                    {index + 1}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>
        {!imageAvailable ? (
          <p className="panel-copy">
            Import a PNG, JPG, WEBP, GIF, or SVG image for this blueprint. Uploads are converted to PNG and scaled to fit within 800×500 px.
          </p>
        ) : null}
      </div>

      <div className="layout-tools">
        <div className="panel-head">
          <div>
            <p className="eyebrow">Layout</p>
            <h3>Grid and alignment</h3>
          </div>
          <div className="inline-actions">
            <span className="pill">Button {selectedButtonIndex + 1}</span>
            <label className="toggle-field">
              <span>Edit mode</span>
              <button
                className={`toggle ${layoutEditingEnabled ? "toggle--on" : ""}`}
                onClick={() => setLayoutEditingEnabled((current) => !current)}
                type="button"
              >
                <span />
              </button>
            </label>
          </div>
        </div>

        <fieldset className={`layout-tools__body ${layoutEditingEnabled ? "" : "layout-tools__body--locked"}`} disabled={!layoutEditingEnabled}>
          <div className="field-grid">
            <label className="toggle-field">
              <span>Grid overlay</span>
              <button
                className={`toggle ${grid.enabled ? "toggle--on" : ""}`}
                onClick={() => onGridChange({ enabled: !grid.enabled })}
                type="button"
              >
                <span />
              </button>
            </label>

            <label className="toggle-field">
              <span>Snap to grid</span>
              <button
                className={`toggle ${grid.snap ? "toggle--on" : ""}`}
                onClick={() => onGridChange({ snap: !grid.snap })}
                type="button"
              >
                <span />
              </button>
            </label>

            <label className="field">
              <span>Grid width</span>
              <input
                min={8}
                onChange={(event) => onGridChange({ cellWidth: Number(event.target.value) || 24 })}
                type="number"
                value={grid.cellWidth}
              />
            </label>

            <label className="field">
              <span>Grid height</span>
              <input
                min={8}
                onChange={(event) => onGridChange({ cellHeight: Number(event.target.value) || 24 })}
                type="number"
                value={grid.cellHeight}
              />
            </label>

            <label className="field">
              <span>Grid offset X</span>
              <input
                onChange={(event) => onGridChange({ offsetX: Number(event.target.value) || 0 })}
                type="number"
                value={grid.offsetX}
              />
            </label>

            <label className="field">
              <span>Grid offset Y</span>
              <input
                onChange={(event) => onGridChange({ offsetY: Number(event.target.value) || 0 })}
                type="number"
                value={grid.offsetY}
              />
            </label>
          </div>

          <div className="field-grid">
            <label className="field">
              <span>Shape</span>
              <select
                onChange={(event) =>
                  applyOverride(selectedButtonIndex, {
                    ...selectedSeed,
                    shape: event.target.value === "circle" ? "circle" : "rect"
                  })
                }
                value={selectedSeed.shape}
              >
                <option value="rect">Rectangle</option>
                <option value="circle">Circle</option>
              </select>
            </label>

            <label className="field">
              <span>X</span>
              <input
                onChange={(event) =>
                  applyOverride(selectedButtonIndex, {
                    ...selectedSeed,
                    x: Number(event.target.value) || 0
                  })
                }
                type="number"
                value={Math.round(selectedSeed.x)}
              />
            </label>

            <label className="field">
              <span>Y</span>
              <input
                onChange={(event) =>
                  applyOverride(selectedButtonIndex, {
                    ...selectedSeed,
                    y: Number(event.target.value) || 0
                  })
                }
                type="number"
                value={Math.round(selectedSeed.y)}
              />
            </label>

            <label className="field">
              <span>Width</span>
              <input
                min={12}
                onChange={(event) =>
                  applyOverride(selectedButtonIndex, {
                    ...selectedSeed,
                    width: Number(event.target.value) || 12
                  })
                }
                type="number"
                value={Math.round(selectedSeed.width)}
              />
            </label>

            <label className="field">
              <span>Height</span>
              <input
                min={12}
                onChange={(event) =>
                  applyOverride(selectedButtonIndex, {
                    ...selectedSeed,
                    height: Number(event.target.value) || 12
                  })
                }
                type="number"
                value={Math.round(selectedSeed.height)}
              />
            </label>
          </div>

          <div className="inline-actions">
            <button
              className="button"
              onClick={() => applyOverride(selectedButtonIndex, snapOverrideToGrid(selectedSeed, grid))}
              type="button"
            >
              Snap selected
            </button>
            <button
              className="button"
              disabled={!imageAvailable}
              onClick={() => void autoDetectSelected()}
              type="button"
            >
              Auto-detect selected
            </button>
            <button
              className="button"
              onClick={() => {
                onButtonLayoutChange(selectedButtonIndex, null);
                onNotify({
                  kind: "success",
                  text: `Reset layout for button ${selectedButtonIndex + 1}.`
                });
              }}
              type="button"
            >
              Reset selected
            </button>
            <button
              className="button"
              onClick={() => {
                selectedBlueprint.buttons.forEach((_, index) => onButtonLayoutChange(index, null));
                onNotify({
                  kind: "success",
                  text: "Reset all button layout overrides."
                });
              }}
              type="button"
            >
              Reset all
            </button>
          </div>
        </fieldset>

        <p className="panel-copy">
          {layoutEditingEnabled
            ? "Edit mode on. Drag buttons in the canvas or adjust bounds with the fields below."
            : "Edit mode off. Enable it to drag or resize buttons."}
        </p>
      </div>
    </section>
  );
}
