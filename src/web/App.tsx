import { startTransition, useDeferredValue, useEffect, useState } from "react";

import {
  clearLearningLibrary,
  controlEntity,
  deleteConfig,
  exportAutomation,
  exportBlueprintPackage,
  fetchAutomations,
  fetchDeviceProperties,
  fetchDiscovery,
  fetchHealth,
  fetchLearning,
  fetchSnapshot,
  saveConfig,
  setConfigEnabled,
  startLearningSession,
  stopLearningSession
} from "./api";
import { AutomationPanel } from "./components/AutomationPanel";
import { BlueprintPanel } from "./components/BlueprintPanel";
import { ConfigRail } from "./components/ConfigRail";
import { DiscoveryPanel } from "./components/DiscoveryPanel";
import { LearnPanel } from "./components/LearnPanel";
import { PropertyPanel } from "./components/PropertyPanel";
import { SequenceEditor } from "./components/SequenceEditor";
import { VirtualActionEditor } from "./components/VirtualActionEditor";
import {
  cloneConfig,
  cloneStep,
  createDraftFromDiscovery,
  ensureLayoutMetadata,
  ensureSwitchMetadata,
  matchesSearch,
  resolvedConfigAreaId
} from "./helpers";
import type {
  AutomationSummary,
  DevicePropertiesResponse,
  DiscoveryCandidate,
  HealthResponse,
  LearningLibraryResponse,
  SequenceStep,
  StudioSnapshot,
  SwitchManagerConfig
} from "../shared/types";

type AutomationTarget = "native" | "virtual";
type WorkspaceMode = "editor" | "virtual" | "teach" | "automations" | "discovery";

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
    description: "Synthetic multi-press setup for the selected switch button.",
    requiresDraft: true
  },
  {
    id: "teach",
    label: "Teach",
    description: "Capture switch presses and build the learn library.",
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
    description: "Scan and draft new switches without crowding the editor.",
    requiresDraft: false
  }
];

export function App() {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [snapshot, setSnapshot] = useState<StudioSnapshot | null>(null);
  const [discovery, setDiscovery] = useState<DiscoveryCandidate[]>([]);
  const [automations, setAutomations] = useState<AutomationSummary[]>([]);
  const [learning, setLearning] = useState<LearningLibraryResponse | null>(null);
  const [properties, setProperties] = useState<DevicePropertiesResponse | null>(null);
  const [propertyDrawerOpen, setPropertyDrawerOpen] = useState(false);
  const [selectedConfigId, setSelectedConfigId] = useState("");
  const [draft, setDraft] = useState<SwitchManagerConfig | null>(null);
  const [selectedButtonIndex, setSelectedButtonIndex] = useState(0);
  const [selectedActionIndex, setSelectedActionIndex] = useState(0);
  const [selectedStepIndex, setSelectedStepIndex] = useState(0);
  const [selectedVirtualPressCount, setSelectedVirtualPressCount] = useState(2);
  const [automationTarget, setAutomationTarget] = useState<AutomationTarget>("native");
  const [configSearch, setConfigSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [exportingPackage, setExportingPackage] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [fatalError, setFatalError] = useState<string | null>(null);
  const [activeWorkspace, setActiveWorkspace] = useState<WorkspaceMode>("editor");

  const deferredConfigSearch = useDeferredValue(configSearch);

  const blueprintsById = new Map(snapshot?.blueprints.map((blueprint) => [blueprint.id, blueprint]) ?? []);
  const devicesById = new Map(snapshot?.devices.map((device) => [device.id, device]) ?? []);
  const entitiesById = new Map(snapshot?.entities.map((entity) => [entity.entityId, entity]) ?? []);
  const selectedStoredConfig = snapshot?.configs.find((config) => config.id === selectedConfigId) ?? null;
  const selectedBlueprint = draft ? blueprintsById.get(draft.blueprintId) ?? null : null;
  const selectedAreaId = draft ? resolvedConfigAreaId(draft, devicesById, entitiesById) : null;
  const dirty = Boolean(
    draft &&
      (!selectedStoredConfig || JSON.stringify(draft) !== JSON.stringify(selectedStoredConfig))
  );

  useEffect(() => {
    void loadStudio();
  }, []);

  useEffect(() => {
    if (!learning?.activeSession?.active) {
      return;
    }
    const timer = window.setInterval(() => {
      void refreshLearning();
    }, 3000);
    return () => window.clearInterval(timer);
  }, [learning?.activeSession?.active]);

  useEffect(() => {
    if ((activeWorkspace === "virtual" || activeWorkspace === "teach" || activeWorkspace === "automations") && (!draft || !selectedBlueprint)) {
      setActiveWorkspace("editor");
    }
  }, [activeWorkspace, draft, selectedBlueprint]);

  async function loadStudio(preferredConfigId?: string): Promise<void> {
    setLoading(true);
    setFatalError(null);
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
        setSnapshot(nextSnapshot);
        setDiscovery(discoveryResult);
        setAutomations(automationsResult);
        setLearning(learningResult);
        const fallbackId = nextSnapshot.configs[0]?.id ?? "";
        const nextId =
          preferredConfigId && nextSnapshot.configs.some((config) => config.id === preferredConfigId)
            ? preferredConfigId
            : fallbackId;
        setSelectedConfigId(nextId);
        const nextConfig = nextSnapshot.configs.find((config) => config.id === nextId) ?? null;
        setDraft(nextConfig ? cloneConfig(nextConfig) : null);
        setSelectedButtonIndex(0);
        setSelectedActionIndex(0);
        setSelectedStepIndex(0);
        setSelectedVirtualPressCount(2);
      });
    } catch (error) {
      setFatalError(error instanceof Error ? error.message : String(error));
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

  function selectConfig(config: SwitchManagerConfig): void {
    setSelectedConfigId(config.id);
    setDraft(cloneConfig(config));
    setSelectedButtonIndex(0);
    setSelectedActionIndex(0);
    setSelectedStepIndex(0);
    setSelectedVirtualPressCount(2);
    setAutomationTarget("native");
    setProperties(null);
    setMessage(null);
  }

  function handleWorkspaceChange(workspace: WorkspaceMode): void {
    setActiveWorkspace(workspace);
    if (workspace === "editor") {
      setAutomationTarget("native");
    } else if (workspace === "virtual") {
      setAutomationTarget("virtual");
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

  async function handleSave(): Promise<void> {
    if (!draft) {
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      const saved = await saveConfig(draft);
      await loadStudio(saved.id);
      setMessage("Configuration saved to Home Assistant.");
    } catch (error) {
      setFatalError(error instanceof Error ? error.message : String(error));
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
      await loadStudio(draft.id);
      setMessage(nextEnabled ? "Switch enabled." : "Switch disabled.");
    } catch (error) {
      setFatalError(error instanceof Error ? error.message : String(error));
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
      await loadStudio();
      setMessage("Configuration deleted.");
    } catch (error) {
      setFatalError(error instanceof Error ? error.message : String(error));
    }
  }

  async function openPropertyDrawer(): Promise<void> {
    if (!draft?.deviceId) {
      return;
    }
    try {
      setProperties(await fetchDeviceProperties(draft.deviceId));
      setPropertyDrawerOpen(true);
    } catch (error) {
      setFatalError(error instanceof Error ? error.message : String(error));
    }
  }

  async function handlePropertyControl(entityId: string, action: string, value?: unknown): Promise<void> {
    try {
      await controlEntity(entityId, action, value);
      if (draft?.deviceId) {
        setProperties(await fetchDeviceProperties(draft.deviceId));
      }
      setMessage(`Updated ${entityId}.`);
    } catch (error) {
      setFatalError(error instanceof Error ? error.message : String(error));
    }
  }

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
      setMessage("Learn session started.");
    } catch (error) {
      setFatalError(error instanceof Error ? error.message : String(error));
    }
  }

  async function handleStopLearning(): Promise<void> {
    try {
      await stopLearningSession();
      await refreshLearning();
      setMessage("Learn session stopped.");
    } catch (error) {
      setFatalError(error instanceof Error ? error.message : String(error));
    }
  }

  async function handleClearLearning(): Promise<void> {
    try {
      await clearLearningLibrary();
      await refreshLearning();
      setMessage("Learned events cleared.");
    } catch (error) {
      setFatalError(error instanceof Error ? error.message : String(error));
    }
  }

  async function handleExportCurrent(): Promise<void> {
    if (!draft?.id) {
      setMessage("Save the config before exporting it to Home Assistant automations.");
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
      setAutomations(await fetchAutomations());
      setMessage("Exported the current slot to Home Assistant automations.");
    } catch (error) {
      setFatalError(error instanceof Error ? error.message : String(error));
    }
  }

  async function handleExportPackage(): Promise<void> {
    if (!draft) {
      return;
    }

    try {
      setExportingPackage(true);
      const fileName = await exportBlueprintPackage(draft);
      setMessage(`Downloaded ${fileName}.`);
    } catch (error) {
      setFatalError(error instanceof Error ? error.message : String(error));
    } finally {
      setExportingPackage(false);
    }
  }

  function handleImportAutomation(automation: AutomationSummary): void {
    if (!draft) {
      return;
    }
    if (!automation.actions.length) {
      setMessage(`"${automation.alias}" does not expose an importable native action sequence yet.`);
      return;
    }
    updateDraft((nextDraft) => {
      if (automationTarget === "virtual") {
        let virtual = nextDraft.buttons[selectedButtonIndex]?.virtualActions.find(
          (entry) => entry.pressCount === selectedVirtualPressCount
        );
        if (!virtual) {
          virtual = {
            title: `press ${selectedVirtualPressCount}x`,
            pressCount: selectedVirtualPressCount,
            mode: automation.mode ?? "single",
            sequence: []
          };
          nextDraft.buttons[selectedButtonIndex]?.virtualActions.push(virtual);
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
    setMessage(`Imported ${automation.alias} into ${automationTarget === "virtual" ? `press ${selectedVirtualPressCount}x` : "the selected action"}.`);
  }

  const filteredConfigs = snapshot?.configs.filter((config) => {
    const search = deferredConfigSearch.trim().toLowerCase();
    if (!search) {
      return true;
    }
    const blueprintName = blueprintsById.get(config.blueprintId)?.name ?? config.blueprintId;
    return [config.name, config.identifier, blueprintName].some((value) => matchesSearch(value, search));
  }) ?? [];
  const importTargetLabel =
    automationTarget === "virtual"
      ? `Button ${selectedButtonIndex + 1} synthetic press ${selectedVirtualPressCount}x`
      : `Button ${selectedButtonIndex + 1} action ${selectedActionIndex + 1}`;
  const activeWorkspaceOption = WORKSPACE_OPTIONS.find((option) => option.id === activeWorkspace) ?? WORKSPACE_OPTIONS[0];

  function renderBlueprintPanel(
    onSelectButton: (index: number) => void
  ) {
    if (!draft || !selectedBlueprint) {
      return null;
    }

    return (
      <BlueprintPanel
        areas={snapshot?.areas ?? []}
        draft={draft}
        exportingPackage={exportingPackage}
        onAreaChange={(areaId) =>
          updateDraft((nextDraft) => {
            const metadata = ensureSwitchMetadata(nextDraft);
            metadata.areaManaged = true;
            metadata.areaId = areaId;
          })
        }
        onButtonLayoutChange={(index, override) =>
          updateDraft((nextDraft) => {
            const layout = ensureLayoutMetadata(nextDraft, selectedBlueprint.buttons.length);
            layout.buttonOverrides[index] = override;
          })
        }
        onDelete={() => void handleDelete()}
        onEnabledToggle={(enabled) => void handleEnabledToggle(enabled)}
        onExportPackage={() => void handleExportPackage()}
        onGridChange={(grid) =>
          updateDraft((nextDraft) => {
            const layout = ensureLayoutMetadata(nextDraft, selectedBlueprint.buttons.length);
            layout.grid = {
              ...layout.grid,
              ...grid
            };
          })
        }
        onIdentifierChange={(value) => updateDraft((nextDraft) => void (nextDraft.identifier = value))}
        onNameChange={(value) => updateDraft((nextDraft) => void (nextDraft.name = value))}
        onNotify={setMessage}
        onRotateChange={(value) => updateDraft((nextDraft) => void (nextDraft.rotate = value))}
        onSelectButton={onSelectButton}
        selectedAreaId={selectedAreaId}
        selectedBlueprint={selectedBlueprint}
        selectedButtonIndex={selectedButtonIndex}
      />
    );
  }

  return (
    <div className="studio-shell">
      <ConfigRail
        blueprintsById={blueprintsById}
        configSearch={configSearch}
        configs={filteredConfigs}
        health={health}
        onConfigSearchChange={setConfigSearch}
        onSelectConfig={selectConfig}
        selectedConfigId={selectedConfigId}
        snapshot={snapshot}
      />

      <main className="studio-main">
        <header className="hero-panel">
          <div>
            <p className="eyebrow">Home Assistant</p>
            <h2>{draft?.name ?? "No switch selected"}</h2>
            <p className="hero-panel__sub">
              {selectedBlueprint
                ? `${selectedBlueprint.name} / ${selectedBlueprint.service} / ${selectedBlueprint.isMqtt ? "MQTT" : selectedBlueprint.eventType}`
                : "Select a Switch Manager config from the rail or create one from discovery."}
            </p>
          </div>

          <div className="hero-panel__actions">
            {draft?.deviceId ? (
              <button className="button" onClick={() => void openPropertyDrawer()} type="button">
                Properties
              </button>
            ) : null}
            <button
              className="button"
              disabled={!draft}
              onClick={() => (selectedStoredConfig ? selectConfig(selectedStoredConfig) : setDraft(null))}
              type="button"
            >
              Discard
            </button>
            <button
              className="button button--primary"
              disabled={!draft || !dirty || saving}
              onClick={() => void handleSave()}
              type="button"
            >
              {saving ? "Saving..." : dirty ? "Save to HA" : "Saved"}
            </button>
          </div>
        </header>

        {loading ? <section className="panel loading-panel">Loading studio snapshot...</section> : null}
        {fatalError ? <section className="panel error-panel">{fatalError}</section> : null}
        {message ? <section className="panel notice-panel">{message}</section> : null}

        <section className="panel workspace-switcher">
          <div className="workspace-switcher__header">
            <div>
              <p className="eyebrow">Workspace</p>
              <h3>{activeWorkspaceOption.label}</h3>
            </div>
            {activeWorkspace !== "editor" ? (
              <button className="button button--ghost" onClick={() => handleWorkspaceChange("editor")} type="button">
                Back to editor
              </button>
            ) : null}
          </div>

          <p className="panel-copy">{activeWorkspaceOption.description}</p>

          <div className="workspace-switcher__grid">
            {WORKSPACE_OPTIONS.map((option) => {
              const disabled = option.requiresDraft && (!draft || !selectedBlueprint);
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

        {!loading && !fatalError ? (
          <>
            {activeWorkspace === "editor" ? (
              <div className="workspace-grid">
                {draft && selectedBlueprint ? (
                  <>
                    {renderBlueprintPanel((index) => {
                      setSelectedButtonIndex(index);
                      setSelectedActionIndex(0);
                      setSelectedStepIndex(0);
                      setSelectedVirtualPressCount(2);
                      setAutomationTarget("native");
                    })}

                    <SequenceEditor
                      devicesById={devicesById}
                      draft={draft}
                      entitiesById={entitiesById}
                      onActionModeChange={(mode) =>
                        updateDraft((nextDraft) => {
                          const action = nextDraft.buttons[selectedButtonIndex]?.actions[selectedActionIndex];
                          if (action) {
                            action.mode = mode;
                          }
                        })
                      }
                      onReplaceSelectedStep={replaceSelectedStep}
                      onReplaceSequence={replaceSelectedSequence}
                      onSelectAction={(index) => {
                        setSelectedActionIndex(index);
                        setSelectedStepIndex(0);
                        setAutomationTarget("native");
                      }}
                      onSelectStep={setSelectedStepIndex}
                      selectedActionIndex={selectedActionIndex}
                      selectedBlueprint={selectedBlueprint}
                      selectedButtonIndex={selectedButtonIndex}
                      selectedStepIndex={selectedStepIndex}
                      snapshot={snapshot}
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
                {draft && selectedBlueprint ? (
                  <>
                    {renderBlueprintPanel((index) => {
                      setSelectedButtonIndex(index);
                      setSelectedStepIndex(0);
                      setSelectedVirtualPressCount(2);
                      setAutomationTarget("virtual");
                    })}

                    <VirtualActionEditor
                      draft={draft}
                      onSelectPressCount={(pressCount) => {
                        setSelectedVirtualPressCount(pressCount);
                        setAutomationTarget("virtual");
                      }}
                      onVirtualActionChange={updateVirtualAction}
                      onVirtualMultiPressEnabledChange={(enabled) =>
                        updateDraft((nextDraft) => {
                          nextDraft.virtualMultiPress.enabled = enabled;
                        })
                      }
                      onVirtualMultiPressMaxPressesChange={(value) =>
                        updateDraft((nextDraft) => {
                          nextDraft.virtualMultiPress.maxPresses = Math.max(2, Math.min(10, value));
                          nextDraft.buttons.forEach((button) => {
                            button.virtualActions = button.virtualActions.filter(
                              (entry) => entry.pressCount <= nextDraft.virtualMultiPress.maxPresses
                            );
                          });
                          setSelectedVirtualPressCount((current) =>
                            Math.min(current, Math.max(2, Math.min(10, value)))
                          );
                        })
                      }
                      onVirtualMultiPressWindowChange={(value) =>
                        updateDraft((nextDraft) => {
                          nextDraft.virtualMultiPress.pressWindowMs = Math.max(150, Math.min(3000, value));
                        })
                      }
                      selectedBlueprint={selectedBlueprint}
                      selectedButtonIndex={selectedButtonIndex}
                      selectedPressCount={selectedVirtualPressCount}
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
                draft={draft}
                learning={learning}
                onApplyIdentifier={(identifier) =>
                  updateDraft((nextDraft) => {
                    nextDraft.identifier = identifier;
                  })
                }
                onClear={() => void handleClearLearning()}
                onStart={() => void handleStartLearning()}
                onStop={() => void handleStopLearning()}
                selectedBlueprint={selectedBlueprint}
              />
            ) : null}

            {activeWorkspace === "automations" ? (
              <AutomationPanel
                automations={automations}
                draft={draft}
                filterConfigId={draft?.id ?? null}
                importTargetLabel={importTargetLabel}
                onExportCurrent={() => void handleExportCurrent()}
                onImportAutomation={handleImportAutomation}
              />
            ) : null}

            {activeWorkspace === "discovery" ? (
              <DiscoveryPanel
                blueprintsById={blueprintsById}
                candidates={discovery}
                onUseCandidate={(candidate, blueprintId) => {
                  const blueprint = blueprintsById.get(blueprintId);
                  if (!blueprint) {
                    return;
                  }
                  setSelectedConfigId("");
                  setDraft(createDraftFromDiscovery(candidate, blueprint));
                  setSelectedButtonIndex(0);
                  setSelectedActionIndex(0);
                  setSelectedStepIndex(0);
                  setSelectedVirtualPressCount(2);
                  setAutomationTarget("native");
                  setActiveWorkspace("editor");
                  setMessage(`Created a draft for ${candidate.name}.`);
                }}
              />
            ) : null}
          </>
        ) : null}
      </main>

      <PropertyPanel
        onClose={() => setPropertyDrawerOpen(false)}
        onControl={(entityId, action, value) => void handlePropertyControl(entityId, action, value)}
        open={propertyDrawerOpen}
        properties={properties}
      />
    </div>
  );
}
