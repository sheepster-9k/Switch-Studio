import { useEffect, useState } from "react";

import type { AreaKind, AreaRect, AreaSlot, DeviceSnapshot, TargetPoint } from "../../../shared/mmwaveTypes";
import { clamp } from "../../../shared/mmwaveUtils";

function resolveCornerCapturePoint(points: TargetPoint[]): { point: TargetPoint | null; status: "none" | "single" | "multiple" } {
  if (points.length === 0) {
    return { point: null, status: "none" };
  }
  if (points.length > 1) {
    return { point: null, status: "multiple" };
  }
  return { point: points[0], status: "single" };
}

function rectFromCornerSamples(
  points: TargetPoint[],
  fallbackRect: AreaRect,
  bounds: AreaRect
): AreaRect | null {
  if (points.length < 2) {
    return null;
  }
  let xMin = Infinity, xMax = -Infinity, yMin = Infinity, yMax = -Infinity;
  for (const p of points) {
    if (p.x < xMin) xMin = p.x;
    if (p.x > xMax) xMax = p.x;
    if (p.y < yMin) yMin = p.y;
    if (p.y > yMax) yMax = p.y;
  }
  return {
    width_min: clamp(xMin, bounds.width_min, bounds.width_max),
    width_max: clamp(xMax, bounds.width_min, bounds.width_max),
    depth_min: clamp(yMin, bounds.depth_min, bounds.depth_max),
    depth_max: clamp(yMax, bounds.depth_min, bounds.depth_max),
    height_min: fallbackRect.height_min,
    height_max: fallbackRect.height_max
  };
}

export function useCornerCapture(
  selectedDevice: DeviceSnapshot | null,
  selectedKind: AreaKind,
  selectedSlot: AreaSlot,
  editorRect: AreaRect,
  setError: (msg: string | null) => void
) {
  const [cornerSamples, setCornerSamples] = useState<TargetPoint[]>([]);

  useEffect(() => {
    setCornerSamples([]);
  }, [selectedDevice?.meta.friendlyName, selectedKind, selectedSlot]);

  const cornerCapture = selectedDevice && selectedDevice.supportsTargetDots
    ? resolveCornerCapturePoint(selectedDevice.targetPoints)
    : { point: null, status: "none" as const };

  const liveCornerPoint = cornerCapture.point;

  const cornerDraftRect = selectedDevice
    ? rectFromCornerSamples(cornerSamples, editorRect, selectedDevice.settings.baseBounds)
    : null;

  function captureCornerSample() {
    if (cornerCapture.status === "multiple") {
      setError("Multiple target dots are active. Leave only one person in the sensing area before capturing a corner.");
      return;
    }
    if (!liveCornerPoint) {
      setError("No live target dot is available. Enable target dots and stand still until a dot appears.");
      return;
    }
    setError(null);
    setCornerSamples((current) => [...current, liveCornerPoint]);
  }

  return {
    cornerSamples,
    cornerDraftRect,
    liveCornerPoint,
    liveCornerStatus: cornerCapture.status,
    captureCornerSample,
    resetCorners: () => setCornerSamples([])
  };
}
