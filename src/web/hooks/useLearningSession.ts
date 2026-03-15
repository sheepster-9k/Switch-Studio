import {
  clearLearningLibrary,
  startLearningSession,
  stopLearningSession
} from "../api";
import type { SwitchManagerBlueprint, SwitchManagerConfig } from "../../shared/types";

export interface LearningSessionActions {
  handleStartLearning(): Promise<void>;
  handleStopLearning(): Promise<void>;
  handleClearLearning(): Promise<void>;
}

export function useLearningSession(deps: {
  draft: SwitchManagerConfig | null;
  selectedBlueprint: SwitchManagerBlueprint | null;
  refreshLearning: () => Promise<void>;
  setNotice: (notice: { kind: "error" | "success"; text: string } | null) => void;
  showActionError: (error: unknown) => void;
}): LearningSessionActions {
  const { draft, selectedBlueprint, refreshLearning, setNotice, showActionError } = deps;

  async function handleStartLearning(): Promise<void> {
    if (!draft || !selectedBlueprint) {
      return;
    }
    try {
      await startLearningSession({
        ...(draft.id ? { configId: draft.id } : {}),
        blueprintId: selectedBlueprint.id,
        ...(draft.identifier ? { identifier: draft.identifier } : {}),
        label: draft.name
      });
      await refreshLearning();
      setNotice({ kind: "success", text: "Learn session started." });
    } catch (error) {
      showActionError(error);
    }
  }

  async function handleStopLearning(): Promise<void> {
    try {
      await stopLearningSession();
      await refreshLearning();
      setNotice({ kind: "success", text: "Learn session stopped." });
    } catch (error) {
      showActionError(error);
    }
  }

  async function handleClearLearning(): Promise<void> {
    try {
      await clearLearningLibrary();
      await refreshLearning();
      setNotice({ kind: "success", text: "Learned events cleared." });
    } catch (error) {
      showActionError(error);
    }
  }

  return {
    handleStartLearning,
    handleStopLearning,
    handleClearLearning
  };
}
