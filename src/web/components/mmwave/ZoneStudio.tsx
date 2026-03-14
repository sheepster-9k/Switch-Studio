import { useEffect, useRef } from "react";

import type {
  AreaCollection,
  AreaKind,
  AreaRect,
  AreaSlot,
  DeviceAreaLabels,
  DeviceSnapshot,
  TargetPoint,
  TargetTrail
} from "../../../shared/mmwaveTypes";
import { areaDisplayLabel, areaIsZero, clamp, rangeSpan } from "../../../shared/mmwaveUtils";
import { HelpTip } from "./HelpTip";

const PLANE = { width: 780, height: 520, padding: 48 };

interface ZoneStudioProps {
  device: DeviceSnapshot;
  selectedKind: AreaKind;
  selectedSlot: AreaSlot;
  editorRect: AreaRect;
  areaLabels: DeviceAreaLabels;
  heatCounts: Record<AreaSlot, number>;
  cornerTeachPoints: TargetPoint[];
  cornerTeachRect: AreaRect | null;
  onRectChange: (rect: AreaRect) => void;
}

interface InteractionState {
  mode: "draw" | "move" | "resize";
  corner: "nw" | "ne" | "sw" | "se";
  anchor: { x: number; y: number };
  pointer: { x: number; y: number };
  rect: AreaRect;
}

function normalizeRect(area: AreaRect, bounds: AreaRect): AreaRect {
  return {
    width_min: clamp(Math.min(area.width_min, area.width_max), bounds.width_min, bounds.width_max),
    width_max: clamp(Math.max(area.width_min, area.width_max), bounds.width_min, bounds.width_max),
    depth_min: clamp(Math.min(area.depth_min, area.depth_max), bounds.depth_min, bounds.depth_max),
    depth_max: clamp(Math.max(area.depth_min, area.depth_max), bounds.depth_min, bounds.depth_max),
    height_min: clamp(Math.min(area.height_min, area.height_max), bounds.height_min, bounds.height_max),
    height_max: clamp(Math.max(area.height_min, area.height_max), bounds.height_min, bounds.height_max)
  };
}

function planeX(value: number, bounds: AreaRect) {
  const usable = PLANE.width - PLANE.padding * 2;
  return PLANE.padding + ((value - bounds.width_min) / (bounds.width_max - bounds.width_min || 1)) * usable;
}

function planeY(value: number, bounds: AreaRect) {
  const usable = PLANE.height - PLANE.padding * 2;
  return PLANE.height - PLANE.padding - ((value - bounds.depth_min) / (bounds.depth_max - bounds.depth_min || 1)) * usable;
}

function fromPlane(x: number, y: number, bounds: AreaRect) {
  const usableWidth = PLANE.width - PLANE.padding * 2;
  const usableHeight = PLANE.height - PLANE.padding * 2;
  const width = bounds.width_min + ((x - PLANE.padding) / usableWidth) * (bounds.width_max - bounds.width_min);
  const depth =
    bounds.depth_min +
    ((PLANE.height - PLANE.padding - y) / usableHeight) * (bounds.depth_max - bounds.depth_min);
  return {
    x: clamp(width, bounds.width_min, bounds.width_max),
    y: clamp(depth, bounds.depth_min, bounds.depth_max)
  };
}

function clientToSvgPoint(clientX: number, clientY: number, box: DOMRect) {
  return {
    x: ((clientX - box.left) / (box.width || 1)) * PLANE.width,
    y: ((clientY - box.top) / (box.height || 1)) * PLANE.height
  };
}

function rectToSvg(area: AreaRect, bounds: AreaRect) {
  const x = planeX(area.width_min, bounds);
  const y = planeY(area.depth_max, bounds);
  const width = planeX(area.width_max, bounds) - x;
  const height = planeY(area.depth_min, bounds) - y;
  return { x, y, width, height };
}

function handlePositions(area: AreaRect, bounds: AreaRect) {
  const rect = rectToSvg(area, bounds);
  return {
    nw: { x: rect.x, y: rect.y },
    ne: { x: rect.x + rect.width, y: rect.y },
    sw: { x: rect.x, y: rect.y + rect.height },
    se: { x: rect.x + rect.width, y: rect.y + rect.height }
  };
}

function colorForLayer(kind: AreaKind) {
  if (kind === "detection") {
    return "var(--accent-teal)";
  }
  if (kind === "interference") {
    return "var(--accent-amber)";
  }
  return "var(--accent-rose)";
}

function areaCanvasLabel(labels: DeviceAreaLabels, kind: AreaKind, slot: AreaSlot): string {
  const label = areaDisplayLabel(labels, kind, slot);
  return label.length > 16 ? `${label.slice(0, 15)}...` : label;
}

function renderAreaCollection(
  kind: AreaKind,
  collection: AreaCollection,
  areaLabels: DeviceAreaLabels,
  selectedSlot: AreaSlot | null,
  bounds: AreaRect,
  occupancy: Record<AreaSlot, boolean | null>,
  heatCounts: Record<AreaSlot, number>
) {
  const highestHeat = Math.max(1, ...Object.values(heatCounts));
  return (Object.entries(collection) as [AreaSlot, AreaRect][]).map(([slot, area]) => {
    if (areaIsZero(area)) {
      return null;
    }
    const rect = rectToSvg(area, bounds);
    const active = kind === "detection" && occupancy[slot];
    const heatRatio = heatCounts[slot] / highestHeat;
    return (
      <g className={`zone-group ${selectedSlot === slot ? "selected" : ""} ${active ? "active" : ""}`} key={`${kind}-${slot}`}>
        <rect
          className={`zone zone-${kind}`}
          x={rect.x}
          y={rect.y}
          width={rect.width}
          height={rect.height}
          rx={18}
          style={{
            fill: colorForLayer(kind),
            opacity: selectedSlot === slot ? 0.28 : 0.14
          }}
        />
        {heatRatio > 0 && kind === "detection" ? (
          <rect
            className="zone-heat"
            x={rect.x}
            y={rect.y}
            width={rect.width}
            height={rect.height}
            rx={18}
            style={{ opacity: Math.min(0.5, heatRatio * 0.45) }}
          />
        ) : null}
        <text className="zone-label" x={rect.x + 16} y={rect.y + 24}>
          {areaCanvasLabel(areaLabels, kind, slot)}
        </text>
        <title>{areaDisplayLabel(areaLabels, kind, slot)}</title>
      </g>
    );
  });
}

function renderTargetDots(targetPoints: TargetPoint[], bounds: AreaRect) {
  return targetPoints.map((point, index) => {
    const x = planeX(point.x, bounds);
    const y = planeY(point.y, bounds);
    const label = point.label?.trim() || (typeof point.id === "number" ? `T${point.id}` : `T${index + 1}`);
    return (
      <g className="target-node" key={`${point.id ?? index}-${point.x}-${point.y}`}>
        <circle className="target-dot-halo" cx={x} cy={y} r={16} />
        <circle className="target-dot" cx={x} cy={y} r={9} />
        <text className="target-label" x={x + 14} y={y - 12}>
          {label}
        </text>
      </g>
    );
  });
}

function renderTargetTrails(targetTrails: TargetTrail[], bounds: AreaRect) {
  return targetTrails.map((trail) => {
    const line = trail.points.map((point) => `${planeX(point.x, bounds)},${planeY(point.y, bounds)}`).join(" ");
    const lastPoint = trail.points[trail.points.length - 1];
    if (!lastPoint || trail.points.length < 2) {
      return null;
    }
    return (
      <g className="target-trail-group" key={trail.key}>
        <polyline className="target-trail" points={line} />
        <circle className="target-trail-anchor" cx={planeX(lastPoint.x, bounds)} cy={planeY(lastPoint.y, bounds)} r={4} />
      </g>
    );
  });
}

function renderCornerTeachPoints(points: TargetPoint[], bounds: AreaRect) {
  return points.map((point, index) => (
    <circle
      className="corner-capture-point"
      key={`corner-${point.x}-${point.y}-${index}`}
      cx={planeX(point.x, bounds)}
      cy={planeY(point.y, bounds)}
      r={7}
    />
  ));
}

export function ZoneStudio({
  device,
  selectedKind,
  selectedSlot,
  editorRect,
  areaLabels,
  heatCounts,
  cornerTeachPoints,
  cornerTeachRect,
  onRectChange
}: ZoneStudioProps) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const interaction = useRef<InteractionState | null>(null);
  const boundsRef = useRef(device.settings.baseBounds);
  const editorRectRef = useRef(editorRect);
  const onRectChangeRef = useRef(onRectChange);
  const bounds = device.settings.baseBounds;

  useEffect(() => {
    boundsRef.current = bounds;
    editorRectRef.current = editorRect;
    onRectChangeRef.current = onRectChange;
  }, [bounds, editorRect, onRectChange]);

  useEffect(() => {
    function onPointerMove(event: PointerEvent) {
      if (!interaction.current || !svgRef.current) {
        return;
      }
      event.preventDefault();
      const liveBounds = boundsRef.current;
      const liveEditorRect = editorRectRef.current;
      const emitRect = onRectChangeRef.current;
      const box = svgRef.current.getBoundingClientRect();
      const svgPoint = clientToSvgPoint(event.clientX, event.clientY, box);
      const point = fromPlane(svgPoint.x, svgPoint.y, liveBounds);
      const current = interaction.current;

      if (current.mode === "draw") {
        emitRect(
          normalizeRect(
            {
              ...liveEditorRect,
              width_min: current.anchor.x,
              width_max: point.x,
              depth_min: current.anchor.y,
              depth_max: point.y
            },
            liveBounds
          )
        );
        return;
      }

      if (current.mode === "move") {
        const deltaX = point.x - current.pointer.x;
        const deltaY = point.y - current.pointer.y;
        const width = current.rect.width_max - current.rect.width_min;
        const depth = current.rect.depth_max - current.rect.depth_min;
        const widthMin = clamp(current.rect.width_min + deltaX, liveBounds.width_min, liveBounds.width_max - width);
        const depthMin = clamp(current.rect.depth_min + deltaY, liveBounds.depth_min, liveBounds.depth_max - depth);
        emitRect({
          ...current.rect,
          width_min: widthMin,
          width_max: widthMin + width,
          depth_min: depthMin,
          depth_max: depthMin + depth
        });
        return;
      }

      const next = { ...current.rect };
      if (current.corner === "nw" || current.corner === "sw") {
        next.width_min = point.x;
      }
      if (current.corner === "ne" || current.corner === "se") {
        next.width_max = point.x;
      }
      if (current.corner === "nw" || current.corner === "ne") {
        next.depth_max = point.y;
      }
      if (current.corner === "sw" || current.corner === "se") {
        next.depth_min = point.y;
      }
      emitRect(normalizeRect(next, liveBounds));
    }

    function onPointerUp() {
      interaction.current = null;
    }

    function onPointerCancel() {
      interaction.current = null;
    }

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerCancel);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerCancel);
    };
  }, []);

  const handles = areaIsZero(editorRect) ? null : handlePositions(editorRect, bounds);
  const activeRect = areaIsZero(editorRect) ? null : rectToSvg(editorRect, bounds);
  const selectedSlotLabel = areaDisplayLabel(areaLabels, selectedKind, selectedSlot);
  const widthSpan = rangeSpan(editorRect.width_min, editorRect.width_max);
  const depthSpan = rangeSpan(editorRect.depth_min, editorRect.depth_max);
  const heightSpan = rangeSpan(editorRect.height_min, editorRect.height_max);

  return (
    <section className="panel zone-panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Geometry</p>
          <div className="heading-row">
            <h2>{device.meta.friendlyName}</h2>
            <HelpTip title="Geometry canvas">
              Width runs left to right from the switch perspective. Depth starts at the wall and increases into
              the room. Drag to draw a new rectangle, drag inside a rectangle to move it, or grab a corner
              handle to resize it.
            </HelpTip>
          </div>
        </div>
        <div className="legend">
          <span className="legend-chip detection" title="Detection lanes mark areas that should activate motion.">
            Detection
          </span>
          <span className="legend-chip interference" title="Exclusion areas are ignored, even if motion is present.">
            Exclusion
          </span>
          <span className="legend-chip stay" title="Stay areas keep occupancy latched longer for seated or stationary use.">
            Stay
          </span>
        </div>
      </div>
      <div className="zone-meta-strip">
        <span className="zone-meta-chip">{selectedKind}</span>
        <span className="zone-meta-chip">{selectedSlotLabel}</span>
        <span className="zone-meta-chip">Width {widthSpan}</span>
        <span className="zone-meta-chip">Depth {depthSpan}</span>
        <span className="zone-meta-chip">Height {heightSpan}</span>
      </div>
      <p className="panel-copy">
        Drag inside the canvas to draw or adjust the selected slot. Width runs left to right from the switch
        perspective. Depth increases away from the wall. Detection lanes highlight active occupancy, exclusion
        areas carve out spillover, and stay areas preserve presence in fixed-use spaces.
      </p>
      <div className="zone-stage">
        <svg
          className="zone-canvas"
          ref={svgRef}
          aria-label={`${device.meta.friendlyName} geometry editor`}
          role="img"
          viewBox={`0 0 ${PLANE.width} ${PLANE.height}`}
          onPointerDown={(event) => {
            if (!svgRef.current) {
              return;
            }
            event.preventDefault();
            const box = svgRef.current.getBoundingClientRect();
            const svgPoint = clientToSvgPoint(event.clientX, event.clientY, box);
            const point = fromPlane(svgPoint.x, svgPoint.y, bounds);

            if (handles) {
              for (const [corner, position] of Object.entries(handles) as [
                InteractionState["corner"],
                { x: number; y: number }
              ][]) {
                if (
                  Math.abs(position.x - svgPoint.x) < 22 &&
                  Math.abs(position.y - svgPoint.y) < 22
                ) {
                  interaction.current = {
                    mode: "resize",
                    corner,
                    anchor: point,
                    pointer: point,
                    rect: editorRect
                  };
                  return;
                }
              }
            }

            if (activeRect) {
              const inside =
                svgPoint.x >= activeRect.x &&
                svgPoint.x <= activeRect.x + activeRect.width &&
                svgPoint.y >= activeRect.y &&
                svgPoint.y <= activeRect.y + activeRect.height;
              if (inside) {
                interaction.current = {
                  mode: "move",
                  corner: "se",
                  anchor: point,
                  pointer: point,
                  rect: editorRect
                };
                return;
              }
            }

            interaction.current = {
              mode: "draw",
              corner: "se",
              anchor: point,
              pointer: point,
              rect: editorRect
            };
            onRectChange(
              normalizeRect(
                {
                  ...editorRect,
                  width_min: point.x,
                  width_max: point.x,
                  depth_min: point.y,
                  depth_max: point.y
                },
                bounds
              )
            );
          }}
        >
          <defs>
            <pattern id="plane-grid" width="60" height="60" patternUnits="userSpaceOnUse">
              <path d="M 60 0 L 0 0 0 60" className="grid-line" />
            </pattern>
          </defs>
          <rect x="0" y="0" width={PLANE.width} height={PLANE.height} className="canvas-bg" rx="28" />
          <rect
            x={PLANE.padding}
            y={PLANE.padding}
            width={PLANE.width - PLANE.padding * 2}
            height={PLANE.height - PLANE.padding * 2}
            fill="url(#plane-grid)"
            className="canvas-grid"
            rx="24"
          />
          <line
            x1={planeX(0, bounds)}
            x2={planeX(0, bounds)}
            y1={PLANE.padding}
            y2={PLANE.height - PLANE.padding}
            className="axis-line"
          />
          {renderAreaCollection(
            "detection",
            device.areas.detection,
            areaLabels,
            selectedKind === "detection" ? selectedSlot : null,
            bounds,
            device.settings.areaOccupancy,
            heatCounts
          )}
          {renderAreaCollection(
            "interference",
            device.areas.interference,
            areaLabels,
            selectedKind === "interference" ? selectedSlot : null,
            bounds,
            device.settings.areaOccupancy,
            heatCounts
          )}
          {renderAreaCollection(
            "stay",
            device.areas.stay,
            areaLabels,
            selectedKind === "stay" ? selectedSlot : null,
            bounds,
            device.settings.areaOccupancy,
            heatCounts
          )}
          {cornerTeachRect ? (() => {
            const draft = rectToSvg(cornerTeachRect, bounds);
            return (
              <rect
                x={draft.x}
                y={draft.y}
                width={draft.width}
                height={draft.height}
                className="corner-draft-rect"
                rx="18"
              />
            );
          })() : null}
          {cornerTeachPoints.length > 0 ? renderCornerTeachPoints(cornerTeachPoints, bounds) : null}
          {device.targetTrails.length > 0 ? renderTargetTrails(device.targetTrails, bounds) : null}
          {device.supportsTargetDots ? renderTargetDots(device.targetPoints, bounds) : null}
          {!areaIsZero(editorRect) ? (
            <g className="editor-zone">
              <rect
                x={activeRect?.x}
                y={activeRect?.y}
                width={activeRect?.width}
                height={activeRect?.height}
                className="editor-rect"
                rx="18"
              />
              {handles
                ? (Object.values(handles) as Array<{ x: number; y: number }>).map((handle, index) => (
                    <circle className="editor-handle" cx={handle.x} cy={handle.y} r="7" key={index} />
                  ))
                : null}
            </g>
          ) : null}
          <polygon
            className="sensor-origin"
            points={`${planeX(-50, bounds)},${PLANE.height - 24} ${planeX(0, bounds)},${PLANE.height - 58} ${planeX(50, bounds)},${PLANE.height - 24}`}
          />
        </svg>
      </div>
      <div className="zone-footer">
        <span>Selected layer: {selectedKind}</span>
        <span>Selected slot: {selectedSlotLabel}</span>
        <span>Target tracking: {device.targetTrackingState}</span>
        <span>Targets visible: {device.targetPoints.length}</span>
        {cornerTeachPoints.length > 0 ? <span>Corner samples: {cornerTeachPoints.length}</span> : null}
      </div>
    </section>
  );
}
