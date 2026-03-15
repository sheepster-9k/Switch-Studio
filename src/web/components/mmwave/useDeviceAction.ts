import { useState } from "react";

import type { DeviceSnapshot } from "../../../shared/mmwaveTypes";
import { errorMessage } from "../../../shared/types";

export function applyDeviceUpdate(devices: DeviceSnapshot[], updated: DeviceSnapshot): DeviceSnapshot[] {
  const next = devices.filter((device) => device.meta.friendlyName !== updated.meta.friendlyName);
  next.push(updated);
  next.sort((left, right) => left.meta.friendlyName.localeCompare(right.meta.friendlyName));
  return next;
}

export function useDeviceAction(
  setDevices: React.Dispatch<React.SetStateAction<DeviceSnapshot[]>>
) {
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function runAction(label: string, action: () => Promise<DeviceSnapshot>): Promise<DeviceSnapshot | null> {
    setBusyAction(label);
    setError(null);
    try {
      const updated = await action();
      setDevices((current) => applyDeviceUpdate(current, updated));
      return updated;
    } catch (nextError) {
      setError(errorMessage(nextError));
      return null;
    } finally {
      setBusyAction(null);
    }
  }

  return { busyAction, error, setError, setBusyAction, runAction };
}
