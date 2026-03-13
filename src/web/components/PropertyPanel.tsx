import { useEffect } from "react";

import type { DevicePropertiesResponse } from "../../shared/types";

interface PropertyPanelProps {
  open: boolean;
  properties: DevicePropertiesResponse | null;
  onClose: () => void;
  onControl: (entityId: string, action: string, value?: unknown) => void;
}

export function PropertyPanel(props: PropertyPanelProps) {
  const { open, properties, onClose, onControl } = props;

  useEffect(() => {
    if (!open) {
      return undefined;
    }
    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        onClose();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose, open]);

  if (!open) {
    return null;
  }

  return (
    <aside className="property-drawer">
      <button
        aria-label="Close properties"
        className="property-drawer__backdrop"
        onClick={onClose}
        type="button"
      />
      <div className="property-drawer__panel">
        <div className="panel-head">
          <div>
            <p className="eyebrow">Properties</p>
            <h3>{properties?.device?.name ?? "Device"}</h3>
          </div>
          <button className="button" onClick={onClose} type="button">
            Close
          </button>
        </div>

        <p className="panel-copy">
          {[properties?.device?.manufacturer, properties?.device?.model, properties?.probableProtocol]
            .filter(Boolean)
            .join(" / ")}
        </p>

        <div className="stack-list">
          {(properties?.entities ?? []).map((entity) => (
            <div className="stack-card" key={entity.entityId}>
              <div className="stack-card__top">
                <div>
                  <strong>{entity.name}</strong>
                  <p>{entity.entityId}</p>
                </div>
                <span className="pill">{entity.state ?? "unknown"}</span>
              </div>

              {entity.controlType === "toggle" ? (
                <div className="inline-actions">
                  <button className="button" onClick={() => onControl(entity.entityId, "turn_on")} type="button">
                    On
                  </button>
                  <button className="button" onClick={() => onControl(entity.entityId, "turn_off")} type="button">
                    Off
                  </button>
                  <button className="button" onClick={() => onControl(entity.entityId, "toggle")} type="button">
                    Toggle
                  </button>
                </div>
              ) : null}

              {entity.controlType === "select" ? (
                <div className="target-chips">
                  {entity.options.map((option) => (
                    <button
                      className="target-chip"
                      key={`${entity.entityId}-${option}`}
                      onClick={() => onControl(entity.entityId, "select_option", option)}
                      type="button"
                    >
                      {option}
                    </button>
                  ))}
                </div>
              ) : null}

              {entity.controlType === "number" ? (
                <div className="inline-actions">
                  <button
                    className="button"
                    onClick={() => onControl(entity.entityId, "set_value", entity.min ?? 0)}
                    type="button"
                  >
                    Set min
                  </button>
                  <button
                    className="button"
                    onClick={() => onControl(entity.entityId, "set_value", entity.max ?? entity.state ?? 0)}
                    type="button"
                  >
                    Set max
                  </button>
                </div>
              ) : null}

              {entity.controlType === "button" ? (
                <div className="inline-actions">
                  <button className="button" onClick={() => onControl(entity.entityId, "press")} type="button">
                    Press
                  </button>
                </div>
              ) : null}
            </div>
          ))}
        </div>
      </div>
    </aside>
  );
}
