import { useState } from "react";

import {
  deleteConfig,
  exportAutomation,
  exportBlueprintPackage,
  fetchAutomations,
  saveConfig,
  setConfigEnabled
} from "../api";
import type {
  AutomationSummary,
  SwitchManagerConfig
} from "../../shared/types";
import { cloneConfig } from "../helpers";

type AutomationTarget = "native" | "virtual";
type NoticeState = { kind: "error" | "success"; text: string };

export interface ConfigPersistenceState {
  saving: boolean;
  exportingPackage: boolean;
}

export interface ConfigPersistenceActions {
  handleSave(): Promise<void>;
  handleDelete(): Promise<void>;
  handleEnabledToggle(nextEnabled: boolean): Promise<void>;
  handleExportCurrent(): Promise<void>;
  handleExportPackage(): Promise<void>;
}

export type ConfigPersistence = ConfigPersistenceState & ConfigPersistenceActions;

export function useConfigPersistence(deps: {
  draft: SwitchManagerConfig | null;
  selectedStoredConfig: SwitchManagerConfig | null;
  selectedButtonIndex: number;
  selectedActionIndex: number;
  selectedVirtualPressCount: number;
  automationTarget: AutomationTarget;
  selectConfig: (config: SwitchManagerConfig) => void;
  updateDraft: (mutator: (config: SwitchManagerConfig) => void) => void;
  setDraft: React.Dispatch<React.SetStateAction<SwitchManagerConfig | null>>;
  setSelectedConfigId: React.Dispatch<React.SetStateAction<string>>;
  setAutomations: React.Dispatch<React.SetStateAction<AutomationSummary[]>>;
  loadStudio: (preferredConfigId?: string, options?: { blocking?: boolean }) => Promise<boolean>;
  setNotice: (notice: NoticeState | null) => void;
  showActionError: (error: unknown) => void;
}): ConfigPersistence {
  const {
    draft,
    selectedStoredConfig,
    selectedButtonIndex,
    selectedActionIndex,
    selectedVirtualPressCount,
    automationTarget,
    selectConfig,
    updateDraft,
    setDraft,
    setSelectedConfigId,
    setAutomations,
    loadStudio,
    setNotice,
    showActionError
  } = deps;

  const [saving, setSaving] = useState(false);
  const [exportingPackage, setExportingPackage] = useState(false);

  async function handleSave(): Promise<void> {
    if (!draft) {
      return;
    }
    setSaving(true);
    setNotice(null);
    try {
      const { config: saved, warning } = await saveConfig(draft);
      const reloaded = await loadStudio(saved.id, { blocking: false });
      setNotice({
        kind: warning ? "error" : reloaded ? "success" : "error",
        text: warning
          ? warning
          : reloaded
            ? "Configuration saved to Home Assistant."
            : "Configuration saved, but the studio refresh failed."
      });
    } catch (error) {
      showActionError(error);
    } finally {
      setSaving(false);
    }
  }

  async function handleEnabledToggle(nextEnabled: boolean): Promise<void> {
    if (!draft || !draft.id) {
      updateDraft((nextDraft) => {
        nextDraft.enabled = nextEnabled;
      });
      return;
    }
    updateDraft((nextDraft) => {
      nextDraft.enabled = nextEnabled;
    });
    try {
      await setConfigEnabled(draft.id, nextEnabled);
      const reloaded = await loadStudio(draft.id, { blocking: false });
      setNotice({
        kind: reloaded ? "success" : "error",
        text: reloaded
          ? nextEnabled
            ? "Switch enabled."
            : "Switch disabled."
          : "The switch state changed, but the studio refresh failed."
      });
    } catch (error) {
      updateDraft((nextDraft) => {
        nextDraft.enabled = !nextEnabled;
      });
      showActionError(error);
    }
  }

  async function handleDelete(): Promise<void> {
    if (!draft) {
      return;
    }
    if (!draft.id) {
      setDraft(selectedStoredConfig ? cloneConfig(selectedStoredConfig) : null);
      setSelectedConfigId(selectedStoredConfig?.id ?? "");
      return;
    }
    if (!window.confirm(`Delete "${draft.name}"?`)) {
      return;
    }
    try {
      await deleteConfig(draft.id);
      const reloaded = await loadStudio(undefined, { blocking: false });
      setNotice({
        kind: reloaded ? "success" : "error",
        text: reloaded ? "Configuration deleted." : "Configuration deleted, but the studio refresh failed."
      });
    } catch (error) {
      showActionError(error);
    }
  }

  async function handleExportCurrent(): Promise<void> {
    if (!draft?.id) {
      setNotice({
        kind: "error",
        text: "Save the config before exporting it to Home Assistant automations."
      });
      return;
    }

    try {
      if (automationTarget === "virtual") {
        await exportAutomation({
          configId: draft.id,
          buttonIndex: selectedButtonIndex,
          actionIndex: 0,
          pressCount: selectedVirtualPressCount,
          virtual: true
        });
      } else {
        await exportAutomation({
          configId: draft.id,
          buttonIndex: selectedButtonIndex,
          actionIndex: selectedActionIndex,
          virtual: false
        });
      }
      setNotice({ kind: "success", text: "Exported the current slot to Home Assistant automations." });
    } catch (error) {
      showActionError(error);
      return;
    }
    try {
      setAutomations(await fetchAutomations());
    } catch {
      // Automations refresh after export is non-fatal; cached list stays.
    }
  }

  async function handleExportPackage(): Promise<void> {
    if (!draft) {
      return;
    }

    try {
      setExportingPackage(true);
      const fileName = await exportBlueprintPackage(draft);
      setNotice({ kind: "success", text: `Downloaded ${fileName}.` });
    } catch (error) {
      showActionError(error);
    } finally {
      setExportingPackage(false);
    }
  }

  return {
    saving,
    exportingPackage,
    handleSave,
    handleDelete,
    handleEnabledToggle,
    handleExportCurrent,
    handleExportPackage
  };
}
