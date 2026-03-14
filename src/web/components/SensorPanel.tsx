import { useEffect, useRef, useState } from "react";

import {
  deleteBlueprintImageOverride,
  fetchBlueprintImageStatus,
  fetchDeviceImage,
  uploadBlueprintImageOverride
} from "../api";
import { blueprintImageUrl, convertToPng } from "../imageUtils";
import type {
  AreaSummary,
  BlueprintImageStatus,
  SwitchManagerBlueprint,
  SwitchManagerConfig
} from "../../shared/types";

interface SensorPanelProps {
  areas: AreaSummary[];
  draft: SwitchManagerConfig;
  onAreaChange: (areaId: string | null) => void;
  onDelete: () => void;
  onEnabledToggle: (enabled: boolean) => void;
  onIdentifierChange: (value: string) => void;
  onNameChange: (value: string) => void;
  onSelectTrigger: (index: number) => void;
  selectedAreaId: string | null;
  selectedBlueprint: SwitchManagerBlueprint;
  selectedButtonIndex: number;
}

export function SensorPanel(props: SensorPanelProps) {
  const {
    areas,
    draft,
    onAreaChange,
    onDelete,
    onEnabledToggle,
    onIdentifierChange,
    onNameChange,
    onSelectTrigger,
    selectedAreaId,
    selectedBlueprint,
    selectedButtonIndex
  } = props;

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [imageStatus, setImageStatus] = useState<BlueprintImageStatus | null>(null);
  const [imageRevision, setImageRevision] = useState(0);
  const [imageBusy, setImageBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setImageStatus(null);

    void fetchBlueprintImageStatus(selectedBlueprint.id)
      .then((status) => {
        if (!cancelled) {
          setImageStatus(status);
        }
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
    setImageRevision(0);
  }, [selectedBlueprint.id]);

  const imageAvailable = Boolean(imageStatus?.hasImage);

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
    } catch (error) {
      // Error silently falls through; no onNotify prop on SensorPanel. User sees no change.
      void error;
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
    } catch {
      // no-op
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
    } catch {
      // no-op
    } finally {
      setImageBusy(false);
    }
  }

  return (
    <section className="panel panel--form">
      <div className="panel-head">
        <div>
          <p className="eyebrow">Sensor</p>
          <h3>{selectedBlueprint.name}</h3>
        </div>
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
      </div>

      <div className={`sensor-layout${imageAvailable ? "" : " sensor-layout--no-image"}`}>
        {imageAvailable ? (
          <div className="sensor-image-frame">
            <img
              alt={selectedBlueprint.name}
              src={blueprintImageUrl(selectedBlueprint.id, imageRevision)}
            />
          </div>
        ) : null}

        <div className="sensor-triggers">
          <div className="sensor-triggers__head">
            <p className="eyebrow">Triggers</p>
            <div className="inline-actions">
              {draft.deviceId ? (
                <button
                  className="button button--ghost"
                  disabled={imageBusy}
                  onClick={() => void handleFetchDeviceImage()}
                  type="button"
                >
                  {imageBusy ? "Fetching..." : "Fetch image from device"}
                </button>
              ) : null}
              <button
                className="button button--ghost"
                disabled={imageBusy}
                onClick={() => fileInputRef.current?.click()}
                type="button"
              >
                Import image
              </button>
              {imageStatus?.hasOverride ? (
                <button
                  className="button button--ghost"
                  disabled={imageBusy}
                  onClick={() => void handleResetImage()}
                  type="button"
                >
                  Reset image
                </button>
              ) : null}
            </div>
          </div>

          <input
            accept=".png,.jpg,.jpeg,.webp,.gif,.svg,image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
            hidden
            onChange={(event) => void handleImportImage(event.target.files?.[0] ?? null)}
            ref={fileInputRef}
            type="file"
          />

          <div className="action-tabs action-tabs--vertical">
            {selectedBlueprint.buttons.length === 0 ? (
              <div className="empty-state">No triggers defined in this blueprint.</div>
            ) : null}
            {selectedBlueprint.buttons.map((button, index) => {
              const triggerLabel = button.actions[0]?.title ?? `Trigger ${index + 1}`;
              const actionCount = draft.buttons[index]?.actions[0]?.sequence.length ?? 0;
              return (
                <button
                  className={`action-tab ${index === selectedButtonIndex ? "action-tab--selected" : ""}`}
                  key={index}
                  onClick={() => onSelectTrigger(index)}
                  type="button"
                >
                  <strong>{triggerLabel}</strong>
                  <span>{actionCount} steps</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div className="inline-actions">
        <button className="button button--danger" onClick={onDelete} type="button">
          Delete
        </button>
      </div>
    </section>
  );
}
