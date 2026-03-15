import { useDeferredValue, useEffect, useMemo, useState, type ReactNode } from "react";
import { parse as parseYaml } from "yaml";

import {
  errorMessage,
  type DeviceSummary,
  type EntitySummary,
  type SequenceStep,
  type StudioSnapshot,
  type SwitchManagerBlueprint,
  type SwitchManagerConfig,
  type TargetKind
} from "../../shared/types";
import { cloneValue } from "../../shared/utils";
import {
  cloneStep,
  isRecord,
  matchesSearch,
  selectedTargetIds,
  shouldDisplayStepAlias,
  stepTargetKind,
  summarizeStep,
  targetLabel,
  updateStepTarget
} from "../helpers";
import {
  asSequence,
  buildTargetOptions,
  classifyCondition,
  classifyStep,
  classifyTrigger,
  coerceNumericField,
  createChooseBranchTemplate,
  createConditionTemplate,
  createServiceTemplate,
  createStepTemplate,
  createTriggerTemplate,
  durationToValue,
  formatYaml,
  isSupportedStepKind,
  listishToText,
  moveArrayEntry,
  moveSequenceEntry,
  parseDuration,
  parseListish,
  parseSequenceStep,
  parseYamlRecord,
  pluralizeTargetKind,
  preserveCommonStepFields,
  scalarToText,
  setBooleanField,
  setListishField,
  setObjectField,
  setOptionalStringField,
  setScalarField,
  setSequenceField,
  setYamlValueField,
  stepKindPillClass,
  summarizeChooseOption,
  summarizeCondition,
  summarizeTrigger,
  ZERO_DURATION,
  type ConditionType,
  type DurationParts,
  type StepKind,
  type StepTemplateKind,
  type TargetOption,
  type TriggerType
} from "./sequence/stepUtils";

interface SequenceEditorProps {
  devicesById: Map<string, DeviceSummary>;
  draft: SwitchManagerConfig;
  entitiesById: Map<string, EntitySummary>;
  onActionModeChange: (mode: string) => void;
  onReplaceSelectedStep: (step: SequenceStep) => void;
  onReplaceSequence: (sequence: SequenceStep[], nextSelectedIndex?: number) => void;
  onSelectAction: (index: number) => void;
  onSelectStep: (index: number) => void;
  selectedActionIndex: number;
  selectedBlueprint: SwitchManagerBlueprint;
  selectedButtonIndex: number;
  selectedStepIndex: number;
  snapshot: StudioSnapshot | null;
}

interface SequenceListEditorProps {
  addLabel?: string;
  depth?: number;
  devicesById: Map<string, DeviceSummary>;
  emptyText: string;
  entitiesById: Map<string, EntitySummary>;
  label: string;
  onReplaceSelectedStep?: (step: SequenceStep) => void;
  onSequenceChange: (sequence: SequenceStep[], nextSelectedIndex?: number) => void;
  selectedIndex?: number;
  sequence: SequenceStep[];
  snapshot: StudioSnapshot | null;
  onSelectIndex?: (index: number) => void;
}

interface StepInspectorProps {
  depth: number;
  devicesById: Map<string, DeviceSummary>;
  entitiesById: Map<string, EntitySummary>;
  onChange: (step: SequenceStep) => void;
  onDuplicate: () => void;
  onMoveDown: () => void;
  onMoveUp: () => void;
  onRemove: () => void;
  snapshot: StudioSnapshot | null;
  step: SequenceStep;
  stepIndex: number;
  totalSteps: number;
}

interface ConditionListEditorProps {
  conditions: SequenceStep[];
  label: string;
  onChange: (conditions: SequenceStep[]) => void;
}

interface TriggerListEditorProps {
  label: string;
  onChange: (triggers: SequenceStep[]) => void;
  triggers: SequenceStep[];
}

const STEP_TEMPLATE_OPTIONS: Array<{ detail: string; kind: StepTemplateKind; label: string }> = [
  { kind: "action", label: "Call service", detail: "Run a Home Assistant service with entity, device, or area targets." },
  { kind: "condition", label: "Condition", detail: "Gate the flow with state, template, numeric, or grouped conditions." },
  { kind: "delay", label: "Delay", detail: "Pause before the next step." },
  { kind: "choose", label: "Choose", detail: "Branch into one of several condition-driven sequences." },
  { kind: "if", label: "If / then", detail: "Run a then/else branch from a condition block." },
  { kind: "variables", label: "Variables", detail: "Stage values for later templating." },
  { kind: "parallel", label: "Parallel", detail: "Run multiple steps at the same time." },
  { kind: "wait_for_trigger", label: "Wait", detail: "Pause until another trigger fires." },
  { kind: "event", label: "Fire event", detail: "Emit an event with optional event data." },
  { kind: "sequence", label: "Grouped sequence", detail: "Nest a set of steps as one grouped action." },
  { kind: "stop", label: "Stop", detail: "End the sequence with a message." },
  { kind: "raw", label: "Custom YAML", detail: "Start from a free-form action for advanced Home Assistant syntax." }
];

const CONDITION_OPTIONS: Array<{ detail: string; type: ConditionType; label: string }> = [
  { type: "state", label: "State", detail: "Match a state or attribute value." },
  { type: "template", label: "Template", detail: "Use a Jinja template that resolves truthy." },
  { type: "numeric_state", label: "Numeric state", detail: "Check a numeric threshold." },
  { type: "time", label: "Time", detail: "Match a time window or weekdays." },
  { type: "trigger", label: "Trigger", detail: "Match the active trigger ID." },
  { type: "and", label: "And", detail: "All nested conditions must pass." },
  { type: "or", label: "Or", detail: "Any nested condition may pass." },
  { type: "not", label: "Not", detail: "Invert one or more nested conditions." },
  { type: "zone", label: "Zone", detail: "Match a person or device entering or leaving a zone." },
  { type: "sun", label: "Sun", detail: "Match sunrise or sunset windows." },
  { type: "raw", label: "Custom YAML", detail: "Edit the condition directly in YAML." }
];

const TRIGGER_OPTIONS: Array<{ detail: string; label: string; type: TriggerType }> = [
  { type: "state", label: "State", detail: "Wait for an entity state transition." },
  { type: "event", label: "Event", detail: "Wait for an event type." },
  { type: "time", label: "Time", detail: "Wait until a specific time." },
  { type: "homeassistant", label: "Home Assistant", detail: "Wait for startup or shutdown." },
  { type: "template", label: "Template", detail: "Wait until a template resolves true." },
  { type: "raw", label: "Custom YAML", detail: "Edit the trigger directly in YAML." }
];

const STEP_KIND_LABELS: Record<StepKind, string> = {
  action: "Call service",
  choose: "Choose",
  condition: "Condition",
  delay: "Delay",
  device_action: "Device action",
  event: "Fire event",
  if: "If / then",
  parallel: "Parallel",
  raw: "Custom YAML",
  repeat: "Repeat",
  sequence: "Grouped sequence",
  stop: "Stop",
  unsupported: "Unsupported",
  variables: "Variables",
  wait_for_trigger: "Wait for trigger",
  wait_template: "Wait template"
};

function EditorOverlay(props: {
  children: ReactNode;
  eyebrow: string;
  mode: "dialog" | "drawer";
  onClose: () => void;
  open: boolean;
  subtitle?: string;
  title: string;
}) {
  const { children, eyebrow, mode, onClose, open, subtitle, title } = props;

  useEffect(() => {
    if (!open) {
      return undefined;
    }
    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        onClose();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose, open]);

  if (!open) {
    return null;
  }

  const rootClass = mode === "drawer" ? "automation-drawer" : "automation-dialog";

  return (
    <div aria-modal="true" className={rootClass} role="dialog">
      <button
        aria-label="Close editor"
        className={`${rootClass}__backdrop`}
        onClick={onClose}
        type="button"
      />
      <section
        className={`${rootClass}__panel`}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="automation-sheet__header">
          <div>
            <p className="eyebrow">{eyebrow}</p>
            <h3>{title}</h3>
            {subtitle ? <p className="panel-copy automation-sheet__copy">{subtitle}</p> : null}
          </div>
          <button className="button button--ghost" onClick={onClose} type="button">
            Close
          </button>
        </div>
        {children}
      </section>
    </div>
  );
}

function PickerDialog(props: {
  description: string;
  emptyText: string;
  eyebrow: string;
  onClose: () => void;
  onPick: (id: string) => void;
  open: boolean;
  options: TargetOption[];
  title: string;
}) {
  const { description, emptyText, eyebrow, onClose, onPick, open, options, title } = props;
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search.trim());

  useEffect(() => {
    if (!open && search) {
      setSearch("");
    }
  }, [open, search]);

  const filteredOptions = useMemo(
    () => options.filter((option) => matchesSearch(`${option.label} ${option.detail}`, deferredSearch)),
    [deferredSearch, options]
  );

  return (
    <EditorOverlay
      eyebrow={eyebrow}
      mode="dialog"
      onClose={onClose}
      open={open}
      subtitle={description}
      title={title}
    >
      <label className="field">
        <span>Search</span>
        <input
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Find a building block"
          type="search"
          value={search}
        />
      </label>

      <div className="automation-sheet__meta">
        <span className="pill pill--muted">{filteredOptions.length} options</span>
      </div>

      <div className="picker-dialog__grid">
        {filteredOptions.length === 0 ? <div className="empty-state">{emptyText}</div> : null}
        {filteredOptions.map((option) => (
          <button
            className="step-add-option"
            key={option.id}
            onClick={() => onPick(option.id)}
            type="button"
          >
            <strong>{option.label}</strong>
            <span>{option.detail}</span>
          </button>
        ))}
      </div>
    </EditorOverlay>
  );
}

export function SequenceEditor(props: SequenceEditorProps) {
  const {
    devicesById,
    draft,
    entitiesById,
    onActionModeChange,
    onReplaceSelectedStep,
    onReplaceSequence,
    onSelectAction,
    onSelectStep,
    selectedActionIndex,
    selectedBlueprint,
    selectedButtonIndex,
    selectedStepIndex,
    snapshot
  } = props;

  const selectedButton = draft.buttons[selectedButtonIndex] ?? null;
  const selectedAction = selectedButton?.actions[selectedActionIndex] ?? null;

  const isSensor = selectedBlueprint.blueprintType === "sensor";
  const triggerLabel = isSensor
    ? (selectedBlueprint.buttons[selectedButtonIndex]?.actions[0]?.title ?? `Trigger ${selectedButtonIndex + 1}`)
    : `Button ${selectedButtonIndex + 1}`;

  return (
    <section className="panel panel--editor">
      <div className="panel-head">
        <div>
          <p className="eyebrow">{isSensor ? "Trigger" : "Mapping"}</p>
          <h3>{triggerLabel}</h3>
        </div>
        <span className="pill">{selectedButton?.actions.length ?? 0} action slots</span>
      </div>

      <div className="action-tabs">
        {selectedButton?.actions.map((action, index) => {
          const blueprintAction = selectedBlueprint.buttons[selectedButtonIndex]?.actions[index];
          return (
            <button
              className={`action-tab ${index === selectedActionIndex ? "action-tab--selected" : ""}`}
              key={`${selectedButtonIndex}-${index}`}
              onClick={() => onSelectAction(index)}
              type="button"
            >
              <strong>{blueprintAction?.title ?? `Action ${index + 1}`}</strong>
              <span>{action.sequence.length} steps</span>
            </button>
          );
        })}
      </div>

      {selectedAction ? (
        <>
          <div className="mode-row">
            <label className="field">
              <span>Script mode</span>
              <select onChange={(event) => onActionModeChange(event.target.value)} value={selectedAction.mode}>
                <option value="single">single</option>
                <option value="restart">restart</option>
                <option value="queued">queued</option>
                <option value="parallel">parallel</option>
              </select>
            </label>
            <span className="pill pill--muted">Visual editor with YAML fallback</span>
          </div>

          <SequenceListEditor
            addLabel="Add action"
            devicesById={devicesById}
            emptyText="No steps mapped yet. Add a step to start building this action."
            entitiesById={entitiesById}
            label="Action sequence"
            onReplaceSelectedStep={onReplaceSelectedStep}
            onSequenceChange={onReplaceSequence}
            onSelectIndex={onSelectStep}
            selectedIndex={selectedStepIndex}
            sequence={selectedAction.sequence}
            snapshot={snapshot}
          />
        </>
      ) : (
        <div className="empty-state">{isSensor ? "This trigger has no action slots." : "This button has no action slots."}</div>
      )}
    </section>
  );
}

export function SequenceListEditor(props: SequenceListEditorProps) {
  const {
    addLabel = "Add step",
    depth = 0,
    devicesById,
    emptyText,
    entitiesById,
    label,
    onReplaceSelectedStep,
    onSequenceChange,
    onSelectIndex,
    selectedIndex,
    sequence,
    snapshot
  } = props;

  const [internalSelectedIndex, setInternalSelectedIndex] = useState(0);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const controlled = typeof selectedIndex === "number" && typeof onSelectIndex === "function";
  const activeIndex = controlled ? selectedIndex : internalSelectedIndex;
  const selectedStep = sequence[activeIndex] ?? null;

  useEffect(() => {
    if (sequence.length === 0) {
      setEditorOpen(false);
      if (controlled) {
        onSelectIndex?.(0);
      } else {
        setInternalSelectedIndex(0);
      }
      return;
    }
    if (activeIndex < sequence.length) {
      return;
    }
    if (controlled) {
      onSelectIndex?.(sequence.length - 1);
    } else {
      setInternalSelectedIndex(sequence.length - 1);
    }
  }, [activeIndex, controlled, onSelectIndex, sequence.length]);

  function selectIndex(index: number): void {
    if (controlled) {
      onSelectIndex?.(index);
    } else {
      setInternalSelectedIndex(index);
    }
    setEditorOpen(true);
  }

  function commit(nextSequence: SequenceStep[], nextSelectedIndex?: number): void {
    const resolvedSelectedIndex =
      nextSequence.length === 0
        ? 0
        : Math.max(0, Math.min(nextSelectedIndex ?? activeIndex, nextSequence.length - 1));
    onSequenceChange(nextSequence.map((step) => cloneStep(step)), resolvedSelectedIndex);
    if (!controlled) {
      setInternalSelectedIndex(resolvedSelectedIndex);
    }
  }

  function addStep(kind: StepTemplateKind): void {
    const nextSequence = [...sequence.map((step) => cloneStep(step)), createStepTemplate(kind)];
    commit(nextSequence, nextSequence.length - 1);
    setPickerOpen(false);
    setEditorOpen(true);
  }

  function replaceStep(index: number, nextStep: SequenceStep): void {
    const nextSequence = sequence.map((entry, entryIndex) => (entryIndex === index ? cloneStep(nextStep) : cloneStep(entry)));
    commit(nextSequence, index);
  }

  function removeStep(index: number): void {
    const nextSequence = sequence.filter((_, entryIndex) => entryIndex !== index).map((entry) => cloneStep(entry));
    commit(nextSequence, Math.max(0, index - 1));
  }

  function duplicateStep(index: number): void {
    const nextSequence = sequence.map((entry) => cloneStep(entry));
    const duplicate = cloneStep(sequence[index] ?? {});
    nextSequence.splice(index + 1, 0, duplicate);
    commit(nextSequence, index + 1);
    setEditorOpen(true);
  }

  function moveStep(index: number, delta: number): void {
    const destination = index + delta;
    if (destination < 0 || destination >= sequence.length) {
      return;
    }
    const nextSequence = sequence.map((entry) => cloneStep(entry));
    const [moved] = nextSequence.splice(index, 1);
    nextSequence.splice(destination, 0, moved);
    commit(nextSequence, destination);
  }

  function moveStepToIndex(fromIndex: number, toIndex: number): void {
    moveSequenceEntry(sequence, fromIndex, toIndex, commit);
  }

  return (
    <div className={`step-builder ${depth > 0 ? "step-builder--nested" : ""}`}>
      <div className="step-builder__toolbar">
        <div>
          <p className="eyebrow">{label}</p>
          <h4>{label} ({sequence.length})</h4>
        </div>
        <div className="step-builder__toolbar-actions">
          <button className="button" onClick={() => setPickerOpen(true)} type="button">
            {addLabel}
          </button>
        </div>
      </div>

      <div className={`sequence-list sequence-list--builder ${depth > 0 ? "sequence-list--nested" : ""}`}>
        {sequence.length === 0 ? <div className="empty-state">{emptyText}</div> : null}

        {sequence.map((step, index) => {
          const kind = classifyStep(step);
          const alias = typeof step.alias === "string" ? step.alias.trim() : "";
          const displayAlias = shouldDisplayStepAlias(step) ? alias : "";
          return (
            <div
              className={`sequence-item ${dropIndex === index ? "sequence-item--drop" : ""}`}
              key={`${depth}-${index}-${kind}`}
              onDragOver={(event) => {
                event.preventDefault();
                if (dragIndex !== index) {
                  setDropIndex(index);
                }
              }}
              onDrop={(event) => {
                event.preventDefault();
                if (dragIndex !== null) {
                  moveStepToIndex(dragIndex, index);
                }
                setDragIndex(null);
                setDropIndex(null);
              }}
            >
              <button
                aria-label={`Drag step ${index + 1}`}
                className="drag-handle"
                draggable={sequence.length > 1}
                onDragEnd={() => {
                  setDragIndex(null);
                  setDropIndex(null);
                }}
                onDragStart={(event) => {
                  event.dataTransfer.effectAllowed = "move";
                  event.dataTransfer.setData("text/plain", String(index));
                  setDragIndex(index);
                  setDropIndex(index);
                }}
                type="button"
              >
                ⋮⋮
              </button>

              <button
                className={`sequence-card sequence-card--builder ${index === activeIndex ? "sequence-card--selected" : ""}`}
                onClick={() => selectIndex(index)}
                type="button"
              >
                <span>Step {index + 1}</span>
                <strong>{summarizeStep(step)}</strong>
                <div className="sequence-card__meta">
                  <span className={`pill ${stepKindPillClass(kind)}`}>{STEP_KIND_LABELS[kind]}</span>
                  {displayAlias ? <span className="muted-chip">{displayAlias}</span> : null}
                </div>
              </button>
            </div>
          );
        })}
      </div>

      <button className="button button--add-step" onClick={() => setPickerOpen(true)} type="button">
        + {addLabel}
      </button>

      <PickerDialog
        description="Pick a Home Assistant action block, then fine tune it in the editor."
        emptyText="No matching actions."
        eyebrow={depth === 0 ? "Action library" : "Nested builder"}
        onClose={() => setPickerOpen(false)}
        onPick={(choice) => addStep(choice as StepTemplateKind)}
        open={pickerOpen}
        options={STEP_TEMPLATE_OPTIONS.map((option) => ({
          detail: option.detail,
          id: option.kind,
          label: option.label
        }))}
        title={addLabel}
      />

      <EditorOverlay
        eyebrow={depth === 0 ? "Action editor" : "Nested editor"}
        mode={depth === 0 ? "drawer" : "dialog"}
        onClose={() => setEditorOpen(false)}
        open={editorOpen && Boolean(selectedStep)}
        subtitle={selectedStep ? summarizeStep(selectedStep) : undefined}
        title={`Step ${activeIndex + 1}`}
      >
        {selectedStep ? (
          <StepInspector
            depth={depth}
            devicesById={devicesById}
            entitiesById={entitiesById}
            onChange={(nextStep) => {
              if (depth === 0 && onReplaceSelectedStep) {
                onReplaceSelectedStep(nextStep);
                return;
              }
              replaceStep(activeIndex, nextStep);
            }}
            onDuplicate={() => duplicateStep(activeIndex)}
            onMoveDown={() => moveStep(activeIndex, 1)}
            onMoveUp={() => moveStep(activeIndex, -1)}
            onRemove={() => {
              removeStep(activeIndex);
              if (sequence.length <= 1) {
                setEditorOpen(false);
              }
            }}
            snapshot={snapshot}
            step={selectedStep}
            stepIndex={activeIndex}
            totalSteps={sequence.length}
          />
        ) : null}
      </EditorOverlay>
    </div>
  );
}

function StepInspector(props: StepInspectorProps) {
  const {
    depth,
    devicesById,
    entitiesById,
    onChange,
    onDuplicate,
    onMoveDown,
    onMoveUp,
    onRemove,
    snapshot,
    step,
    stepIndex,
    totalSteps
  } = props;

  const kind = classifyStep(step);
  const editableKind = isSupportedStepKind(kind) ? kind : "raw";

  return (
    <div className={`step-editor ${depth > 0 ? "step-editor--nested" : ""}`}>
      <div className="step-editor__head">
        <div>
          <p className="eyebrow">Step settings</p>
          <h3>{STEP_KIND_LABELS[editableKind]}</h3>
          <p className="panel-copy">{summarizeStep(step)}</p>
        </div>
        <div className="inline-actions">
          <button className="button button--ghost" disabled={stepIndex === 0} onClick={onMoveUp} type="button">
            Move up
          </button>
          <button className="button button--ghost" disabled={stepIndex >= totalSteps - 1} onClick={onMoveDown} type="button">
            Move down
          </button>
          <button className="button button--ghost" onClick={onDuplicate} type="button">
            Duplicate
          </button>
          <button className="button button--danger" onClick={onRemove} type="button">
            Remove
          </button>
        </div>
      </div>

      <div className="field-grid">
        <label className="field">
          <span>Step type</span>
          <select
            onChange={(event) => onChange(preserveCommonStepFields(step, createStepTemplate(event.target.value as StepTemplateKind)))}
            value={editableKind}
          >
            {STEP_TEMPLATE_OPTIONS.map((option) => (
              <option key={option.kind} value={option.kind}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span>Alias</span>
          <input
            onChange={(event) => onChange(setOptionalStringField(step, "alias", event.target.value))}
            placeholder="Optional label"
            type="text"
            value={typeof step.alias === "string" ? step.alias : ""}
          />
        </label>
      </div>

      <div className="toggle-strip">
        <InlineToggle
          active={step.enabled !== false}
          description="Disable to keep the step in place without running it."
          label="Enabled"
          onToggle={() => onChange(setBooleanField(step, "enabled", step.enabled === false, true))}
        />
        <InlineToggle
          active={Boolean(step.continue_on_error)}
          description="Continue the sequence if this step fails."
          label="Continue on error"
          onToggle={() => onChange(setBooleanField(step, "continue_on_error", !Boolean(step.continue_on_error), false))}
        />
      </div>

      {!isSupportedStepKind(kind) ? (
        <div className="warning-block">
          This step uses {STEP_KIND_LABELS[kind].toLowerCase()} syntax. Visual editing is limited, but the YAML editor below remains available.
        </div>
      ) : null}
      {kind === "action" ? (
        <ServiceStepEditor
          devicesById={devicesById}
          entitiesById={entitiesById}
          onChange={onChange}
          snapshot={snapshot}
          step={step}
        />
      ) : null}
      {kind === "delay" ? <DelayStepEditor onChange={onChange} step={step} /> : null}
      {kind === "condition" ? <ConditionStepEditor onChange={onChange} step={step} /> : null}
      {kind === "choose" ? (
        <ChooseStepEditor
          devicesById={devicesById}
          entitiesById={entitiesById}
          onChange={onChange}
          snapshot={snapshot}
          step={step}
        />
      ) : null}
      {kind === "if" ? (
        <IfStepEditor
          devicesById={devicesById}
          entitiesById={entitiesById}
          onChange={onChange}
          snapshot={snapshot}
          step={step}
        />
      ) : null}
      {kind === "parallel" ? (
        <SequenceContainerEditor
          devicesById={devicesById}
          entitiesById={entitiesById}
          label="Parallel steps"
          onChange={(parallel) => onChange(setSequenceField(step, "parallel", parallel))}
          sequence={asSequence(step.parallel)}
          snapshot={snapshot}
        />
      ) : null}
      {kind === "sequence" ? (
        <SequenceContainerEditor
          devicesById={devicesById}
          entitiesById={entitiesById}
          label="Grouped sequence"
          onChange={(sequence) => onChange(setSequenceField(step, "sequence", sequence))}
          sequence={asSequence(step.sequence)}
          snapshot={snapshot}
        />
      ) : null}
      {kind === "variables" ? <VariablesStepEditor onChange={onChange} step={step} /> : null}
      {kind === "wait_for_trigger" ? <WaitForTriggerStepEditor onChange={onChange} step={step} /> : null}
      {kind === "event" ? <EventStepEditor onChange={onChange} step={step} /> : null}
      {kind === "stop" ? <StopStepEditor onChange={onChange} step={step} /> : null}

      <details className="yaml-panel">
        <summary>Advanced YAML</summary>
        <YamlFieldEditor
          buttonLabel="Apply YAML"
          label="Step YAML"
          onApply={(nextStep) => onChange(nextStep)}
          rows={12}
          validate={parseSequenceStep}
          value={step}
        />
      </details>
    </div>
  );
}

function ServiceStepEditor(props: {
  devicesById: Map<string, DeviceSummary>;
  entitiesById: Map<string, EntitySummary>;
  onChange: (step: SequenceStep) => void;
  snapshot: StudioSnapshot | null;
  step: SequenceStep;
}) {
  const { devicesById, entitiesById, onChange, snapshot, step } = props;
  const [targetKind, setTargetKind] = useState<TargetKind>(stepTargetKind(step));
  const [targetSearch, setTargetSearch] = useState("");
  const chosenTargetIds = selectedTargetIds(step, targetKind);

  useEffect(() => {
    setTargetKind(stepTargetKind(step));
  }, [step]);

  const availableTargets = useMemo(
    () => buildTargetOptions(snapshot, targetKind, targetSearch),
    [snapshot, targetKind, targetSearch]
  );

  return (
    <>
      <label className="field">
        <span>Service</span>
        <input
          onChange={(event) => onChange(setOptionalStringField(step, "action", event.target.value))}
          placeholder="light.toggle"
          type="text"
          value={typeof step.action === "string" ? step.action : ""}
        />
      </label>

      <div className="target-pane">
        <div className="target-pane__header">
          <span>Target browser</span>
          <div className="segmented">
            {(["entity", "device", "area"] as TargetKind[]).map((kind) => (
              <button
                className={kind === targetKind ? "segmented__item segmented__item--selected" : "segmented__item"}
                key={kind}
                onClick={() => setTargetKind(kind)}
                type="button"
              >
                {kind}
              </button>
            ))}
          </div>
        </div>

        <div className="target-chips">
          {chosenTargetIds.length === 0 ? <span className="muted-chip">No {targetKind} selected</span> : null}
          {chosenTargetIds.map((id) => (
            <button
              className="target-chip"
              key={id}
              onClick={() => {
                const nextIds = chosenTargetIds.filter((entry) => entry !== id);
                onChange(updateStepTarget(step, targetKind, nextIds));
              }}
              type="button"
            >
              {targetLabel(targetKind, id, snapshot, devicesById, entitiesById)}
            </button>
          ))}
        </div>

        <label className="field search-field">
          <span>Search {pluralizeTargetKind(targetKind)}</span>
          <input
            onChange={(event) => setTargetSearch(event.target.value)}
            placeholder={`Search ${pluralizeTargetKind(targetKind)}`}
            type="search"
            value={targetSearch}
          />
        </label>

        <div className="target-results">
          {availableTargets.map((item) => {
            const selected = chosenTargetIds.includes(item.id);
            return (
              <button
                className={`target-result ${selected ? "target-result--selected" : ""}`}
                key={item.id}
                onClick={() => {
                  const nextIds = selected
                    ? chosenTargetIds.filter((entry) => entry !== item.id)
                    : [...chosenTargetIds, item.id];
                  onChange(updateStepTarget(step, targetKind, nextIds));
                }}
                type="button"
              >
                <strong>{item.label}</strong>
                <span>{item.detail}</span>
              </button>
            );
          })}
        </div>
      </div>

      <YamlFieldEditor
        buttonLabel="Apply service data"
        label="Service data"
        onApply={(data) => onChange(setObjectField(step, "data", data))}
        rows={8}
        validate={parseYamlRecord}
        value={isRecord(step.data) ? step.data : {}}
      />
    </>
  );
}

function DelayStepEditor(props: { onChange: (step: SequenceStep) => void; step: SequenceStep }) {
  const { onChange, step } = props;
  const parts = parseDuration(step.delay);

  if (!parts) {
    return (
      <div className="warning-block">
        This delay uses a format the visual editor cannot safely normalize. Use the YAML editor below to adjust it.
      </div>
    );
  }

  function updatePart(key: keyof DurationParts, value: number): void {
    const next = {
      ...parts,
      [key]: Math.max(0, value)
    };
    onChange(setScalarField(step, "delay", durationToValue(next)));
  }

  return (
    <div className="field-grid">
      <NumberField label="Hours" min={0} onChange={(value) => updatePart("hours", value)} value={parts.hours} />
      <NumberField label="Minutes" min={0} onChange={(value) => updatePart("minutes", value)} value={parts.minutes} />
      <NumberField label="Seconds" min={0} onChange={(value) => updatePart("seconds", value)} value={parts.seconds} />
      <NumberField
        label="Milliseconds"
        min={0}
        onChange={(value) => updatePart("milliseconds", value)}
        value={parts.milliseconds}
      />
    </div>
  );
}

function ConditionStepEditor(props: { onChange: (step: SequenceStep) => void; step: SequenceStep }) {
  const { onChange, step } = props;
  return <ConditionEditor condition={step} onChange={(condition) => onChange(condition)} />;
}

function ChooseStepEditor(props: {
  devicesById: Map<string, DeviceSummary>;
  entitiesById: Map<string, EntitySummary>;
  onChange: (step: SequenceStep) => void;
  snapshot: StudioSnapshot | null;
  step: SequenceStep;
}) {
  const { devicesById, entitiesById, onChange, snapshot, step } = props;
  const branches = Array.isArray(step.choose)
    ? step.choose.map((entry) => (isRecord(entry) ? entry : { conditions: [], sequence: [] }))
    : [];
  const [expandedSection, setExpandedSection] = useState<string | null>(branches.length > 0 ? "option-0" : "default");

  useEffect(() => {
    if (expandedSection === null) {
      return;
    }
    if (expandedSection === "default") {
      return;
    }
    const optionIndex = Number(expandedSection.replace("option-", ""));
    if (Number.isNaN(optionIndex) || optionIndex >= branches.length) {
      setExpandedSection(branches.length > 0 ? `option-${Math.max(0, branches.length - 1)}` : "default");
    }
  }, [branches.length, expandedSection]);

  function updateBranches(nextBranches: Array<Record<string, unknown>>, nextExpandedSection = expandedSection): void {
    const nextStep = cloneStep(step);
    nextStep.choose = nextBranches;
    onChange(nextStep);
    setExpandedSection(nextExpandedSection);
  }

  function updateBranch(index: number, updater: (branch: Record<string, unknown>) => Record<string, unknown>): void {
    const nextBranches = branches.map((branch, branchIndex) =>
      branchIndex === index ? updater(cloneValue(branch)) : cloneValue(branch)
    );
    updateBranches(nextBranches, `option-${index}`);
  }

  return (
    <div className="branch-editor">
      <div className="step-builder__toolbar">
        <div>
          <p className="eyebrow">Choose options</p>
          <h4>{branches.length} option{branches.length === 1 ? "" : "s"}</h4>
        </div>
        <button
          className="button"
          onClick={() => {
            const nextBranches = [...branches.map((branch) => cloneValue(branch)), createChooseBranchTemplate()];
            updateBranches(nextBranches, `option-${nextBranches.length - 1}`);
          }}
          type="button"
        >
          Add option
        </button>
      </div>

      <div className="choose-options">
        {branches.length === 0 ? <div className="empty-state">No options yet. Add one to begin.</div> : null}
        {branches.map((branch, index) => (
          <article className="choose-option" key={`branch-${index}`}>
            <button
              className={`choose-option__header ${
                expandedSection === `option-${index}` ? "choose-option__header--open" : ""
              }`}
              onClick={() =>
                setExpandedSection((current) => (current === `option-${index}` ? null : `option-${index}`))
              }
              type="button"
            >
              <div>
                <strong>{summarizeChooseOption(branch, index)}</strong>
                <span>
                  {asSequence(branch.conditions).length} condition{asSequence(branch.conditions).length === 1 ? "" : "s"} •{" "}
                  {asSequence(branch.sequence).length} action{asSequence(branch.sequence).length === 1 ? "" : "s"}
                </span>
              </div>
              <span className="choose-option__caret">
                {expandedSection === `option-${index}` ? "▾" : "▸"}
              </span>
            </button>

            {expandedSection === `option-${index}` ? (
              <div className="choose-option__body">
                <div className="inline-actions">
                  <button
                    className="button button--ghost"
                    disabled={index === 0}
                    onClick={() => moveArrayEntry(branches, index, index - 1, (nextBranches) => updateBranches(nextBranches, `option-${index - 1}`))}
                    type="button"
                  >
                    Move up
                  </button>
                  <button
                    className="button button--ghost"
                    disabled={index >= branches.length - 1}
                    onClick={() => moveArrayEntry(branches, index, index + 1, (nextBranches) => updateBranches(nextBranches, `option-${index + 1}`))}
                    type="button"
                  >
                    Move down
                  </button>
                  <button
                    className="button button--danger"
                    onClick={() => {
                      const nextBranches = branches
                        .filter((_, branchIndex) => branchIndex !== index)
                        .map((entry) => cloneValue(entry));
                      updateBranches(
                        nextBranches,
                        nextBranches.length === 0 ? "default" : `option-${Math.max(0, index - 1)}`
                      );
                    }}
                    type="button"
                  >
                    Remove option
                  </button>
                </div>

                <ConditionListEditor
                  conditions={asSequence(branch.conditions)}
                  label="Conditions"
                  onChange={(conditions) => updateBranch(index, (entry) => setSequenceField(entry, "conditions", conditions))}
                />

                <SequenceContainerEditor
                  devicesById={devicesById}
                  entitiesById={entitiesById}
                  label="Actions"
                  onChange={(sequence) => updateBranch(index, (entry) => setSequenceField(entry, "sequence", sequence))}
                  sequence={asSequence(branch.sequence)}
                  snapshot={snapshot}
                />
              </div>
            ) : null}
          </article>
        ))}

        <article className="choose-option">
          <button
            className={`choose-option__header ${expandedSection === "default" ? "choose-option__header--open" : ""}`}
            onClick={() => setExpandedSection((current) => (current === "default" ? null : "default"))}
            type="button"
          >
            <div>
              <strong>Default actions</strong>
              <span>{asSequence(step.default).length} action{asSequence(step.default).length === 1 ? "" : "s"}</span>
            </div>
            <span className="choose-option__caret">{expandedSection === "default" ? "▾" : "▸"}</span>
          </button>

          {expandedSection === "default" ? (
            <div className="choose-option__body">
              <SequenceContainerEditor
                devicesById={devicesById}
                entitiesById={entitiesById}
                label="Default actions"
                onChange={(sequence) => onChange(setSequenceField(step, "default", sequence))}
                sequence={asSequence(step.default)}
                snapshot={snapshot}
              />
            </div>
          ) : null}
        </article>
      </div>
    </div>
  );
}

function IfStepEditor(props: {
  devicesById: Map<string, DeviceSummary>;
  entitiesById: Map<string, EntitySummary>;
  onChange: (step: SequenceStep) => void;
  snapshot: StudioSnapshot | null;
  step: SequenceStep;
}) {
  const { devicesById, entitiesById, onChange, snapshot, step } = props;
  return (
    <div className="branch-editor">
      <ConditionListEditor
        conditions={asSequence(step.if)}
        label="If conditions"
        onChange={(conditions) => onChange(setSequenceField(step, "if", conditions))}
      />

      <SequenceContainerEditor
        devicesById={devicesById}
        entitiesById={entitiesById}
        label="Then steps"
        onChange={(sequence) => onChange(setSequenceField(step, "then", sequence))}
        sequence={asSequence(step.then)}
        snapshot={snapshot}
      />

      <SequenceContainerEditor
        devicesById={devicesById}
        entitiesById={entitiesById}
        label="Else steps"
        onChange={(sequence) => onChange(setSequenceField(step, "else", sequence))}
        sequence={asSequence(step.else)}
        snapshot={snapshot}
      />
    </div>
  );
}

function VariablesStepEditor(props: { onChange: (step: SequenceStep) => void; step: SequenceStep }) {
  const { onChange, step } = props;
  return (
    <YamlFieldEditor
      buttonLabel="Apply variables"
      label="Variables"
      onApply={(variables) => onChange(setObjectField(step, "variables", variables))}
      rows={8}
      validate={parseYamlRecord}
      value={isRecord(step.variables) ? step.variables : {}}
    />
  );
}

function WaitForTriggerStepEditor(props: { onChange: (step: SequenceStep) => void; step: SequenceStep }) {
  const { onChange, step } = props;
  return (
    <div className="branch-editor">
      <TriggerListEditor
        label="Wait triggers"
        onChange={(triggers) => onChange(setSequenceField(step, "wait_for_trigger", triggers))}
        triggers={asSequence(step.wait_for_trigger)}
      />

      <YamlFieldEditor
        buttonLabel="Apply timeout"
        label="Timeout"
        onApply={(timeout) => onChange(setYamlValueField(step, "timeout", timeout))}
        rows={5}
        validate={(parsed) => parsed as unknown}
        value={step.timeout ?? {}}
      />

      <InlineToggle
        active={Boolean(step.continue_on_timeout)}
        description="Continue the sequence when the timeout is hit."
        label="Continue on timeout"
        onToggle={() => onChange(setBooleanField(step, "continue_on_timeout", !Boolean(step.continue_on_timeout), false))}
      />
    </div>
  );
}

function EventStepEditor(props: { onChange: (step: SequenceStep) => void; step: SequenceStep }) {
  const { onChange, step } = props;
  return (
    <>
      <label className="field">
        <span>Event type</span>
        <input
          onChange={(event) => onChange(setOptionalStringField(step, "event", event.target.value))}
          placeholder="switch_manager_action"
          type="text"
          value={typeof step.event === "string" ? step.event : ""}
        />
      </label>

      <YamlFieldEditor
        buttonLabel="Apply event data"
        label="Event data"
        onApply={(eventData) => onChange(setObjectField(step, "event_data", eventData))}
        rows={8}
        validate={parseYamlRecord}
        value={isRecord(step.event_data) ? step.event_data : {}}
      />
    </>
  );
}

function StopStepEditor(props: { onChange: (step: SequenceStep) => void; step: SequenceStep }) {
  const { onChange, step } = props;
  return (
    <>
      <label className="field">
        <span>Message</span>
        <input
          onChange={(event) => onChange(setOptionalStringField(step, "stop", event.target.value))}
          placeholder="Stop sequence"
          type="text"
          value={typeof step.stop === "string" ? step.stop : ""}
        />
      </label>

      <div className="field-grid">
        <label className="field">
          <span>Response variable</span>
          <input
            onChange={(event) => onChange(setOptionalStringField(step, "response_variable", event.target.value))}
            placeholder="Optional response variable"
            type="text"
            value={typeof step.response_variable === "string" ? step.response_variable : ""}
          />
        </label>

        <InlineToggle
          active={Boolean(step.error)}
          description="Mark the stop as an error."
          label="Error"
          onToggle={() => onChange(setBooleanField(step, "error", !Boolean(step.error), false))}
        />
      </div>
    </>
  );
}

function SequenceContainerEditor(props: {
  devicesById: Map<string, DeviceSummary>;
  entitiesById: Map<string, EntitySummary>;
  label: string;
  onChange: (sequence: SequenceStep[]) => void;
  sequence: SequenceStep[];
  snapshot: StudioSnapshot | null;
}) {
  const { devicesById, entitiesById, label, onChange, sequence, snapshot } = props;
  return (
    <SequenceListEditor
      addLabel="Add action"
      depth={1}
      devicesById={devicesById}
      emptyText={`No steps in ${label.toLowerCase()} yet.`}
      entitiesById={entitiesById}
      label={label}
      onSequenceChange={onChange}
      sequence={sequence}
      snapshot={snapshot}
    />
  );
}

function ConditionListEditor(props: ConditionListEditorProps) {
  const { conditions, label, onChange } = props;
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [editorOpen, setEditorOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const selectedCondition = conditions[selectedIndex] ?? null;

  useEffect(() => {
    if (conditions.length === 0) {
      setSelectedIndex(0);
      setEditorOpen(false);
      return;
    }
    if (selectedIndex >= conditions.length) {
      setSelectedIndex(conditions.length - 1);
    }
  }, [conditions.length, selectedIndex]);

  function updateConditions(nextConditions: SequenceStep[], nextSelectedIndex = selectedIndex): void {
    onChange(nextConditions.map((condition) => cloneStep(condition)));
    setSelectedIndex(Math.max(0, Math.min(nextSelectedIndex, nextConditions.length - 1)));
  }

  return (
    <div className="stack-card">
      <div className="step-builder__toolbar">
        <div>
          <p className="eyebrow">{label}</p>
          <h4>{conditions.length} condition{conditions.length === 1 ? "" : "s"}</h4>
        </div>
        <div className="step-builder__toolbar-actions">
          {conditions.length > 0 ? <span className="pill pill--muted">Edit one condition at a time</span> : null}
          <button className="button button--ghost" onClick={() => setPickerOpen(true)} type="button">
            Add condition
          </button>
        </div>
      </div>

      <div className="condition-list">
        {conditions.length === 0 ? <div className="empty-state">No conditions yet.</div> : null}
        {conditions.map((condition, index) => (
          <button
            className={`sequence-card ${index === selectedIndex ? "sequence-card--selected" : ""}`}
            key={`condition-${index}`}
            onClick={() => {
              setSelectedIndex(index);
              setEditorOpen(true);
            }}
            type="button"
          >
            <span>Condition {index + 1}</span>
            <strong>{summarizeCondition(condition)}</strong>
          </button>
        ))}
      </div>

      <PickerDialog
        description="Select the condition type, then configure the details in a focused dialog."
        emptyText="No matching conditions."
        eyebrow="Condition library"
        onClose={() => setPickerOpen(false)}
        onPick={(choice) => {
          updateConditions(
            [...conditions.map((condition) => cloneStep(condition)), createConditionTemplate(choice as ConditionType)],
            conditions.length
          );
          setPickerOpen(false);
          setEditorOpen(true);
        }}
        open={pickerOpen}
        options={CONDITION_OPTIONS.map((option) => ({
          detail: option.detail,
          id: option.type,
          label: option.label
        }))}
        title="Add condition"
      />

      <EditorOverlay
        eyebrow="Condition editor"
        mode="dialog"
        onClose={() => setEditorOpen(false)}
        open={editorOpen && Boolean(selectedCondition)}
        subtitle={selectedCondition ? summarizeCondition(selectedCondition) : undefined}
        title={`Condition ${selectedIndex + 1}`}
      >
        {selectedCondition ? (
          <div className="stack-card">
            <div className="inline-actions">
              <button
                className="button button--ghost"
                disabled={selectedIndex === 0}
                onClick={() => moveSequenceEntry(conditions, selectedIndex, selectedIndex - 1, updateConditions)}
                type="button"
              >
                Move up
              </button>
              <button
                className="button button--ghost"
                disabled={selectedIndex >= conditions.length - 1}
                onClick={() => moveSequenceEntry(conditions, selectedIndex, selectedIndex + 1, updateConditions)}
                type="button"
              >
                Move down
              </button>
              <button
                className="button button--ghost"
                onClick={() =>
                  updateConditions(
                    [...conditions.map((condition) => cloneStep(condition)), cloneStep(selectedCondition)],
                    conditions.length
                  )
                }
                type="button"
              >
                Duplicate
              </button>
              <button
                className="button button--danger"
                onClick={() => {
                  updateConditions(
                    conditions.filter((_, index) => index !== selectedIndex).map((condition) => cloneStep(condition)),
                    Math.max(0, selectedIndex - 1)
                  );
                  if (conditions.length <= 1) {
                    setEditorOpen(false);
                  }
                }}
                type="button"
              >
                Remove
              </button>
            </div>

            <ConditionEditor
              condition={selectedCondition}
              onChange={(condition) =>
                updateConditions(
                  conditions.map((entry, index) => (index === selectedIndex ? cloneStep(condition) : cloneStep(entry))),
                  selectedIndex
                )
              }
            />
          </div>
        ) : null}
      </EditorOverlay>
    </div>
  );
}

function ConditionEditor(props: { condition: SequenceStep; onChange: (condition: SequenceStep) => void }) {
  const { condition, onChange } = props;
  const type = classifyCondition(condition);

  return (
    <div className="branch-editor">
      <div className="field-grid">
        <label className="field">
          <span>Condition type</span>
          <select
            onChange={(event) => onChange(preserveCommonStepFields(condition, createConditionTemplate(event.target.value as ConditionType)))}
            value={type}
          >
            {CONDITION_OPTIONS.map((option) => (
              <option key={option.type} value={option.type}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span>Alias</span>
          <input
            onChange={(event) => onChange(setOptionalStringField(condition, "alias", event.target.value))}
            placeholder="Optional condition label"
            type="text"
            value={typeof condition.alias === "string" ? condition.alias : ""}
          />
        </label>
      </div>

      {type === "state" ? (
        <div className="field-grid">
          <label className="field">
            <span>Entity IDs</span>
            <input
              onChange={(event) => onChange(setListishField(condition, "entity_id", event.target.value))}
              placeholder="light.kitchen, switch.patio"
              type="text"
              value={listishToText(condition.entity_id)}
            />
          </label>
          <label className="field">
            <span>State</span>
            <input
              onChange={(event) => onChange(setListishField(condition, "state", event.target.value))}
              placeholder="on"
              type="text"
              value={listishToText(condition.state)}
            />
          </label>
          <label className="field">
            <span>Attribute</span>
            <input
              onChange={(event) => onChange(setOptionalStringField(condition, "attribute", event.target.value))}
              placeholder="brightness"
              type="text"
              value={typeof condition.attribute === "string" ? condition.attribute : ""}
            />
          </label>
          <label className="field">
            <span>For</span>
            <input
              onChange={(event) => onChange(setOptionalStringField(condition, "for", event.target.value))}
              placeholder="00:00:30"
              type="text"
              value={typeof condition.for === "string" ? condition.for : ""}
            />
          </label>
        </div>
      ) : null}

      {type === "numeric_state" ? (
        <div className="field-grid">
          <label className="field">
            <span>Entity IDs</span>
            <input
              onChange={(event) => onChange(setListishField(condition, "entity_id", event.target.value))}
              placeholder="sensor.temperature"
              type="text"
              value={listishToText(condition.entity_id)}
            />
          </label>
          <label className="field">
            <span>Above</span>
            <input
              onChange={(event) => onChange(setOptionalStringField(condition, "above", event.target.value))}
              placeholder="25"
              type="text"
              value={scalarToText(condition.above)}
            />
          </label>
          <label className="field">
            <span>Below</span>
            <input
              onChange={(event) => onChange(setOptionalStringField(condition, "below", event.target.value))}
              placeholder="70"
              type="text"
              value={scalarToText(condition.below)}
            />
          </label>
          <label className="field">
            <span>Attribute</span>
            <input
              onChange={(event) => onChange(setOptionalStringField(condition, "attribute", event.target.value))}
              placeholder="power"
              type="text"
              value={typeof condition.attribute === "string" ? condition.attribute : ""}
            />
          </label>
        </div>
      ) : null}

      {type === "template" ? (
        <label className="field">
          <span>Value template</span>
          <textarea
            onChange={(event) => onChange(setOptionalStringField(condition, "value_template", event.target.value))}
            rows={5}
            value={typeof condition.value_template === "string" ? condition.value_template : ""}
          />
        </label>
      ) : null}

      {type === "time" ? (
        <div className="field-grid">
          <label className="field">
            <span>After</span>
            <input
              onChange={(event) => onChange(setOptionalStringField(condition, "after", event.target.value))}
              placeholder="23:00:00"
              type="text"
              value={typeof condition.after === "string" ? condition.after : ""}
            />
          </label>
          <label className="field">
            <span>Before</span>
            <input
              onChange={(event) => onChange(setOptionalStringField(condition, "before", event.target.value))}
              placeholder="07:00:00"
              type="text"
              value={typeof condition.before === "string" ? condition.before : ""}
            />
          </label>
          <label className="field">
            <span>Weekdays</span>
            <input
              onChange={(event) => onChange(setListishField(condition, "weekday", event.target.value))}
              placeholder="mon, tue, wed"
              type="text"
              value={listishToText(condition.weekday)}
            />
          </label>
        </div>
      ) : null}

      {type === "trigger" ? (
        <label className="field">
          <span>Trigger IDs</span>
          <input
            onChange={(event) => onChange(setListishField(condition, "id", event.target.value))}
            placeholder="button_press"
            type="text"
            value={listishToText(condition.id)}
          />
        </label>
      ) : null}

      {type === "zone" ? (
        <div className="field-grid">
          <label className="field">
            <span>Entity IDs</span>
            <input
              onChange={(event) => onChange(setListishField(condition, "entity_id", event.target.value))}
              placeholder="person.someone"
              type="text"
              value={listishToText(condition.entity_id)}
            />
          </label>
          <label className="field">
            <span>Zone</span>
            <input
              onChange={(event) => onChange(setOptionalStringField(condition, "zone", event.target.value))}
              placeholder="zone.home"
              type="text"
              value={typeof condition.zone === "string" ? condition.zone : ""}
            />
          </label>
          <label className="field">
            <span>Event</span>
            <select
              onChange={(event) => onChange(setOptionalStringField(condition, "event", event.target.value))}
              value={typeof condition.event === "string" ? condition.event : ""}
            >
              <option value="">Any</option>
              <option value="enter">enter</option>
              <option value="leave">leave</option>
            </select>
          </label>
        </div>
      ) : null}

      {type === "sun" ? (
        <div className="field-grid">
          <label className="field">
            <span>After</span>
            <input
              onChange={(event) => onChange(setOptionalStringField(condition, "after", event.target.value))}
              placeholder="sunset"
              type="text"
              value={typeof condition.after === "string" ? condition.after : ""}
            />
          </label>
          <label className="field">
            <span>Before</span>
            <input
              onChange={(event) => onChange(setOptionalStringField(condition, "before", event.target.value))}
              placeholder="sunrise"
              type="text"
              value={typeof condition.before === "string" ? condition.before : ""}
            />
          </label>
          <label className="field">
            <span>After offset</span>
            <input
              onChange={(event) => onChange(setOptionalStringField(condition, "after_offset", event.target.value))}
              placeholder="00:30:00"
              type="text"
              value={typeof condition.after_offset === "string" ? condition.after_offset : ""}
            />
          </label>
          <label className="field">
            <span>Before offset</span>
            <input
              onChange={(event) => onChange(setOptionalStringField(condition, "before_offset", event.target.value))}
              placeholder="00:30:00"
              type="text"
              value={typeof condition.before_offset === "string" ? condition.before_offset : ""}
            />
          </label>
        </div>
      ) : null}

      {type === "and" || type === "or" || type === "not" ? (
        <ConditionListEditor
          conditions={asSequence(condition.conditions)}
          label={`${type.toUpperCase()} children`}
          onChange={(conditions) => onChange(setSequenceField(condition, "conditions", conditions))}
        />
      ) : null}

      <details className="yaml-panel">
        <summary>Condition YAML</summary>
        <YamlFieldEditor
          buttonLabel="Apply condition YAML"
          label="Condition YAML"
          onApply={onChange}
          rows={10}
          validate={parseSequenceStep}
          value={condition}
        />
      </details>
    </div>
  );
}

function TriggerListEditor(props: TriggerListEditorProps) {
  const { label, onChange, triggers } = props;
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [editorOpen, setEditorOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const selectedTrigger = triggers[selectedIndex] ?? null;

  useEffect(() => {
    if (triggers.length === 0) {
      setSelectedIndex(0);
      setEditorOpen(false);
      return;
    }
    if (selectedIndex >= triggers.length) {
      setSelectedIndex(triggers.length - 1);
    }
  }, [selectedIndex, triggers.length]);

  function updateTriggers(nextTriggers: SequenceStep[], nextSelectedIndex = selectedIndex): void {
    onChange(nextTriggers.map((trigger) => cloneStep(trigger)));
    setSelectedIndex(Math.max(0, Math.min(nextSelectedIndex, nextTriggers.length - 1)));
  }

  return (
    <div className="stack-card">
      <div className="step-builder__toolbar">
        <div>
          <p className="eyebrow">{label}</p>
          <h4>{triggers.length} trigger{triggers.length === 1 ? "" : "s"}</h4>
        </div>
        <div className="step-builder__toolbar-actions">
          {triggers.length > 0 ? <span className="pill pill--muted">Wait logic stays compact until opened</span> : null}
          <button className="button button--ghost" onClick={() => setPickerOpen(true)} type="button">
            Add trigger
          </button>
        </div>
      </div>

      <div className="condition-list">
        {triggers.length === 0 ? <div className="empty-state">No wait triggers yet.</div> : null}
        {triggers.map((trigger, index) => (
          <button
            className={`sequence-card ${index === selectedIndex ? "sequence-card--selected" : ""}`}
            key={`trigger-${index}`}
            onClick={() => {
              setSelectedIndex(index);
              setEditorOpen(true);
            }}
            type="button"
          >
            <span>Trigger {index + 1}</span>
            <strong>{summarizeTrigger(trigger)}</strong>
          </button>
        ))}
      </div>

      <PickerDialog
        description="Pick the trigger type first, then fill in the details in a focused dialog."
        emptyText="No matching triggers."
        eyebrow="Trigger library"
        onClose={() => setPickerOpen(false)}
        onPick={(choice) => {
          updateTriggers([...triggers.map((trigger) => cloneStep(trigger)), createTriggerTemplate(choice as TriggerType)], triggers.length);
          setPickerOpen(false);
          setEditorOpen(true);
        }}
        open={pickerOpen}
        options={TRIGGER_OPTIONS.map((option) => ({
          detail: option.detail,
          id: option.type,
          label: option.label
        }))}
        title="Add trigger"
      />

      <EditorOverlay
        eyebrow="Trigger editor"
        mode="dialog"
        onClose={() => setEditorOpen(false)}
        open={editorOpen && Boolean(selectedTrigger)}
        subtitle={selectedTrigger ? summarizeTrigger(selectedTrigger) : undefined}
        title={`Trigger ${selectedIndex + 1}`}
      >
        {selectedTrigger ? (
          <div className="stack-card">
            <div className="inline-actions">
              <button
                className="button button--ghost"
                disabled={selectedIndex === 0}
                onClick={() => moveSequenceEntry(triggers, selectedIndex, selectedIndex - 1, updateTriggers)}
                type="button"
              >
                Move up
              </button>
              <button
                className="button button--ghost"
                disabled={selectedIndex >= triggers.length - 1}
                onClick={() => moveSequenceEntry(triggers, selectedIndex, selectedIndex + 1, updateTriggers)}
                type="button"
              >
                Move down
              </button>
              <button
                className="button button--danger"
                onClick={() => {
                  updateTriggers(
                    triggers.filter((_, index) => index !== selectedIndex).map((trigger) => cloneStep(trigger)),
                    Math.max(0, selectedIndex - 1)
                  );
                  if (triggers.length <= 1) {
                    setEditorOpen(false);
                  }
                }}
                type="button"
              >
                Remove
              </button>
            </div>

            <TriggerEditor
              onChange={(trigger) =>
                updateTriggers(
                  triggers.map((entry, index) => (index === selectedIndex ? cloneStep(trigger) : cloneStep(entry))),
                  selectedIndex
                )
              }
              trigger={selectedTrigger}
            />
          </div>
        ) : null}
      </EditorOverlay>
    </div>
  );
}

function TriggerEditor(props: { onChange: (trigger: SequenceStep) => void; trigger: SequenceStep }) {
  const { onChange, trigger } = props;
  const type = classifyTrigger(trigger);

  return (
    <div className="branch-editor">
      <label className="field">
        <span>Trigger type</span>
        <select
          onChange={(event) => onChange(preserveCommonStepFields(trigger, createTriggerTemplate(event.target.value as TriggerType)))}
          value={type}
        >
          {TRIGGER_OPTIONS.map((option) => (
            <option key={option.type} value={option.type}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      {type === "state" ? (
        <div className="field-grid">
          <label className="field">
            <span>Entity IDs</span>
            <input
              onChange={(event) => onChange(setListishField(trigger, "entity_id", event.target.value))}
              placeholder="binary_sensor.motion"
              type="text"
              value={listishToText(trigger.entity_id)}
            />
          </label>
          <label className="field">
            <span>To</span>
            <input
              onChange={(event) => onChange(setListishField(trigger, "to", event.target.value))}
              placeholder="on"
              type="text"
              value={listishToText(trigger.to)}
            />
          </label>
          <label className="field">
            <span>From</span>
            <input
              onChange={(event) => onChange(setListishField(trigger, "from", event.target.value))}
              placeholder="off"
              type="text"
              value={listishToText(trigger.from)}
            />
          </label>
          <label className="field">
            <span>For</span>
            <input
              onChange={(event) => onChange(setOptionalStringField(trigger, "for", event.target.value))}
              placeholder="00:00:30"
              type="text"
              value={typeof trigger.for === "string" ? trigger.for : ""}
            />
          </label>
        </div>
      ) : null}

      {type === "event" ? (
        <>
          <label className="field">
            <span>Event type</span>
            <input
              onChange={(event) => onChange(setOptionalStringField(trigger, "event_type", event.target.value))}
              placeholder="timer.finished"
              type="text"
              value={typeof trigger.event_type === "string" ? trigger.event_type : ""}
            />
          </label>
          <YamlFieldEditor
            buttonLabel="Apply event data"
            label="Event data"
            onApply={(eventData) => onChange(setObjectField(trigger, "event_data", eventData))}
            rows={6}
            validate={parseYamlRecord}
            value={isRecord(trigger.event_data) ? trigger.event_data : {}}
          />
        </>
      ) : null}

      {type === "time" ? (
        <label className="field">
          <span>At</span>
          <input
            onChange={(event) => onChange(setOptionalStringField(trigger, "at", event.target.value))}
            placeholder="23:00:00"
            type="text"
            value={typeof trigger.at === "string" ? trigger.at : ""}
          />
        </label>
      ) : null}

      {type === "homeassistant" ? (
        <label className="field">
          <span>Event</span>
          <select
            onChange={(event) => onChange(setOptionalStringField(trigger, "event", event.target.value))}
            value={typeof trigger.event === "string" ? trigger.event : "start"}
          >
            <option value="start">start</option>
            <option value="shutdown">shutdown</option>
          </select>
        </label>
      ) : null}

      {type === "template" ? (
        <label className="field">
          <span>Value template</span>
          <textarea
            onChange={(event) => onChange(setOptionalStringField(trigger, "value_template", event.target.value))}
            rows={5}
            value={typeof trigger.value_template === "string" ? trigger.value_template : ""}
          />
        </label>
      ) : null}

      <details className="yaml-panel">
        <summary>Trigger YAML</summary>
        <YamlFieldEditor
          buttonLabel="Apply trigger YAML"
          label="Trigger YAML"
          onApply={onChange}
          rows={10}
          validate={parseSequenceStep}
          value={trigger}
        />
      </details>
    </div>
  );
}

function NumberField(props: { label: string; min?: number; onChange: (value: number) => void; value: number }) {
  const { label, min = 0, onChange, value } = props;
  return (
    <label className="field">
      <span>{label}</span>
      <input
        min={min}
        onChange={(event) => onChange(Number.parseInt(event.target.value || "0", 10) || 0)}
        type="number"
        value={value}
      />
    </label>
  );
}

function InlineToggle(props: { active: boolean; description: string; label: string; onToggle: () => void }) {
  const { active, description, label, onToggle } = props;
  return (
    <div className="inline-toggle">
      <div>
        <strong>{label}</strong>
        <p>{description}</p>
      </div>
      <button className={`toggle ${active ? "toggle--on" : ""}`} onClick={onToggle} type="button">
        <span />
      </button>
    </div>
  );
}

function YamlFieldEditor<T>(props: {
  buttonLabel: string;
  label: string;
  onApply: (value: T) => void;
  rows?: number;
  validate: (parsed: unknown) => T;
  value: unknown;
}) {
  const { buttonLabel, label, onApply, rows = 8, validate, value } = props;
  const [committedYaml, setCommittedYaml] = useState(() => formatYaml(value));
  const [text, setText] = useState(committedYaml);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const formatted = formatYaml(value);
    if (formatted !== committedYaml) {
      setCommittedYaml(formatted);
      setText(formatted);
      setError(null);
    }
  }, [value, committedYaml]);

  return (
    <label className="field">
      <span>{label}</span>
      <textarea onChange={(event) => setText(event.target.value)} rows={rows} value={text} />
      <div className="inline-actions">
        <button
          className="button button--ghost"
          onClick={() => {
            try {
              const parsed = validate(parseYaml(text));
              onApply(parsed);
              setError(null);
            } catch (nextError) {
              setError(errorMessage(nextError));
            }
          }}
          type="button"
        >
          {buttonLabel}
        </button>
        {error ? <span className="inline-error">{error}</span> : null}
      </div>
    </label>
  );
}

