import { lazy, startTransition, Suspense, useDeferredValue, useEffect, useState } from "react";

import { isAuthError } from "./api";
import { AuthPanel } from "./components/AuthPanel";
import { AutomationPanel } from "./components/AutomationPanel";
import { BlueprintPanel } from "./components/BlueprintPanel";
import { SensorPanel } from "./components/SensorPanel";
import { ConfigRail } from "./components/ConfigRail";
import { DiscoveryPanel } from "./components/DiscoveryPanel";
import { LearnPanel } from "./components/LearnPanel";
import { PropertyPanel } from "./components/PropertyPanel";
import { SequenceEditor } from "./components/SequenceEditor";
import { VirtualActionEditor } from "./components/VirtualActionEditor";
import {
  createDraftFromBlueprint,
  createDraftFromDiscovery,
  ensureLayoutMetadata,
  ensureSwitchMetadata,
  matchesSearch,
  type NoticeState,
  type WorkspaceMode
} from "./helpers";
import { errorMessage } from "../shared/types";
import { clamp } from "../shared/utils";
import { useAuthSession } from "./hooks/useAuthSession";
import { useStudioData } from "./hooks/useStudioData";
import { useDraftConfig } from "./hooks/useDraftConfig";
import { useConfigPersistence } from "./hooks/useConfigPersistence";
import { useLearningSession } from "./hooks/useLearningSession";

const LazyMmwaveWorkspace = lazy(() => import("./components/mmwave/MmwaveWorkspace"));

const WORKSPACE_OPTIONS: Array<{
  description: string;
  id: WorkspaceMode;
  label: string;
  requiresDraft: boolean;
}> = [
  {
    id: "editor",
    label: "Editor",
    description: "Core switch config, rooms, layout, and native actions.",
    requiresDraft: false
  },
  {
    id: "virtual",
    label: "Virtual Press",
    description: "Configure multi-press actions for the selected switch button.",
    requiresDraft: true
  },
  {
    id: "teach",
    label: "Teach",
    description: "Capture switch presses to identify buttons and events.",
    requiresDraft: true
  },
  {
    id: "automations",
    label: "Automations",
    description: "Import and export Home Assistant automations for the active switch.",
    requiresDraft: true
  },
  {
    id: "discovery",
    label: "Discovery",
    description: "Scan for unmapped devices and create new switch configs.",
    requiresDraft: false
  },
  {
    id: "mmwave",
    label: "mmWave",
    description: "Program motion zones for Inovelli VZM32-SN mmWave switches.",
    requiresDraft: false
  }
];

export function App() {
  const [notice, setNotice] = useState<NoticeState | null>(null);
  const [loading, setLoading] = useState(true);
  const [blockingError, setBlockingError] = useState<string | null>(null);
  const [configSearch, setConfigSearch] = useState("");
  const [activeWorkspace, setActiveWorkspace] = useState<WorkspaceMode>("editor");

  const deferredConfigSearch = useDeferredValue(configSearch);

  function showActionError(error: unknown): void {
    if (isAuthError(error)) {
      return;
    }
    setNotice({
      kind: "error",
      text: errorMessage(error)
    });
  }

  function resetStudioState(): void {
    startTransition(() => {
      setActiveWorkspace("editor");
      setConfigSearch("");
      setNotice(null);
    });
  }

  /** Shared by onUseBlueprint / onUseCandidate — sets draft, switches to editor, shows notice. */
  function applyNewDraft(config: import("../shared/types").SwitchManagerConfig, message: string): void {
    draft.setSelectedConfigId("");
    draft.setDraft(config);
    draft.resetDraftSelections();
    setActiveWorkspace("editor");
    setNotice({ kind: "success", text: message });
  }

  // --- Draft config (needs snapshot from studio, but studio needs draft callbacks) ---
  // We break the circular dependency by using a ref-style pattern:
  // useStudioData receives an onSnapshotLoaded callback that calls into draft.applySnapshot.
  // useDraftConfig is created first with the current snapshot from studio.

  const studio = useStudioData({
    setAuthStatus: (updater) => auth.setAuthStatus(updater),
    setLoading,
    setBlockingError,
    showActionError,
    setNotice,
    onSnapshotLoaded: (nextSnapshot, preferredConfigId) => {
      draft.applySnapshot(nextSnapshot, preferredConfigId);
    }
  });

  const draft = useDraftConfig({
    snapshot: studio.snapshot,
    setNotice,
    setProperties: studio.setProperties,
    setActiveWorkspace
  });

  const auth = useAuthSession({
    loadStudio: studio.loadStudio,
    resetStudioState: () => {
      resetStudioState();
      draft.setSelectedConfigId("");
      draft.setDraft(null);
      draft.resetDraftSelections();
    },
    setLoading,
    setBlockingError
  });

  const persistence = useConfigPersistence({
    draft: draft.draft,
    selectedStoredConfig: draft.selectedStoredConfig,
    selectedButtonIndex: draft.selectedButtonIndex,
    selectedActionIndex: draft.selectedActionIndex,
    selectedVirtualPressCount: draft.selectedVirtualPressCount,
    automationTarget: draft.automationTarget,
    selectConfig: draft.selectConfig,
    updateDraft: draft.updateDraft,
    setDraft: draft.setDraft,
    setSelectedConfigId: draft.setSelectedConfigId,
    setAutomations: studio.setAutomations,
    loadStudio: studio.loadStudio,
    resetDraftSelections: draft.resetDraftSelections,
    setNotice,
    showActionError
  });

  const learn = useLearningSession({
    draft: draft.draft,
    selectedBlueprint: draft.selectedBlueprint,
    refreshLearning: studio.refreshLearning,
    setNotice,
    showActionError
  });

  // --- Effects that stay in App (cross-hook coordination) ---

  // Initial auth check
  useEffect(() => {
    void auth.loadAuthState();
  }, []);

  // Guard workspace that requires a draft
  useEffect(() => {
    if ((activeWorkspace === "virtual" || activeWorkspace === "teach" || activeWorkspace === "automations") && (!draft.draft || !draft.selectedBlueprint)) {
      setActiveWorkspace("editor");
    }
  }, [activeWorkspace, draft.draft, draft.selectedBlueprint]);

  // Auto-dismiss success notices
  useEffect(() => {
    if (!notice || notice.kind !== "success") {
      return;
    }
    const timer = window.setTimeout(() => setNotice(null), 3000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  // Ctrl+S keyboard shortcut
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent): void {
      if ((event.ctrlKey || event.metaKey) && event.key === "s") {
        event.preventDefault();
        if (draft.draft && draft.dirty && !persistence.saving) {
          void persistence.handleSave();
        }
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [draft.draft, draft.dirty, persistence.saving]);

  // --- Workspace helpers ---

  function handleWorkspaceChange(workspace: WorkspaceMode): void {
    setActiveWorkspace(workspace);
    if (workspace === "editor") {
      draft.setAutomationTarget("native");
    } else if (workspace === "virtual") {
      draft.setAutomationTarget("virtual");
    }
  }

  // --- Derived values ---

  const filteredConfigs = studio.snapshot?.configs.filter((config) => {
    const search = deferredConfigSearch.trim().toLowerCase();
    if (!search) {
      return true;
    }
    const blueprintName = draft.blueprintsById.get(config.blueprintId)?.name ?? config.blueprintId;
    return [config.name, config.identifier, blueprintName].some((value) => matchesSearch(value, search));
  }) ?? [];

  const importTargetLabel =
    draft.automationTarget === "virtual"
      ? `Button ${draft.selectedButtonIndex + 1} — ${draft.selectedVirtualPressCount}x press`
      : `Button ${draft.selectedButtonIndex + 1} — action ${draft.selectedActionIndex + 1}`;

  const activeWorkspaceOption = WORKSPACE_OPTIONS.find((option) => option.id === activeWorkspace);

  // --- Early returns for auth states ---

  if (auth.authChecking && auth.authStatus === null) {
    return (
      <div className="studio-auth-shell">
        <section className="panel loading-panel">Checking saved Home Assistant session...</section>
      </div>
    );
  }

  if (!auth.authenticated) {
    return (
      <AuthPanel
        blocking
        busy={auth.authBusy}
        error={auth.authError ?? blockingError}
        onSubmit={(credentials) => void auth.handleAuthSubmit(credentials)}
        open
        status={auth.authStatus}
      />
    );
  }

  function renderBlueprintPanel(
    onSelectButton: (index: number) => void
  ) {
    if (!draft.draft || !draft.selectedBlueprint) {
      return null;
    }

    if (draft.selectedBlueprint.blueprintType === "sensor") {
      return (
        <SensorPanel
          areas={studio.snapshot?.areas ?? []}
          draft={draft.draft}
          onAreaChange={(areaId) =>
            draft.updateDraft((nextDraft) => {
              const metadata = ensureSwitchMetadata(nextDraft);
              metadata.areaManaged = true;
              metadata.areaId = areaId;
            })
          }
          onDelete={() => void persistence.handleDelete()}
          onEnabledToggle={(enabled) => void persistence.handleEnabledToggle(enabled)}
          onIdentifierChange={(value) => draft.updateDraft((nextDraft) => void (nextDraft.identifier = value))}
          onNameChange={(value) => draft.updateDraft((nextDraft) => void (nextDraft.name = value))}
          onSelectTrigger={onSelectButton}
          selectedAreaId={draft.selectedAreaId}
          selectedBlueprint={draft.selectedBlueprint}
          selectedButtonIndex={draft.selectedButtonIndex}
        />
      );
    }

    return (
      <BlueprintPanel
        areas={studio.snapshot?.areas ?? []}
        draft={draft.draft}
        exportingPackage={persistence.exportingPackage}
        onAreaChange={(areaId) =>
          draft.updateDraft((nextDraft) => {
            const metadata = ensureSwitchMetadata(nextDraft);
            metadata.areaManaged = true;
            metadata.areaId = areaId;
          })
        }
        onButtonLayoutChange={(index, override) =>
          draft.updateDraft((nextDraft) => {
            const layout = ensureLayoutMetadata(nextDraft, draft.selectedBlueprint!.buttons.length);
            layout.buttonOverrides[index] = override;
          })
        }
        onDelete={() => void persistence.handleDelete()}
        onEnabledToggle={(enabled) => void persistence.handleEnabledToggle(enabled)}
        onExportPackage={() => void persistence.handleExportPackage()}
        onGridChange={(grid) =>
          draft.updateDraft((nextDraft) => {
            const layout = ensureLayoutMetadata(nextDraft, draft.selectedBlueprint!.buttons.length);
            layout.grid = {
              ...layout.grid,
              ...grid
            };
          })
        }
        onIdentifierChange={(value) => draft.updateDraft((nextDraft) => void (nextDraft.identifier = value))}
        onNameChange={(value) => draft.updateDraft((nextDraft) => void (nextDraft.name = value))}
        onNotify={setNotice}
        onResetToSaved={draft.selectedStoredConfig ? () => draft.selectConfig(draft.selectedStoredConfig!) : null}
        onRotateChange={(value) => draft.updateDraft((nextDraft) => void (nextDraft.rotate = value))}
        onSelectButton={onSelectButton}
        selectedAreaId={draft.selectedAreaId}
        selectedBlueprint={draft.selectedBlueprint}
        selectedButtonIndex={draft.selectedButtonIndex}
      />
    );
  }

  return (
    <div className="studio-shell">
      <ConfigRail
        activeWorkspace={activeWorkspace}
        authBusy={auth.authBusy}
        authStatus={auth.authStatus}
        blueprintsById={draft.blueprintsById}
        configSearch={configSearch}
        configs={filteredConfigs}
        health={studio.health}
        onConfigSearchChange={setConfigSearch}
        onOpenAuth={() => auth.openAuthDialog()}
        onOpenDiscovery={() => handleWorkspaceChange("discovery")}
        onSelectConfig={draft.selectConfig}
        onSignOut={() => void auth.handleSignOut()}
        selectedConfigId={draft.selectedConfigId}
        snapshot={studio.snapshot}
      />

      <main className="studio-main">
        <header className="hero-panel">
          <div>
            <p className="eyebrow">Home Assistant</p>
            <h2>{draft.draft?.name ?? "No switch selected"}</h2>
            <p className="hero-panel__sub">
              {draft.selectedBlueprint
                ? `${draft.selectedBlueprint.name} / ${draft.selectedBlueprint.service} / ${draft.selectedBlueprint.isMqtt ? "MQTT" : draft.selectedBlueprint.eventType}`
                : "Select a Switch Manager config from the rail or create one from discovery."}
            </p>
          </div>

          <div className="hero-panel__actions">
            {draft.draft?.deviceId ? (
              <button className="button" onClick={() => void studio.openPropertyDrawer(draft.draft!.deviceId!)} type="button">
                Properties
              </button>
            ) : null}
            <button
              className="button"
              disabled={!draft.draft}
              onClick={() => {
                if (draft.dirty && !window.confirm("Discard unsaved changes?")) {
                  return;
                }
                draft.selectedStoredConfig ? draft.selectConfig(draft.selectedStoredConfig) : draft.setDraft(null);
              }}
              type="button"
            >
              Discard
            </button>
            <button
              className="button button--primary"
              disabled={!draft.draft || !draft.dirty || persistence.saving}
              onClick={() => void persistence.handleSave()}
              type="button"
            >
              {persistence.saving ? "Saving..." : draft.dirty ? "Save to HA" : "Saved"}
            </button>
          </div>
        </header>

        {loading ? <section className="panel loading-panel">Loading studio snapshot...</section> : null}
        {blockingError ? (
          <section className="panel error-panel">
            <span>{blockingError}</span>
          </section>
        ) : null}
        {notice ? (
          <section className={`panel ${notice.kind === "error" ? "error-panel" : "notice-panel"}`}>
            <span>{notice.text}</span>
            <button
              aria-label="Dismiss"
              className="notice-dismiss"
              onClick={() => setNotice(null)}
              type="button"
            >
              ×
            </button>
          </section>
        ) : null}

        <section className="panel workspace-switcher">
          <div className="workspace-switcher__header">
            <div>
              <p className="eyebrow">Workspace</p>
              <h3>{activeWorkspaceOption?.label}</h3>
            </div>
            {activeWorkspace !== "editor" ? (
              <button className="button button--ghost" onClick={() => handleWorkspaceChange("editor")} type="button">
                Back to editor
              </button>
            ) : null}
          </div>

          <div className="workspace-switcher__grid">
            {WORKSPACE_OPTIONS.filter(
              (option) =>
                !(option.id === "virtual" && draft.selectedBlueprint?.blueprintType === "sensor") &&
                !(option.id === "mmwave" && !studio.health?.mmwaveConfigured)
            ).map((option) => {
              const disabled = option.requiresDraft && (!draft.draft || !draft.selectedBlueprint);
              return (
                <button
                  className={`workspace-switcher__button ${
                    option.id === activeWorkspace ? "workspace-switcher__button--active" : ""
                  }`}
                  disabled={disabled}
                  key={option.id}
                  onClick={() => handleWorkspaceChange(option.id)}
                  type="button"
                >
                  <strong>{option.label}</strong>
                  <span>{option.description}</span>
                </button>
              );
            })}
          </div>
        </section>

        {!loading && !blockingError ? (
          <>
            {activeWorkspace === "editor" ? (
              <div className="workspace-grid">
                {draft.draft && draft.selectedBlueprint ? (
                  <>
                    {renderBlueprintPanel((index) => {
                      draft.setSelectedButtonIndex(index);
                      draft.setSelectedActionIndex(0);
                      draft.setSelectedStepIndex(0);
                      draft.setSelectedVirtualPressCount(2);
                      draft.setAutomationTarget("native");
                    })}

                    <SequenceEditor
                      devicesById={draft.devicesById}
                      draft={draft.draft}
                      entitiesById={draft.entitiesById}
                      onActionModeChange={(mode) =>
                        draft.updateDraft((nextDraft) => {
                          const action = nextDraft.buttons[draft.selectedButtonIndex]?.actions[draft.selectedActionIndex];
                          if (action) {
                            action.mode = mode;
                          }
                        })
                      }
                      onReplaceSelectedStep={draft.replaceSelectedStep}
                      onReplaceSequence={draft.replaceSelectedSequence}
                      onSelectAction={(index) => {
                        draft.setSelectedActionIndex(index);
                        draft.setSelectedStepIndex(0);
                        draft.setAutomationTarget("native");
                      }}
                      onSelectStep={draft.setSelectedStepIndex}
                      selectedActionIndex={draft.selectedActionIndex}
                      selectedBlueprint={draft.selectedBlueprint}
                      selectedButtonIndex={draft.selectedButtonIndex}
                      selectedStepIndex={draft.selectedStepIndex}
                      snapshot={studio.snapshot}
                    />
                  </>
                ) : (
                  <section className="panel empty-state">
                    Select an existing switch or create a new draft from discovery.
                  </section>
                )}
              </div>
            ) : null}

            {activeWorkspace === "virtual" ? (
              <div className="workspace-grid">
                {draft.draft && draft.selectedBlueprint ? (
                  <>
                    {renderBlueprintPanel((index) => {
                      draft.setSelectedButtonIndex(index);
                      draft.setSelectedStepIndex(0);
                      draft.setSelectedVirtualPressCount(2);
                      draft.setAutomationTarget("virtual");
                    })}

                    <VirtualActionEditor
                      devicesById={draft.devicesById}
                      draft={draft.draft}
                      entitiesById={draft.entitiesById}
                      onSelectPressCount={(pressCount) => {
                        draft.setSelectedVirtualPressCount(pressCount);
                        draft.setAutomationTarget("virtual");
                      }}
                      onVirtualActionChange={draft.updateVirtualAction}
                      onVirtualMultiPressEnabledChange={(enabled) =>
                        draft.updateDraft((nextDraft) => {
                          nextDraft.virtualMultiPress.enabled = enabled;
                        })
                      }
                      onVirtualMultiPressMaxPressesChange={(value) =>
                        draft.updateDraft((nextDraft) => {
                          nextDraft.virtualMultiPress.maxPresses = clamp(value, 2, 10);
                          nextDraft.buttons.forEach((button) => {
                            button.virtualActions = button.virtualActions.filter(
                              (entry) => entry.pressCount <= nextDraft.virtualMultiPress.maxPresses
                            );
                          });
                          draft.setSelectedVirtualPressCount((current) =>
                            Math.min(current, clamp(value, 2, 10))
                          );
                        })
                      }
                      onVirtualMultiPressWindowChange={(value) =>
                        draft.updateDraft((nextDraft) => {
                          nextDraft.virtualMultiPress.pressWindowMs = clamp(value, 150, 3000);
                        })
                      }
                      selectedBlueprint={draft.selectedBlueprint}
                      selectedButtonIndex={draft.selectedButtonIndex}
                      selectedPressCount={draft.selectedVirtualPressCount}
                      snapshot={studio.snapshot}
                    />
                  </>
                ) : (
                  <section className="panel empty-state">
                    Select a switch first, then open Virtual Press to configure synthetic multi-press actions.
                  </section>
                )}
              </div>
            ) : null}

            {activeWorkspace === "teach" ? (
              <LearnPanel
                draft={draft.draft}
                learning={studio.learning}
                onApplyIdentifier={(identifier) =>
                  draft.updateDraft((nextDraft) => {
                    nextDraft.identifier = identifier;
                  })
                }
                onClear={() => void learn.handleClearLearning()}
                onStart={() => void learn.handleStartLearning()}
                onStop={() => void learn.handleStopLearning()}
                selectedBlueprint={draft.selectedBlueprint}
              />
            ) : null}

            {activeWorkspace === "automations" ? (
              <AutomationPanel
                automations={studio.automations}
                draft={draft.draft}
                filterConfigId={draft.draft?.id ?? null}
                importTargetLabel={importTargetLabel}
                onExportCurrent={() => void persistence.handleExportCurrent()}
                onImportAutomation={draft.handleImportAutomation}
              />
            ) : null}

            {activeWorkspace === "discovery" ? (
              <DiscoveryPanel
                blueprintsById={draft.blueprintsById}
                candidates={studio.discovery}
                onUseBlueprint={(blueprintId) => {
                  const blueprint = draft.blueprintsById.get(blueprintId);
                  if (!blueprint) return;
                  applyNewDraft(createDraftFromBlueprint(blueprint), `Created a base config from ${blueprint.name}.`);
                }}
                onUseCandidate={(candidate, blueprintId) => {
                  const blueprint = draft.blueprintsById.get(blueprintId);
                  if (!blueprint) return;
                  applyNewDraft(createDraftFromDiscovery(candidate, blueprint), `Created a draft for ${candidate.name}.`);
                }}
              />
            ) : null}

            {activeWorkspace === "mmwave" ? (
              <Suspense fallback={<section className="panel loading-panel">Loading mmWave Studio...</section>}>
                <LazyMmwaveWorkspace />
              </Suspense>
            ) : null}
          </>
        ) : null}
      </main>

      <PropertyPanel
        onClose={() => studio.closePropertyDrawer()}
        onControl={(entityId, action, value) => void studio.handlePropertyControl(entityId, action, value, draft.draft?.deviceId)}
        open={studio.propertyDrawerOpen}
        properties={studio.properties}
      />

      <AuthPanel
        busy={auth.authBusy}
        error={auth.authError}
        onClose={auth.closeAuthDialog}
        onSubmit={(credentials) => void auth.handleAuthSubmit(credentials)}
        open={auth.authDialogOpen}
        status={auth.authStatus}
      />
    </div>
  );
}
