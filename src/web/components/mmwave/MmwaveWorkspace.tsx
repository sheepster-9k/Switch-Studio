import { startTransition, useEffect, useState } from "react";

import {
  applyMmwaveProfile,
  connectMmwaveStream,
  mmwaveClearInterference,
  mmwaveClearStay,
  mmwaveFindMe,
  mmwaveQueryAreas,
  mmwaveResetDetection,
  mmwaveUpdateArea,
  mmwaveUpdateAreaLabel,
  mmwaveUpdateSettings
} from "../../mmwaveApi";
import type {
  AreaKind,
  AreaRect,
  AreaSlot,
  DeviceAreaLabels,
  DeviceSnapshot,
  StudioSnapshot,
  TargetTrackingState,
  UpdateSettingsRequest,
  UpsertProfileRequest,
  WsServerMessage
} from "../../../shared/mmwaveTypes";
import { ZERO_AREA, AREA_SLOTS, clamp, cloneArea, cloneAreaCollection, rangeSpan, areaDisplayLabel } from "../../../shared/mmwaveUtils";
import { DeviceRail } from "./DeviceRail";
import { HelpTip } from "./HelpTip";
import { TeachPanel } from "./TeachPanel";
import { ZoneStudio } from "./ZoneStudio";
import { useCornerCapture } from "./useCornerCapture";
import { applyDeviceUpdate, useDeviceAction } from "./useDeviceAction";
import { useMmwaveProfiles } from "./useMmwaveProfiles";
import { useTeachRecording } from "./useTeachRecording";

const DEFAULT_LEVEL_LOCAL_PREVIOUS = 255;

function formatTimestamp(timestamp: string): string {
  try {
    return new Date(timestamp).toLocaleString();
  } catch {
    return timestamp;
  }
}

function nextFiniteInputValue(raw: string, numericValue: number, fallback: number): number {
  if (raw === "" || !Number.isFinite(numericValue)) {
    return fallback;
  }
  return numericValue;
}

function isPreviousLocalTurnOnLevel(value: number | null | undefined): boolean {
  return !Number.isFinite(value) || Number(value) >= DEFAULT_LEVEL_LOCAL_PREVIOUS;
}

function percentFromDefaultLevelLocal(value: number | null | undefined): number {
  if (isPreviousLocalTurnOnLevel(value)) {
    return 100;
  }
  return clamp(Math.round((Number(value) / 254) * 100), 1, 100);
}

function defaultLevelLocalFromPercent(percent: number): number {
  return clamp(Math.round((clamp(percent, 1, 100) / 100) * 254), 1, 254);
}

function trackingStateLabel(state: TargetTrackingState): string {
  if (state === "live") {
    return "Live target tracking";
  }
  if (state === "armed") {
    return "Tracking armed";
  }
  if (state === "waiting") {
    return "Waiting for first frame";
  }
  return "Occupancy fallback";
}

function trackingStateDescription(state: TargetTrackingState): string {
  if (state === "live") {
    return "Target frames are flowing into the viewer right now.";
  }
  if (state === "armed") {
    return "Target reporting is enabled. Step into view and the next live frame will appear here.";
  }
  if (state === "waiting") {
    return "Target reporting is enabled, but the studio has not seen a target frame from this switch yet.";
  }
  return "Target reporting is disabled on this switch, so the viewer is using occupancy lanes instead.";
}

const AREA_KIND_HELP: Record<AreaKind, string> = {
  interference:
    "Exclusion areas mask spillover, doorway bleed, vents, fans, or other regions you want the sensor to ignore.",
  detection:
    "Detection areas are the live motion lanes that can contribute to occupancy and teach-mode heat.",
  stay: "Stay areas help keep occupancy latched in places where someone may be present but mostly still."
};

const AREA_FIELD_META: Array<{
  key: keyof AreaRect;
  label: string;
  helpTitle: string;
  helpBody: string;
}> = [
  {
    key: "width_min",
    label: "width min",
    helpTitle: "Width minimum",
    helpBody:
      "The left edge of the rectangle from the switch perspective. Negative values move left of the switch origin."
  },
  {
    key: "width_max",
    label: "width max",
    helpTitle: "Width maximum",
    helpBody:
      "The right edge of the rectangle from the switch perspective. Positive values extend farther right."
  },
  {
    key: "depth_min",
    label: "depth min",
    helpTitle: "Depth minimum",
    helpBody: "The near edge of the rectangle. Depth starts at the wall and increases outward into the room."
  },
  {
    key: "depth_max",
    label: "depth max",
    helpTitle: "Depth maximum",
    helpBody: "The far edge of the rectangle, farther away from the wall and deeper into the room."
  },
  {
    key: "height_min",
    label: "height min",
    helpTitle: "Height minimum",
    helpBody:
      "The lower vertical bound of the zone. Negative values are below switch height, useful for ignoring floor-level movement."
  },
  {
    key: "height_max",
    label: "height max",
    helpTitle: "Height maximum",
    helpBody:
      "The upper vertical bound of the zone. Positive values extend above switch height to include people standing in the space."
  }
];

const BASE_BOUND_FIELD_META: Array<{
  key: keyof AreaRect;
  label: string;
  helpTitle: string;
  helpBody: string;
}> = [
  {
    key: "width_min",
    label: "Base width min",
    helpTitle: "Base width minimum",
    helpBody: "The farthest left value allowed anywhere on the geometry canvas for this switch."
  },
  {
    key: "width_max",
    label: "Base width max",
    helpTitle: "Base width maximum",
    helpBody: "The farthest right value allowed anywhere on the geometry canvas for this switch."
  },
  {
    key: "depth_min",
    label: "Base depth min",
    helpTitle: "Base depth minimum",
    helpBody: "The nearest depth the sensor should consider. This usually stays close to the wall line."
  },
  {
    key: "depth_max",
    label: "Base depth max",
    helpTitle: "Base depth maximum",
    helpBody: "The farthest reach of the editable sensing plane for this switch."
  },
  {
    key: "height_min",
    label: "Base height min",
    helpTitle: "Base height minimum",
    helpBody: "The lowest vertical bound available to all detection, exclusion, and stay rectangles."
  },
  {
    key: "height_max",
    label: "Base height max",
    helpTitle: "Base height maximum",
    helpBody: "The highest vertical bound available to all detection, exclusion, and stay rectangles."
  }
];

function profilePayloadFromDevice(
  device: DeviceSnapshot,
  name: string,
  notes: string
): UpsertProfileRequest {
  return {
    name: name.trim() || `${device.meta.friendlyName} tune`,
    notes,
    model: device.meta.model,
    sourceDevice: device.meta.friendlyName,
    settings: {
      roomPreset: device.settings.roomPreset,
      detectSensitivity: device.settings.detectSensitivity,
      detectTrigger: device.settings.detectTrigger,
      holdTime: device.settings.holdTime,
      stayLife: device.settings.stayLife,
      targetInfoReport: device.settings.targetInfoReport,
      controlWiredDevice: device.settings.controlWiredDevice,
      defaultLevelLocal: device.settings.defaultLevelLocal,
      baseBounds: { ...device.settings.baseBounds }
    },
    areas: {
      detection: cloneAreaCollection(device.areas.detection),
      interference: cloneAreaCollection(device.areas.interference),
      stay: cloneAreaCollection(device.areas.stay)
    }
  };
}

function settingsDraftFromDevice(device: DeviceSnapshot): UpdateSettingsRequest {
  return {
    roomPreset: device.settings.roomPreset,
    detectSensitivity: device.settings.detectSensitivity,
    detectTrigger: device.settings.detectTrigger,
    holdTime: device.settings.holdTime,
    stayLife: device.settings.stayLife,
    targetInfoReport: device.settings.targetInfoReport,
    controlWiredDevice: device.settings.controlWiredDevice,
    defaultLevelLocal: device.settings.defaultLevelLocal,
    baseBounds: { ...device.settings.baseBounds }
  };
}

function MmwaveWorkspace() {
  const [bridge, setBridge] = useState<StudioSnapshot["bridge"] | null>(null);
  const [devices, setDevices] = useState<DeviceSnapshot[]>([]);
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const [selectedKind, setSelectedKind] = useState<AreaKind>("interference");
  const [selectedSlot, setSelectedSlot] = useState<AreaSlot>("area1");
  const [editorRect, setEditorRect] = useState<AreaRect>(cloneArea(ZERO_AREA));
  const [settingsDraft, setSettingsDraft] = useState<UpdateSettingsRequest | null>(null);
  const [editorDirty, setEditorDirty] = useState(false);
  const [settingsDirty, setSettingsDirty] = useState(false);
  const [labelDirty, setLabelDirty] = useState(false);
  const [labelDraft, setLabelDraft] = useState("");

  const device = devices.find((d) => d.meta.friendlyName === selectedName) ?? null;

  const { busyAction, error, setError, setBusyAction, runAction } = useDeviceAction(setDevices);
  const { recording, hitCounts, eventCount, toggleRecording, resetTeach } = useTeachRecording(device);
  const {
    profiles, selectedProfile, selectedProfileId, profileName, profileNotes, importInputRef,
    setSelectedProfileId, setProfileName, setProfileNotes,
    saveProfile: saveProfileHook, removeProfile, startNewProfileDraft, exportProfile, importProfileFile
  } = useMmwaveProfiles(device?.meta.friendlyName ?? null, setBusyAction, setError);

  const corner = useCornerCapture(device, selectedKind, selectedSlot, editorRect, setError);
  const { cornerSamples, cornerDraftRect, liveCornerPoint, liveCornerStatus, captureCornerSample, resetCorners } = corner;

  const selectedAreaLabel = device ? device.areaLabels[selectedKind][selectedSlot] : "";
  const selectedSlotLabel = device
    ? areaDisplayLabel(device.areaLabels, selectedKind, selectedSlot)
    : selectedSlot;
  const liveTargetCount = device ? device.targetPoints.length : 0;
  const liveTrackCount = device ? device.targetTrails.length : 0;
  const trackingStatus = device ? trackingStateLabel(device.targetTrackingState) : "Occupancy fallback";
  const trackingStatusDescription = device
    ? trackingStateDescription(device.targetTrackingState)
    : "Target reporting is unavailable until a switch is selected.";
  const slotWidthSpan = rangeSpan(editorRect.width_min, editorRect.width_max);
  const slotDepthSpan = rangeSpan(editorRect.depth_min, editorRect.depth_max);
  const slotHeightSpan = rangeSpan(editorRect.height_min, editorRect.height_max);

  useEffect(() => {
    return connectMmwaveStream((message: WsServerMessage) => {
      if (message.type === "snapshot") {
        startTransition(() => {
          setBridge(message.snapshot.bridge);
          setDevices(message.snapshot.devices);
          setSelectedName((current) => current ?? message.snapshot.devices[0]?.meta.friendlyName ?? null);
        });
        return;
      }
      if (message.type === "bridge_update") {
        setBridge(message.bridge);
        return;
      }
      if (message.type === "device_update") {
        startTransition(() => {
          setDevices((current) => applyDeviceUpdate(current, message.device));
        });
      }
    }, (connectionError) => {
      setError(connectionError);
    });
  }, []);

  useEffect(() => {
    if (!device) {
      return;
    }
    setEditorRect(cloneArea(device.areas[selectedKind][selectedSlot]));
    setEditorDirty(false);
    setSettingsDraft(settingsDraftFromDevice(device));
    setSettingsDirty(false);
    setLabelDraft(selectedAreaLabel);
    setLabelDirty(false);
  }, [device?.meta.friendlyName, selectedKind, selectedSlot]);

  useEffect(() => {
    if (!device) {
      return;
    }
    if (!editorDirty) {
      setEditorRect(cloneArea(device.areas[selectedKind][selectedSlot]));
    }
    if (!settingsDirty) {
      setSettingsDraft(settingsDraftFromDevice(device));
    }
    if (!labelDirty) {
      setLabelDraft(selectedAreaLabel);
    }
  }, [
    editorDirty,
    labelDirty,
    selectedAreaLabel,
    device?.updatedAt,
    selectedKind,
    selectedSlot,
    settingsDirty
  ]);

  async function saveProfile(asUpdate: boolean) {
    if (!device) {
      return;
    }
    const payload = profilePayloadFromDevice(device, profileName, profileNotes);
    await saveProfileHook(asUpdate, payload);
  }

  function useCornerDraftForSlot() {
    if (!cornerDraftRect) {
      return;
    }
    setEditorRect(cloneArea(cornerDraftRect));
    setEditorDirty(true);
    setError(null);
  }

  if (!bridge && devices.length === 0) {
    return (
      <div className="mmwave-workspace">
        <section className="panel loading-state">
          {error ? (
            <>
              <p className="error-banner">{error}</p>
              <p className="panel-copy">The mmWave workspace requires a working MQTT connection to Zigbee2MQTT.</p>
            </>
          ) : (
            "Loading mmWave Studio..."
          )}
        </section>
      </div>
    );
  }

  if (bridge && devices.length === 0) {
    return (
      <div className="mmwave-workspace">
        <section className="panel empty-panel">
          <p className="eyebrow">No devices</p>
          <h2>No Inovelli VZM32-SN switches found on {bridge.baseTopic}.</h2>
          <p className="panel-copy">
            Check Zigbee2MQTT bridge devices, confirm the switch model is VZM32-SN, and make sure the
            broker path matches the active MQTT stack.
          </p>
          {bridge.lastError ? <p className="error-banner">Broker error: {bridge.lastError}</p> : null}
          {error ? <p className="error-banner">{error}</p> : null}
        </section>
      </div>
    );
  }

  if (!device || !settingsDraft || !bridge) {
    return (
      <div className="mmwave-workspace">
        <section className="panel loading-state">Loading mmWave Studio...</section>
      </div>
    );
  }

  const motionOnUsesPreviousLevel = isPreviousLocalTurnOnLevel(
    settingsDraft.defaultLevelLocal ?? device.settings.defaultLevelLocal
  );
  const motionOnLevelPercent = percentFromDefaultLevelLocal(
    settingsDraft.defaultLevelLocal ?? device.settings.defaultLevelLocal
  );

  return (
    <div className="mmwave-workspace">
      <header className="mmwave-header panel">
        <div>
          <p className="eyebrow">mmWave Studio</p>
          <h2>{device.meta.friendlyName}</h2>
          <p className="panel-copy">
            Tune detection, exclusion, and stay geometry with live MQTT state for your Inovelli mmWave switches.
          </p>
        </div>
        <div className="status-cluster">
          <span className={`bridge-pill ${bridge.connected ? "online" : "offline"}`}>
            {bridge.connected ? "MQTT online" : "MQTT offline"}
          </span>
          <span className="ghost-pill">{bridge.baseTopic}</span>
          {bridge.z2mBridgeState ? <span className="ghost-pill">Z2M {bridge.z2mBridgeState}</span> : null}
        </div>
      </header>

      <div className="workspace">
        <aside className="side-column left-column">
          <DeviceRail devices={devices} selectedName={selectedName} onSelect={setSelectedName} />

          <section className="panel">
            <div className="panel-heading inline-heading">
              <div>
                <p className="eyebrow">Locate</p>
                <div className="heading-row">
                  <h3>Physical identification</h3>
                  <HelpTip title="Find the real switch">
                    Use this before making geometry changes in a room with multiple dimmers.
                  </HelpTip>
                </div>
              </div>
              <button
                className="action-button"
                disabled={Boolean(busyAction)}
                onClick={() => runAction("identify", () => mmwaveFindMe(device.meta.friendlyName))}
                type="button"
              >
                {busyAction === "identify" ? "Locating..." : "Find this switch"}
              </button>
            </div>
            <p className="panel-copy">
              Triggers the switch's identify effect so you can confirm the physical location.
            </p>
          </section>

          <section className="panel diagnostics-panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Live</p>
                <div className="heading-row">
                  <h3>Runtime state</h3>
                  <HelpTip title="Runtime state">
                    Live state from Zigbee2MQTT and the bridge cache. Confirm whether a switch is online and
                    publishing the firmware data you expect.
                  </HelpTip>
                </div>
              </div>
            </div>
            <div className="runtime-grid">
              <div>
                <span>Availability</span>
                <strong>{device.availability}</strong>
              </div>
              <div>
                <span>Occupancy</span>
                <strong>{device.settings.occupancy ? "occupied" : "clear"}</strong>
              </div>
              <div>
                <span>Illuminance</span>
                <strong>{device.settings.illuminance ?? "n/a"}</strong>
              </div>
              <div>
                <span>Firmware</span>
                <strong>{device.settings.mmwaveVersion ?? "n/a"}</strong>
              </div>
              <div>
                <span>Tracking</span>
                <strong>{trackingStatus}</strong>
              </div>
              <div>
                <span>Targets visible</span>
                <strong>{liveTargetCount}</strong>
              </div>
              <div>
                <span>Tracked lanes</span>
                <strong>{liveTrackCount}</strong>
              </div>
              <div>
                <span>Last target frame</span>
                <strong>{device.targetTelemetryAt ? formatTimestamp(device.targetTelemetryAt) : "none yet"}</strong>
              </div>
            </div>
            <p className="runtime-tracking-copy">{trackingStatusDescription}</p>
            <div className="mini-occupancy-row">
              {AREA_SLOTS.map((slot) => (
                <span
                  key={slot}
                  className={device.settings.areaOccupancy[slot] ? "lit" : ""}
                  title={`${slot}${device.areaLabels.detection[slot] ? ` - ${device.areaLabels.detection[slot]}` : ""}`}
                >
                  {areaDisplayLabel(device.areaLabels, "detection", slot)}
                </span>
              ))}
            </div>
            <ul className="note-list">
              {device.notes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
            {device.targetTrackingState === "disabled" ? (
              <div className="live-tracking-callout">
                <p>Enable target reporting on this switch for live tracked targets.</p>
                <button
                  className="action-button"
                  disabled={Boolean(busyAction)}
                  onClick={() =>
                    runAction("enable-target-reporting", () =>
                      mmwaveUpdateSettings(device.meta.friendlyName, { targetInfoReport: "Enable" })
                    )
                  }
                  type="button"
                >
                  {busyAction === "enable-target-reporting" ? "Enabling..." : "Enable live tracking"}
                </button>
              </div>
            ) : null}
            {bridge.lastError ? <p className="error-banner">Broker error: {bridge.lastError}</p> : null}
            {error ? <p className="error-banner">{error}</p> : null}
          </section>
        </aside>

        <section className="canvas-column">
          <div className="toolbar panel">
            <div className="toolbar-group">
              <div className="eyebrow-row">
                <span className="eyebrow">Layer</span>
                <HelpTip title="Layer types">
                  Detection lanes react to people. Exclusion lanes mask spillover. Stay lanes preserve occupancy.
                </HelpTip>
              </div>
              <div className="segmented">
                {(["interference", "detection", "stay"] as AreaKind[]).map((kind) => (
                  <button
                    key={kind}
                    className={selectedKind === kind ? "selected" : ""}
                    onClick={() => setSelectedKind(kind)}
                    title={AREA_KIND_HELP[kind]}
                    type="button"
                  >
                    {kind}
                  </button>
                ))}
              </div>
            </div>
            <div className="toolbar-group">
              <div className="eyebrow-row">
                <span className="eyebrow">Slot</span>
                <HelpTip title="Area slots">
                  Each layer has four programmable slots. Use names to label generic slots.
                </HelpTip>
              </div>
              <div className="segmented">
                {AREA_SLOTS.map((slot) => (
                  <button
                    key={slot}
                    className={selectedSlot === slot ? "selected" : ""}
                    onClick={() => setSelectedSlot(slot)}
                    title={
                      device
                        ? `${slot}${device.areaLabels[selectedKind][slot] ? ` - ${device.areaLabels[selectedKind][slot]}` : ""}`
                        : slot
                    }
                    type="button"
                  >
                    {areaDisplayLabel(device.areaLabels, selectedKind, slot)}
                  </button>
                ))}
              </div>
            </div>
            <div className="toolbar-summary">
              <span className="toolbar-stat">Editing {selectedKind}</span>
              <span className="toolbar-stat">Slot {selectedSlotLabel}</span>
              <span className="toolbar-stat">Width span {slotWidthSpan}</span>
              <span className="toolbar-stat">Depth span {slotDepthSpan}</span>
              <span className="toolbar-stat">Height span {slotHeightSpan}</span>
            </div>
          </div>

          <ZoneStudio
            device={device}
            selectedKind={selectedKind}
            selectedSlot={selectedSlot}
            editorRect={editorRect}
            areaLabels={device.areaLabels}
            heatCounts={hitCounts}
            cornerTeachPoints={cornerSamples}
            cornerTeachRect={cornerDraftRect}
            onRectChange={(rect) => {
              setEditorRect(rect);
              setEditorDirty(true);
            }}
          />

          <TeachPanel
            device={device}
            recording={recording}
            hitCounts={hitCounts}
            eventCount={eventCount}
            areaLabels={device.areaLabels}
            liveCornerPoint={liveCornerPoint}
            liveCornerStatus={liveCornerStatus}
            cornerSamples={cornerSamples}
            cornerDraftRect={cornerDraftRect}
            onToggle={toggleRecording}
            onReset={resetTeach}
            onCaptureCorner={captureCornerSample}
            onResetCorners={resetCorners}
            onUseCornerDraft={useCornerDraftForSlot}
          />
        </section>

        <aside className="side-column right-column">
          <section className="panel">
            <div className="panel-heading inline-heading">
              <div>
                <p className="eyebrow">Program</p>
                <div className="heading-row">
                  <h3>{selectedKind} / {selectedSlotLabel}</h3>
                  <HelpTip title="Programming a slot">
                    Writes only the selected rectangle. Other slots are not touched.
                  </HelpTip>
                </div>
                <p className="panel-copy compact-copy">
                  {selectedSlot} / width {slotWidthSpan} / depth {slotDepthSpan}
                </p>
              </div>
              <button
                className="ghost-button"
                onClick={() => {
                  setEditorRect(cloneArea(device.areas[selectedKind][selectedSlot]));
                  setEditorDirty(false);
                }}
                type="button"
              >
                Revert
              </button>
            </div>
            <div className="field-grid">
              {AREA_FIELD_META.map(({ key, label, helpTitle, helpBody }) => (
                <label className="field" key={key}>
                  <span className="field-label">
                    {label}
                    <HelpTip title={helpTitle}>{helpBody}</HelpTip>
                  </span>
                  <input
                    type="number"
                    value={editorRect[key]}
                    onChange={(event) => {
                      setEditorRect((current) => ({
                        ...current,
                        [key]: nextFiniteInputValue(event.target.value, event.target.valueAsNumber, current[key])
                      }));
                      setEditorDirty(true);
                    }}
                  />
                </label>
              ))}
            </div>
            <div className="field-grid compact">
              <label className="field field-span-2">
                <span className="field-label">
                  Area name
                  <HelpTip title="Studio area name">
                    Area names are studio metadata only. They help you recognize slots across the UI.
                  </HelpTip>
                </span>
                <input
                  placeholder={`Optional name for ${selectedSlot}`}
                  value={labelDraft}
                  onChange={(event) => {
                    setLabelDraft(event.target.value);
                    setLabelDirty(true);
                  }}
                />
              </label>
            </div>
            <div className="button-row">
              <button
                className="action-button"
                disabled={Boolean(busyAction)}
                onClick={() => {
                  void runAction("apply-area", () =>
                    mmwaveUpdateArea(device.meta.friendlyName, selectedKind, selectedSlot, editorRect)
                  ).then((updated) => {
                    if (updated) {
                      setEditorDirty(false);
                    }
                  });
                }}
                type="button"
              >
                {busyAction === "apply-area" ? "Applying..." : "Apply slot"}
              </button>
              <button
                className="ghost-button"
                disabled={Boolean(busyAction)}
                onClick={() => {
                  void runAction("save-area-label", () =>
                    mmwaveUpdateAreaLabel(device.meta.friendlyName, selectedKind, selectedSlot, labelDraft)
                  ).then((updated) => {
                    if (updated) {
                      setLabelDirty(false);
                    }
                  });
                }}
                type="button"
              >
                {busyAction === "save-area-label" ? "Saving name..." : "Save area name"}
              </button>
              <button
                className="ghost-button"
                disabled={Boolean(busyAction)}
                onClick={() => {
                  void runAction("clear-area", () =>
                    mmwaveUpdateArea(device.meta.friendlyName, selectedKind, selectedSlot, ZERO_AREA)
                  ).then((updated) => {
                    if (updated) {
                      setEditorDirty(false);
                    }
                  });
                }}
                type="button"
              >
                Clear slot
              </button>
            </div>
          </section>

          <section className="panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Sensor model</p>
                <div className="heading-row">
                  <h3>Motion behavior</h3>
                  <HelpTip title="Motion model">
                    Sensitivity and trigger affect motion acquisition. Hold time and stay life affect occupancy
                    release. Base bounds set the maximum editable plane.
                  </HelpTip>
                </div>
              </div>
            </div>
            <div className="field-grid compact">
              <label className="field">
                <span className="field-label">
                  Sensitivity
                  <HelpTip title="Detect sensitivity">
                    Higher sensitivity reacts to weaker movement but can increase false positives.
                  </HelpTip>
                </span>
                <select
                  value={settingsDraft.detectSensitivity}
                  onChange={(event) => {
                    setSettingsDraft((current) =>
                      current ? { ...current, detectSensitivity: event.target.value } : current
                    );
                    setSettingsDirty(true);
                  }}
                >
                  <option>Low</option>
                  <option>Medium</option>
                  <option>High (default)</option>
                  <option>High</option>
                </select>
              </label>
              <label className="field">
                <span className="field-label">
                  Trigger
                  <HelpTip title="Detect trigger speed">
                    Controls how fast occupancy activates after motion is seen.
                  </HelpTip>
                </span>
                <select
                  value={settingsDraft.detectTrigger}
                  onChange={(event) => {
                    setSettingsDraft((current) => (current ? { ...current, detectTrigger: event.target.value } : current));
                    setSettingsDirty(true);
                  }}
                >
                  <option>Fast (0.2s, default)</option>
                  <option>Medium (0.5s)</option>
                  <option>Slow (1s)</option>
                </select>
              </label>
              <label className="field">
                <span className="field-label">
                  Hold time
                  <HelpTip title="Hold time">
                    Time the sensor keeps occupancy active after motion stops.
                  </HelpTip>
                </span>
                <input
                  type="number"
                  value={settingsDraft.holdTime ?? 30}
                  onChange={(event) => {
                    setSettingsDraft((current) =>
                      current
                        ? {
                            ...current,
                            holdTime: nextFiniteInputValue(
                              event.target.value,
                              event.target.valueAsNumber,
                              current.holdTime ?? 30
                            )
                          }
                        : current
                    );
                    setSettingsDirty(true);
                  }}
                />
              </label>
              <label className="field">
                <span className="field-label">
                  Stay life
                  <HelpTip title="Stay life">
                    Preserves occupancy in stay areas with very little movement.
                  </HelpTip>
                </span>
                <input
                  type="number"
                  value={settingsDraft.stayLife ?? 300}
                  onChange={(event) => {
                    setSettingsDraft((current) =>
                      current
                        ? {
                            ...current,
                            stayLife: nextFiniteInputValue(
                              event.target.value,
                              event.target.valueAsNumber,
                              current.stayLife ?? 300
                            )
                          }
                        : current
                    );
                    setSettingsDirty(true);
                  }}
                />
              </label>
              <label className="field">
                <span className="field-label">
                  Target dots
                  <HelpTip title="Target information reporting">
                    Enable for live target coordinates and richer diagnostics.
                  </HelpTip>
                </span>
                <select
                  value={settingsDraft.targetInfoReport}
                  onChange={(event) => {
                    setSettingsDraft((current) => (current ? { ...current, targetInfoReport: event.target.value } : current));
                    setSettingsDirty(true);
                  }}
                >
                  <option>Enable</option>
                  <option>Disable (default)</option>
                </select>
              </label>
              <label className="field">
                <span className="field-label">
                  Wired load control
                  <HelpTip title="Wired load behavior">
                    Whether occupancy drives the physical load connected to the switch.
                  </HelpTip>
                </span>
                <select
                  value={settingsDraft.controlWiredDevice}
                  onChange={(event) => {
                    setSettingsDraft((current) =>
                      current ? { ...current, controlWiredDevice: event.target.value } : current
                    );
                    setSettingsDirty(true);
                  }}
                >
                  <option>Occupancy (default)</option>
                  <option>Disabled</option>
                </select>
              </label>
              <label className="field">
                <span className="field-label">
                  Motion-on level
                  <HelpTip title="Local turn-on level">
                    The dimmer level used when occupancy drives the wired load.
                  </HelpTip>
                </span>
                <select
                  value={motionOnUsesPreviousLevel ? "previous" : "fixed"}
                  onChange={(event) => {
                    const nextValue =
                      event.target.value === "previous"
                        ? DEFAULT_LEVEL_LOCAL_PREVIOUS
                        : defaultLevelLocalFromPercent(motionOnLevelPercent);
                    setSettingsDraft((current) =>
                      current ? { ...current, defaultLevelLocal: nextValue } : current
                    );
                    setSettingsDirty(true);
                  }}
                >
                  <option value="previous">Previous level</option>
                  <option value="fixed">Fixed percent</option>
                </select>
              </label>
              <label className="field">
                <span className="field-label">
                  Motion-on brightness %
                  <HelpTip title="Fixed motion brightness">
                    Occupancy brings the wired load on at this brightness.
                  </HelpTip>
                </span>
                <input
                  type="number"
                  min={1}
                  max={100}
                  disabled={motionOnUsesPreviousLevel}
                  value={motionOnLevelPercent}
                  onChange={(event) => {
                    setSettingsDraft((current) =>
                      current
                        ? {
                            ...current,
                            defaultLevelLocal: defaultLevelLocalFromPercent(
                              nextFiniteInputValue(
                                event.target.value,
                                event.target.valueAsNumber,
                                motionOnLevelPercent
                              )
                            )
                          }
                        : current
                    );
                    setSettingsDirty(true);
                  }}
                />
              </label>
            </div>
            <div className="field-grid compact">
              {BASE_BOUND_FIELD_META.map(({ key, label, helpTitle, helpBody }) => (
                <label className="field" key={`base-${key}`}>
                  <span className="field-label">
                    {label}
                    <HelpTip title={helpTitle}>{helpBody}</HelpTip>
                  </span>
                  <input
                    type="number"
                    value={settingsDraft.baseBounds?.[key] ?? device.settings.baseBounds[key]}
                    onChange={(event) => {
                      setSettingsDraft((current) =>
                        current
                          ? {
                              ...current,
                              baseBounds: {
                                ...(current.baseBounds ?? device.settings.baseBounds),
                                [key]: nextFiniteInputValue(
                                  event.target.value,
                                  event.target.valueAsNumber,
                                  (current.baseBounds ?? device.settings.baseBounds)[key]
                                )
                              }
                            }
                          : current
                      );
                      setSettingsDirty(true);
                    }}
                  />
                </label>
              ))}
            </div>
            <div className="button-row">
              <button
                className="action-button"
                disabled={Boolean(busyAction)}
                onClick={() => {
                  void runAction("apply-settings", () =>
                    mmwaveUpdateSettings(device.meta.friendlyName, settingsDraft)
                  ).then((updated) => {
                    if (updated) {
                      setSettingsDirty(false);
                    }
                  });
                }}
                type="button"
              >
                {busyAction === "apply-settings" ? "Saving..." : "Apply motion settings"}
              </button>
              <button
                className="ghost-button"
                disabled={Boolean(busyAction)}
                onClick={() => {
                  setEditorDirty(false);
                  setSettingsDirty(false);
                  setLabelDirty(false);
                  void runAction("query-areas", () => mmwaveQueryAreas(device.meta.friendlyName));
                }}
                type="button"
              >
                Sync from device
              </button>
            </div>
          </section>

          <section className="panel">
            <div className="panel-heading inline-heading">
              <div>
                <p className="eyebrow">Profiles</p>
                <div className="heading-row">
                  <h3>Saved room tunings</h3>
                  <HelpTip title="Profiles">
                    Capture geometry plus motion-model settings to clone, export, or roll back.
                  </HelpTip>
                </div>
              </div>
              <button className="ghost-button" onClick={startNewProfileDraft} type="button">
                New draft
              </button>
            </div>
            <div className="profile-list">
              {profiles.map((profile) => (
                <button
                  key={profile.id}
                  className={`profile-chip${profile.id === selectedProfileId ? " selected" : ""}`}
                  onClick={() => setSelectedProfileId(profile.id)}
                  type="button"
                >
                  <strong>{profile.name}</strong>
                  <span>{profile.sourceDevice}</span>
                  <span>Updated {formatTimestamp(profile.updatedAt)}</span>
                </button>
              ))}
            </div>
            <div className="field-grid compact">
              <label className="field">
                <span>Profile name</span>
                <input value={profileName} onChange={(event) => setProfileName(event.target.value)} />
              </label>
              <label className="field field-span-2">
                <span>Notes</span>
                <textarea
                  className="field-textarea"
                  value={profileNotes}
                  onChange={(event) => setProfileNotes(event.target.value)}
                />
              </label>
            </div>
            {selectedProfile ? (
              <p className="panel-copy compact-copy">
                Selected profile source: {selectedProfile.sourceDevice} ({selectedProfile.model})
              </p>
            ) : null}
            <div className="button-stack">
              <button
                className="action-button"
                disabled={Boolean(busyAction)}
                onClick={() => saveProfile(false)}
                type="button"
              >
                {busyAction === "save-profile" ? "Saving..." : "Save new profile"}
              </button>
              <button
                className="ghost-button"
                disabled={Boolean(busyAction) || !selectedProfile}
                onClick={() => saveProfile(true)}
                type="button"
              >
                {busyAction === "update-profile" ? "Updating..." : "Overwrite selected profile"}
              </button>
              <button
                className="ghost-button"
                disabled={Boolean(busyAction) || !selectedProfile}
                onClick={() => {
                  if (!selectedProfile) {
                    return;
                  }
                  if (!window.confirm(`Apply "${selectedProfile.name}" to ${device.meta.friendlyName}?`)) {
                    return;
                  }
                  return runAction("apply-profile", () =>
                    applyMmwaveProfile(selectedProfile.id, device.meta.friendlyName)
                  );
                }}
                type="button"
              >
                {busyAction === "apply-profile"
                  ? "Applying profile..."
                  : `Apply to ${device.meta.friendlyName}`}
              </button>
            </div>
            <div className="button-row">
              <button
                className="ghost-button"
                disabled={!selectedProfile}
                onClick={() => exportProfile()}
                type="button"
              >
                Export JSON
              </button>
              <button
                className="ghost-button"
                disabled={Boolean(busyAction)}
                onClick={() => importInputRef.current?.click()}
                type="button"
              >
                {busyAction === "import-profile" ? "Importing..." : "Import JSON"}
              </button>
              <button
                className="ghost-button"
                disabled={Boolean(busyAction) || !selectedProfile}
                onClick={() => removeProfile()}
                type="button"
              >
                Delete
              </button>
            </div>
            <input
              accept="application/json"
              className="hidden-file-input"
              onChange={importProfileFile}
              ref={importInputRef}
              type="file"
            />
          </section>

          <section className="panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Maintenance</p>
                <div className="heading-row">
                  <h3>Fast actions</h3>
                  <HelpTip title="Maintenance actions">
                    Direct convenience commands to reset or clear entire layers at once.
                  </HelpTip>
                </div>
              </div>
            </div>
            <div className="button-stack">
              <button
                className="ghost-button"
                disabled={Boolean(busyAction)}
                onClick={() => runAction("reset-detection", () => mmwaveResetDetection(device.meta.friendlyName))}
                type="button"
              >
                Reset detection areas
              </button>
              <button
                className="ghost-button"
                disabled={Boolean(busyAction)}
                onClick={() => runAction("clear-interference", () => mmwaveClearInterference(device.meta.friendlyName))}
                type="button"
              >
                Clear exclusion areas
              </button>
              <button
                className="ghost-button"
                disabled={Boolean(busyAction)}
                onClick={() => runAction("clear-stay", () => mmwaveClearStay(device.meta.friendlyName))}
                type="button"
              >
                Clear stay areas
              </button>
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}

export default MmwaveWorkspace;
