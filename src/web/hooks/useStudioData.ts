import { startTransition, useEffect, useState } from "react";

import {
  fetchAutomations,
  fetchDiscovery,
  fetchHealth,
  fetchLearning,
  fetchSnapshot,
  fetchDeviceProperties,
  controlEntity,
  isAuthError
} from "../api";
import {
  errorMessage,
  type AuthStatusResponse,
  type AutomationSummary,
  type DevicePropertiesResponse,
  type DiscoveryCandidate,
  type HealthResponse,
  type LearningLibraryResponse,
  type StudioSnapshot,
  type SwitchManagerConfig
} from "../../shared/types";
import { cloneConfig } from "../helpers";

export interface StudioDataState {
  health: HealthResponse | null;
  snapshot: StudioSnapshot | null;
  discovery: DiscoveryCandidate[];
  automations: AutomationSummary[];
  learning: LearningLibraryResponse | null;
  properties: DevicePropertiesResponse | null;
  propertyDrawerOpen: boolean;
}

export interface StudioDataActions {
  loadStudio(preferredConfigId?: string, options?: { blocking?: boolean }): Promise<boolean>;
  refreshLearning(): Promise<void>;
  openPropertyDrawer(deviceId: string): Promise<void>;
  closePropertyDrawer(): void;
  handlePropertyControl(entityId: string, action: string, value?: unknown, deviceId?: string | null): Promise<void>;
  setProperties: React.Dispatch<React.SetStateAction<DevicePropertiesResponse | null>>;
  setAutomations: React.Dispatch<React.SetStateAction<AutomationSummary[]>>;
}

export type StudioData = StudioDataState & StudioDataActions;

export function useStudioData(deps: {
  setAuthStatus: React.Dispatch<React.SetStateAction<AuthStatusResponse | null>>;
  setLoading: (loading: boolean) => void;
  setBlockingError: (error: string | null) => void;
  showActionError: (error: unknown) => void;
  setNotice: (notice: { kind: "error" | "success"; text: string } | null) => void;
  onSnapshotLoaded: (
    snapshot: StudioSnapshot,
    preferredConfigId?: string
  ) => void;
}): StudioData {
  const { setAuthStatus, setLoading, setBlockingError, showActionError, setNotice, onSnapshotLoaded } = deps;

  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [snapshot, setSnapshot] = useState<StudioSnapshot | null>(null);
  const [discovery, setDiscovery] = useState<DiscoveryCandidate[]>([]);
  const [automations, setAutomations] = useState<AutomationSummary[]>([]);
  const [learning, setLearning] = useState<LearningLibraryResponse | null>(null);
  const [properties, setProperties] = useState<DevicePropertiesResponse | null>(null);
  const [propertyDrawerOpen, setPropertyDrawerOpen] = useState(false);

  // Learning polling effect
  useEffect(() => {
    if (!learning?.activeSession?.active) {
      return;
    }
    let cancelled = false;
    let polling = false;
    const timer = window.setInterval(() => {
      if (cancelled || polling) {
        return;
      }
      polling = true;
      void refreshLearning().finally(() => {
        polling = false;
      });
    }, 3000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [learning?.activeSession?.active]);

  async function loadStudio(
    preferredConfigId?: string,
    options: { blocking?: boolean } = {}
  ): Promise<boolean> {
    const blocking = options.blocking ?? true;
    setLoading(true);
    if (blocking) {
      setBlockingError(null);
    }
    try {
      const [nextHealth, nextSnapshot, discoveryResult, automationsResult, learningResult] = await Promise.all([
        fetchHealth(),
        fetchSnapshot(),
        fetchDiscovery().catch(() => []),
        fetchAutomations().catch(() => []),
        fetchLearning().catch(() => null)
      ]);

      startTransition(() => {
        setHealth(nextHealth);
        setAuthStatus((current) =>
          current
            ? {
                ...current,
                authenticated: true,
                haBaseUrl: nextHealth.haBaseUrl
              }
            : current
        );
        setSnapshot(nextSnapshot);
        setDiscovery(discoveryResult);
        setAutomations(automationsResult);
        setLearning(learningResult);
        onSnapshotLoaded(nextSnapshot, preferredConfigId);
      });
      return true;
    } catch (error) {
      if (isAuthError(error)) {
        return false;
      }
      if (blocking) {
        setBlockingError(errorMessage(error));
      } else {
        showActionError(error);
      }
      return false;
    } finally {
      setLoading(false);
    }
  }

  async function refreshLearning(): Promise<void> {
    try {
      setLearning(await fetchLearning());
    } catch {
      // Keep the last known learning state in the UI.
    }
  }

  async function openPropertyDrawer(deviceId: string): Promise<void> {
    try {
      setProperties(await fetchDeviceProperties(deviceId));
      setPropertyDrawerOpen(true);
    } catch (error) {
      showActionError(error);
    }
  }

  function closePropertyDrawer(): void {
    setPropertyDrawerOpen(false);
  }

  async function handlePropertyControl(
    entityId: string,
    action: string,
    value?: unknown,
    deviceId?: string | null
  ): Promise<void> {
    try {
      await controlEntity(entityId, action, value);
      if (deviceId) {
        setProperties(await fetchDeviceProperties(deviceId));
      }
      setNotice({ kind: "success", text: `Updated ${entityId}.` });
    } catch (error) {
      showActionError(error);
    }
  }

  return {
    health,
    snapshot,
    discovery,
    automations,
    learning,
    properties,
    propertyDrawerOpen,
    loadStudio,
    refreshLearning,
    openPropertyDrawer,
    closePropertyDrawer,
    handlePropertyControl,
    setProperties,
    setAutomations
  };
}
