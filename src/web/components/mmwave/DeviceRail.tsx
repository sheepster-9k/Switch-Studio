import type { DeviceSnapshot } from "../../../shared/mmwaveTypes";
import { HelpTip } from "./HelpTip";

interface DeviceRailProps {
  devices: DeviceSnapshot[];
  selectedName: string | null;
  onSelect: (name: string) => void;
}

export function DeviceRail({ devices, selectedName, onSelect }: DeviceRailProps) {
  return (
    <aside className="device-rail panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Switches</p>
          <div className="heading-row">
            <h2>Motion devices</h2>
            <HelpTip title="Switch list">
              The studio only lists VZM32-SN switches discovered from Zigbee2MQTT. "Target dots ready" means
              the switch is publishing richer target telemetry. "Occupancy fallback" means the studio is
              working from area occupancy states only.
            </HelpTip>
          </div>
        </div>
        <span className="ghost-pill rail-count">{devices.length} live</span>
      </div>
      <p className="panel-copy compact-copy">
        Pick the physical switch you want to tune. The selected device drives geometry, live motion, profiles,
        and programming writes everywhere else in the studio.
      </p>
      <div className="device-list">
        {devices.map((device) => {
          const selected = device.meta.friendlyName === selectedName;
          const occupied = Object.values(device.settings.areaOccupancy).some(Boolean);
          const activeAreas = Object.values(device.settings.areaOccupancy).filter(Boolean).length;
          const trackingLabel = device.supportsTargetDots ? "Target dots ready" : "Occupancy fallback";
          return (
            <button
              key={device.meta.ieeeAddress}
              className={`device-chip${selected ? " selected" : ""}`}
              onClick={() => onSelect(device.meta.friendlyName)}
              title={`${device.meta.friendlyName} | ${device.availability} | ${trackingLabel}`}
              type="button"
            >
              <span className={`status-dot ${device.availability}`}></span>
              <span className="device-chip-copy">
                <span className="device-chip-kicker">{device.meta.model}</span>
                <strong>{device.meta.friendlyName}</strong>
                <span className="device-chip-statusline">
                  <span className="device-chip-state">
                    {occupied ? `${activeAreas} active lane${activeAreas === 1 ? "" : "s"}` : device.availability}
                  </span>
                  <span className={`device-chip-badge ${device.supportsTargetDots ? "target" : "fallback"}`}>
                    {trackingLabel}
                  </span>
                </span>
                <span className="device-chip-meta">
                  {selected ? "Selected for geometry, teach mode, and programming." : "Tap to inspect and program this switch."}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </aside>
  );
}
