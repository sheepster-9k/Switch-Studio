import type {
  DeviceSummary,
  EntitySummary,
  SequenceStep,
  StudioSnapshot,
  SwitchManagerBlueprint,
  SwitchManagerConfig
} from "../../shared/types";
import { SequenceListEditor } from "./SequenceEditor";

interface VirtualActionEditorProps {
  devicesById: Map<string, DeviceSummary>;
  draft: SwitchManagerConfig;
  entitiesById: Map<string, EntitySummary>;
  selectedBlueprint: SwitchManagerBlueprint;
  selectedButtonIndex: number;
  selectedPressCount: number;
  snapshot: StudioSnapshot | null;
  onSelectPressCount: (pressCount: number) => void;
  onVirtualMultiPressEnabledChange: (enabled: boolean) => void;
  onVirtualMultiPressWindowChange: (value: number) => void;
  onVirtualMultiPressMaxPressesChange: (value: number) => void;
  onVirtualActionChange: (
    pressCount: number,
    next: Partial<{ title: string; mode: string; sequence: SequenceStep[] }>
  ) => void;
}

export function VirtualActionEditor(props: VirtualActionEditorProps) {
  const {
    devicesById,
    draft,
    entitiesById,
    selectedBlueprint,
    selectedButtonIndex,
    selectedPressCount,
    snapshot,
    onSelectPressCount,
    onVirtualMultiPressEnabledChange,
    onVirtualMultiPressWindowChange,
    onVirtualMultiPressMaxPressesChange,
    onVirtualActionChange
  } = props;

  const blueprintButton = selectedBlueprint.buttons[selectedButtonIndex];
  const configButton = draft.buttons[selectedButtonIndex];
  const supported = (blueprintButton?.actions.length ?? 0) <= 1;
  const currentVirtual =
    configButton?.virtualActions.find((entry) => entry.pressCount === selectedPressCount) ?? null;

  if (!supported) {
    return (
      <section className="panel">
        <div className="panel-head">
          <div>
            <p className="eyebrow">Virtual Multi-Press</p>
            <h3>Unavailable</h3>
          </div>
        </div>
        <div className="warning-block">
          Select a button with one native action to configure synthetic multi-press.
        </div>
      </section>
    );
  }

  const availablePressCounts = Array.from(
    { length: Math.max(2, draft.virtualMultiPress.maxPresses) - 1 },
    (_, index) => index + 2
  );

  return (
    <section className="panel panel--editor">
      <div className="panel-head">
        <div>
          <p className="eyebrow">Virtual Multi-Press</p>
          <h3>Button {selectedButtonIndex + 1}</h3>
        </div>
        <label className="toggle-field">
          <span>Enabled</span>
          <button
            className={`toggle ${draft.virtualMultiPress.enabled ? "toggle--on" : ""}`}
            onClick={() => onVirtualMultiPressEnabledChange(!draft.virtualMultiPress.enabled)}
            type="button"
          >
            <span />
          </button>
        </label>
      </div>

      <div className="field-grid">
        <label className="field">
          <span>Wait window (ms)</span>
          <input
            min={150}
            onChange={(event) => onVirtualMultiPressWindowChange(Number(event.target.value) || 450)}
            step={25}
            type="number"
            value={draft.virtualMultiPress.pressWindowMs}
          />
        </label>

        <label className="field">
          <span>Max presses</span>
          <input
            max={10}
            min={2}
            onChange={(event) => onVirtualMultiPressMaxPressesChange(Number(event.target.value) || 3)}
            step={1}
            type="number"
            value={draft.virtualMultiPress.maxPresses}
          />
        </label>
      </div>

      <div className="action-tabs">
        {availablePressCounts.map((pressCount) => {
          const action = configButton?.virtualActions.find((entry) => entry.pressCount === pressCount);
          return (
            <button
              className={`action-tab ${pressCount === selectedPressCount ? "action-tab--selected" : ""}`}
              key={pressCount}
              onClick={() => onSelectPressCount(pressCount)}
              type="button"
            >
              <strong>{action?.title ?? `press ${pressCount}x`}</strong>
              <span>{action?.sequence.length ?? 0} steps</span>
            </button>
          );
        })}
      </div>

      <label className="field">
        <span>Title</span>
        <input
          onChange={(event) => onVirtualActionChange(selectedPressCount, { title: event.target.value })}
          type="text"
          value={currentVirtual?.title ?? `press ${selectedPressCount}x`}
        />
      </label>

      <label className="field">
        <span>Mode</span>
        <select
          onChange={(event) => onVirtualActionChange(selectedPressCount, { mode: event.target.value })}
          value={currentVirtual?.mode ?? "single"}
        >
          <option value="single">single</option>
          <option value="restart">restart</option>
          <option value="queued">queued</option>
          <option value="parallel">parallel</option>
        </select>
      </label>

      <SequenceListEditor
        addLabel="Add virtual step"
        devicesById={devicesById}
        emptyText="No steps configured for this press count."
        entitiesById={entitiesById}
        label={`Press ${selectedPressCount}x`}
        onSequenceChange={(sequence) => onVirtualActionChange(selectedPressCount, { sequence })}
        sequence={currentVirtual?.sequence ?? []}
        snapshot={snapshot}
      />
    </section>
  );
}
