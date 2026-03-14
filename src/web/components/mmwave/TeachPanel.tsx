import type { AreaRect, AreaSlot, DeviceAreaLabels, DeviceSnapshot, TargetPoint } from "../../../shared/mmwaveTypes";
import { HelpTip } from "./HelpTip";

interface TeachPanelProps {
  device: DeviceSnapshot;
  recording: boolean;
  hitCounts: Record<AreaSlot, number>;
  eventCount: number;
  areaLabels: DeviceAreaLabels;
  liveCornerPoint: TargetPoint | null;
  liveCornerStatus: "none" | "single" | "multiple";
  cornerSamples: TargetPoint[];
  cornerDraftRect: AreaRect | null;
  onToggle: () => void;
  onReset: () => void;
  onCaptureCorner: () => void;
  onResetCorners: () => void;
  onUseCornerDraft: () => void;
}

function areaDisplayLabel(labels: DeviceAreaLabels, slot: AreaSlot): string {
  return labels.detection[slot].trim() || slot;
}

function strongestArea(hitCounts: Record<AreaSlot, number>, areaLabels: DeviceAreaLabels): string {
  const entries = Object.entries(hitCounts) as [AreaSlot, number][];
  const leader = entries.sort((left, right) => right[1] - left[1])[0];
  if (!leader || leader[1] === 0) {
    return "No teach data yet.";
  }
  return `${areaDisplayLabel(areaLabels, leader[0])} is the hottest detection lane so far with ${leader[1]} motion hits.`;
}

export function TeachPanel({
  device,
  recording,
  hitCounts,
  eventCount,
  areaLabels,
  liveCornerPoint,
  liveCornerStatus,
  cornerSamples,
  cornerDraftRect,
  onToggle,
  onReset,
  onCaptureCorner,
  onResetCorners,
  onUseCornerDraft
}: TeachPanelProps) {
  return (
    <section className="panel teach-panel">
      <div className="panel-heading inline-heading">
        <div>
          <p className="eyebrow">Teach</p>
          <div className="heading-row">
            <h3>Motion rehearsal</h3>
            <HelpTip title="Teach mode">
              Teach mode does not program the switch by itself. It watches live occupancy transitions and
              target telemetry so you can see which detection lanes are firing before you commit new geometry.
            </HelpTip>
          </div>
        </div>
        <div className="inline-actions">
          <button className={`action-button${recording ? " stop" : ""}`} onClick={onToggle} type="button">
            {recording ? "Stop teaching" : "Start teaching"}
          </button>
          <button className="ghost-button" onClick={onReset} type="button">
            Reset
          </button>
        </div>
      </div>
      <p className="panel-copy">
        Use this as a rehearsal space before writing zones. The studio counts rising occupancy edges per
        detection slot, highlights hot lanes, and shows raw target dots automatically when the switch exposes
        them.
      </p>
      <div className="teach-status-row">
        <span className={`status-pill ${recording ? "active" : ""}`}>
          {recording ? "Recording motion transitions" : "Teach mode idle"}
        </span>
        <span className="status-pill">
          {device.supportsTargetDots ? "Live target dots enabled" : "Heat-only fallback"}
        </span>
        <span className="status-pill">{cornerSamples.length} captured corners</span>
      </div>
      <div className="teach-heat-grid">
        {(["area1", "area2", "area3", "area4"] as AreaSlot[]).map((slot) => {
          const max = Math.max(1, ...Object.values(hitCounts));
          const ratio = hitCounts[slot] / max;
          return (
            <div className="teach-heat-card" key={slot}>
              <span>{areaDisplayLabel(areaLabels, slot)}</span>
              <small>{slot}</small>
              <strong>{hitCounts[slot]}</strong>
              <div className="heat-bar">
                <span style={{ width: `${ratio * 100}%` }}></span>
              </div>
            </div>
          );
        })}
      </div>
      <div className="teach-summary">
        <span>{strongestArea(hitCounts, areaLabels)}</span>
        <span>
          {eventCount} motion transitions captured on {device.meta.friendlyName}.
        </span>
      </div>
      <div className="corner-teach-block">
        <div className="panel-heading inline-heading">
        <div>
          <p className="eyebrow">Corner Fit</p>
          <div className="heading-row">
            <h3>Stand in the corners, fit the rectangle</h3>
            <HelpTip title="Corner fit">
              Corner fit is valid for this switch because every programmable area is a rectangular min/max box.
              Capture two or more corner points, review the draft rectangle, then promote it into the selected
              slot if it matches the space you want.
            </HelpTip>
          </div>
        </div>
          <div className="inline-actions">
            <button
              className="action-button"
              disabled={!liveCornerPoint}
              onClick={onCaptureCorner}
              type="button"
            >
              Capture corner
            </button>
            <button className="ghost-button" onClick={onResetCorners} type="button">
              Reset corners
            </button>
          </div>
        </div>
        <p className="panel-copy">
          This works for the VZM32 because each programmable area is a rectangular min/max box. Stand in each
          corner you care about, capture the live target dot, then promote the fitted box into the selected
          slot. Corner fitting only derives width and depth. It keeps the current slot height range unchanged,
          which prevents your body height from accidentally rewriting the vertical envelope.
        </p>
        <div className="teach-summary">
          <span>
            Live point:{" "}
            {liveCornerStatus === "multiple"
              ? "multiple target dots detected; clear extra motion and try again"
              : liveCornerPoint
              ? `x ${liveCornerPoint.x}, y ${liveCornerPoint.y}${
                  typeof liveCornerPoint.z === "number" ? `, z ${liveCornerPoint.z}` : ""
                }`
              : "waiting for live target dots"}
          </span>
          <span>{cornerSamples.length} captured corner sample(s)</span>
        </div>
        {cornerDraftRect ? (
          <div className="corner-fit-preview">
            <span>
              width {cornerDraftRect.width_min}..{cornerDraftRect.width_max}
            </span>
            <span>
              depth {cornerDraftRect.depth_min}..{cornerDraftRect.depth_max}
            </span>
            <span>
              height {cornerDraftRect.height_min}..{cornerDraftRect.height_max}
            </span>
            <button className="action-button" onClick={onUseCornerDraft} type="button">
              Use for selected slot
            </button>
          </div>
        ) : (
          <p className="panel-copy compact-copy">
            Capture at least two corners to generate a draft rectangle.
          </p>
        )}
      </div>
    </section>
  );
}
