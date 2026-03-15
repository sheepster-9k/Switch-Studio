import { useCallback, useMemo, useState } from "react";

import type {
  AutomationSummary,
  DeviceSummary,
  EntitySummary,
  SequenceStep,
  StudioSnapshot,
  SwitchManagerBlueprint,
  SwitchManagerConfig
} from "../../shared/types";
import { cloneConfig, cloneStep, resolvedConfigAreaId, type AutomationTarget, type WorkspaceMode } from "../helpers";

export interface DraftConfigState {
  selectedConfigId: string;
  draft: SwitchManagerConfig | null;
  dirty: boolean;
  selectedButtonIndex: number;
  selectedActionIndex: number;
  selectedStepIndex: number;
  selectedVirtualPressCount: number;
  automationTarget: AutomationTarget;
  selectedStoredConfig: SwitchManagerConfig | null;
  selectedBlueprint: SwitchManagerBlueprint | null;
  selectedAreaId: string | null;
  blueprintsById: Map<string, SwitchManagerBlueprint>;
  devicesById: Map<string, DeviceSummary>;
  entitiesById: Map<string, EntitySummary>;
}

export interface DraftConfigActions {
  selectConfig(config: SwitchManagerConfig): void;
  updateDraft(mutator: (config: SwitchManagerConfig) => void): void;
  updateSelectedStep(mutator: (step: SequenceStep) => SequenceStep): void;
  replaceSelectedSequence(sequence: SequenceStep[], nextSelectedIndex?: number): void;
  replaceSelectedStep(step: SequenceStep): void;
  updateVirtualAction(
    pressCount: number,
    next: Partial<{ title: string; mode: string; sequence: SequenceStep[] }>
  ): void;
  handleImportAutomation(automation: AutomationSummary): void;
  setDraft: React.Dispatch<React.SetStateAction<SwitchManagerConfig | null>>;
  setSelectedConfigId: React.Dispatch<React.SetStateAction<string>>;
  setSelectedButtonIndex: React.Dispatch<React.SetStateAction<number>>;
  setSelectedActionIndex: React.Dispatch<React.SetStateAction<number>>;
  setSelectedStepIndex: React.Dispatch<React.SetStateAction<number>>;
  setSelectedVirtualPressCount: React.Dispatch<React.SetStateAction<number>>;
  setAutomationTarget: React.Dispatch<React.SetStateAction<AutomationTarget>>;
  resetDraftSelections(): void;
  /** Apply a loaded snapshot — selects the preferred config (or first) and resets indices. */
  applySnapshot(snapshot: StudioSnapshot, preferredConfigId?: string): void;
}

export type DraftConfig = DraftConfigState & DraftConfigActions;

export function useDraftConfig(deps: {
  snapshot: StudioSnapshot | null;
  setNotice: (notice: { kind: "error" | "success"; text: string } | null) => void;
  setProperties: React.Dispatch<React.SetStateAction<import("../../shared/types").DevicePropertiesResponse | null>>;
  setActiveWorkspace: React.Dispatch<React.SetStateAction<WorkspaceMode>>;
}): DraftConfig {
  const { snapshot, setNotice, setProperties, setActiveWorkspace } = deps;

  const [selectedConfigId, setSelectedConfigId] = useState("");
  const [draft, setDraft] = useState<SwitchManagerConfig | null>(null);
  const [selectedButtonIndex, setSelectedButtonIndex] = useState(0);
  const [selectedActionIndex, setSelectedActionIndex] = useState(0);
  const [selectedStepIndex, setSelectedStepIndex] = useState(0);
  const [selectedVirtualPressCount, setSelectedVirtualPressCount] = useState(2);
  const [automationTarget, setAutomationTarget] = useState<AutomationTarget>("native");

  const [dirtyFlag, setDirtyFlag] = useState(false);

  const blueprintsById = useMemo(
    () => new Map(snapshot?.blueprints.map((blueprint) => [blueprint.id, blueprint]) ?? []),
    [snapshot]
  );
  const devicesById = useMemo(
    () => new Map(snapshot?.devices.map((device) => [device.id, device]) ?? []),
    [snapshot]
  );
  const entitiesById = useMemo(
    () => new Map(snapshot?.entities.map((entity) => [entity.entityId, entity]) ?? []),
    [snapshot]
  );

  const setDraftAndDirty: typeof setDraft = useCallback((action) => {
    setDraft((current) => {
      const next = typeof action === "function" ? action(current) : action;
      setDirtyFlag(next !== null && next !== current);
      return next;
    });
  }, []);

  const selectedStoredConfig = useMemo(
    () => snapshot?.configs.find((config) => config.id === selectedConfigId) ?? null,
    [snapshot, selectedConfigId]
  );
  const selectedBlueprint = draft ? blueprintsById.get(draft.blueprintId) ?? null : null;
  const selectedAreaId = draft ? resolvedConfigAreaId(draft, devicesById, entitiesById) : null;
  const dirty = dirtyFlag && draft !== null;

  function resetDraftSelections(): void {
    setSelectedButtonIndex(0);
    setSelectedActionIndex(0);
    setSelectedStepIndex(0);
    setSelectedVirtualPressCount(2);
    setAutomationTarget("native");
    setDirtyFlag(false);
  }

  function applySnapshot(nextSnapshot: StudioSnapshot, preferredConfigId?: string): void {
    const fallbackId = nextSnapshot.configs[0]?.id ?? "";
    const nextId =
      preferredConfigId && nextSnapshot.configs.some((config) => config.id === preferredConfigId)
        ? preferredConfigId
        : fallbackId;
    setSelectedConfigId(nextId);
    const nextConfig = nextSnapshot.configs.find((config) => config.id === nextId) ?? null;
    setDraft(nextConfig ? cloneConfig(nextConfig) : null);
    resetDraftSelections();
  }

  function selectConfig(config: SwitchManagerConfig): void {
    const blueprint = blueprintsById.get(config.blueprintId);
    setSelectedConfigId(config.id);
    setDraft(cloneConfig(config));
    resetDraftSelections();
    setProperties(null);
    setNotice(null);
    // Sensor configs don't support Virtual Press; bounce back to editor if needed.
    if (blueprint?.blueprintType === "sensor") {
      setActiveWorkspace((current) => (current === "virtual" ? "editor" : current));
    }
  }

  function updateDraft(mutator: (config: SwitchManagerConfig) => void): void {
    setDraft((current) => {
      if (!current) {
        return current;
      }
      const next = cloneConfig(current);
      mutator(next);
      return next;
    });
    setDirtyFlag(true);
  }

  function updateSelectedStep(mutator: (step: SequenceStep) => SequenceStep): void {
    updateDraft((nextDraft) => {
      const action = nextDraft.buttons[selectedButtonIndex]?.actions[selectedActionIndex];
      if (!action) {
        return;
      }
      const currentStep = action.sequence[selectedStepIndex];
      if (!currentStep) {
        return;
      }
      action.sequence[selectedStepIndex] = mutator(currentStep);
    });
  }

  function replaceSelectedSequence(sequence: SequenceStep[], nextSelectedIndex?: number): void {
    updateDraft((nextDraft) => {
      const action = nextDraft.buttons[selectedButtonIndex]?.actions[selectedActionIndex];
      if (!action) {
        return;
      }
      action.sequence = sequence.map((step) => cloneStep(step));
    });
    const resolvedIndex =
      sequence.length === 0
        ? 0
        : Math.max(0, Math.min(nextSelectedIndex ?? selectedStepIndex, sequence.length - 1));
    setSelectedStepIndex(resolvedIndex);
  }

  function replaceSelectedStep(step: SequenceStep): void {
    updateSelectedStep(() => cloneStep(step));
  }

  function updateVirtualAction(
    pressCount: number,
    next: Partial<{ title: string; mode: string; sequence: SequenceStep[] }>
  ): void {
    updateDraft((nextDraft) => {
      const button = nextDraft.buttons[selectedButtonIndex];
      if (!button) {
        return;
      }
      let virtual = button.virtualActions.find((entry) => entry.pressCount === pressCount);
      if (!virtual) {
        virtual = {
          title: `press ${pressCount}x`,
          pressCount,
          mode: "single",
          sequence: []
        };
        button.virtualActions.push(virtual);
        button.virtualActions.sort((left, right) => left.pressCount - right.pressCount);
      }
      if (next.title !== undefined) {
        virtual.title = next.title;
      }
      if (next.mode !== undefined) {
        virtual.mode = next.mode;
      }
      if (next.sequence !== undefined) {
        virtual.sequence = next.sequence;
      }
    });
  }

  function handleImportAutomation(automation: AutomationSummary): void {
    if (!draft) {
      return;
    }
    if (!automation.actions.length) {
      setNotice({
        kind: "error",
        text: `"${automation.alias}" does not expose an importable native action sequence yet.`
      });
      return;
    }
    const canImport =
      automationTarget === "virtual"
        ? Boolean(draft.buttons[selectedButtonIndex])
        : Boolean(draft.buttons[selectedButtonIndex]?.actions[selectedActionIndex]);
    if (!canImport) {
      return;
    }
    updateDraft((nextDraft) => {
      if (automationTarget === "virtual") {
        const button = nextDraft.buttons[selectedButtonIndex];
        if (!button) {
          return;
        }
        let virtual = button.virtualActions.find((entry) => entry.pressCount === selectedVirtualPressCount);
        if (!virtual) {
          virtual = {
            title: `press ${selectedVirtualPressCount}x`,
            pressCount: selectedVirtualPressCount,
            mode: automation.mode ?? "single",
            sequence: []
          };
          button.virtualActions.push(virtual);
          button.virtualActions.sort((left, right) => left.pressCount - right.pressCount);
        }
        virtual.mode = automation.mode ?? virtual.mode;
        virtual.sequence = automation.actions.map((step) => cloneStep(step));
      } else {
        const action = nextDraft.buttons[selectedButtonIndex]?.actions[selectedActionIndex];
        if (!action) {
          return;
        }
        action.mode = automation.mode ?? action.mode;
        action.sequence = automation.actions.map((step) => cloneStep(step));
      }
    });
    setNotice({
      kind: "success",
      text: `Imported ${automation.alias} into ${
        automationTarget === "virtual" ? `press ${selectedVirtualPressCount}x` : "the selected action"
      }.`
    });
  }

  return {
    selectedConfigId,
    draft,
    dirty,
    selectedButtonIndex,
    selectedActionIndex,
    selectedStepIndex,
    selectedVirtualPressCount,
    automationTarget,
    selectedStoredConfig,
    selectedBlueprint,
    selectedAreaId,
    blueprintsById,
    devicesById,
    entitiesById,
    selectConfig,
    updateDraft,
    updateSelectedStep,
    replaceSelectedSequence,
    replaceSelectedStep,
    updateVirtualAction,
    handleImportAutomation,
    setDraft: setDraftAndDirty,
    setSelectedConfigId,
    setSelectedButtonIndex,
    setSelectedActionIndex,
    setSelectedStepIndex,
    setSelectedVirtualPressCount,
    setAutomationTarget,
    resetDraftSelections,
    applySnapshot
  };
}
