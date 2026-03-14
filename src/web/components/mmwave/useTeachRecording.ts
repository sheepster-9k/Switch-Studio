import { useEffect, useRef, useState } from "react";

import type { AreaSlot, DeviceSnapshot } from "../../../shared/mmwaveTypes";
import { AREA_SLOTS } from "../../../shared/mmwaveUtils";

function emptyHitCounts(): Record<AreaSlot, number> {
  return { area1: 0, area2: 0, area3: 0, area4: 0 };
}

export function useTeachRecording(selectedDevice: DeviceSnapshot | null) {
  const [recording, setRecording] = useState(false);
  const [hitCounts, setHitCounts] = useState<Record<AreaSlot, number>>(emptyHitCounts);
  const [eventCount, setEventCount] = useState(0);
  const previousOccupancy = useRef<Record<string, Record<AreaSlot, boolean | null>>>({});

  useEffect(() => {
    setRecording(false);
    setEventCount(0);
    setHitCounts(emptyHitCounts());
  }, [selectedDevice?.meta.friendlyName]);

  // updatedAt changes whenever areaOccupancy changes (server sets both together),
  // so tracking updatedAt is sufficient to catch every occupancy transition.
  useEffect(() => {
    if (!selectedDevice || !recording) {
      return;
    }
    const before = previousOccupancy.current[selectedDevice.meta.friendlyName] ?? {
      area1: null,
      area2: null,
      area3: null,
      area4: null
    };
    const next = selectedDevice.settings.areaOccupancy;
    let sawTransition = false;
    const increments: Record<AreaSlot, number> = { area1: 0, area2: 0, area3: 0, area4: 0 };
    for (const slot of AREA_SLOTS) {
      if (next[slot] && !before[slot]) {
        increments[slot] += 1;
        sawTransition = true;
      }
    }
    previousOccupancy.current[selectedDevice.meta.friendlyName] = next;
    if (sawTransition) {
      setEventCount((current) => current + 1);
      setHitCounts((current) => ({
        area1: current.area1 + increments.area1,
        area2: current.area2 + increments.area2,
        area3: current.area3 + increments.area3,
        area4: current.area4 + increments.area4
      }));
    }
  }, [recording, selectedDevice?.updatedAt]);

  return {
    recording,
    hitCounts,
    eventCount,
    toggleRecording: () => {
      if (selectedDevice) {
        // Snapshot current occupancy so the first transition after toggle-on is detected correctly.
        previousOccupancy.current[selectedDevice.meta.friendlyName] = selectedDevice.settings.areaOccupancy;
      }
      setRecording((current) => !current);
    },
    resetTeach: () => {
      setRecording(false);
      setEventCount(0);
      setHitCounts(emptyHitCounts());
    }
  };
}
