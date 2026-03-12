import { useDeferredValue, useEffect, useMemo, useState, type ReactNode } from "react";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

import type {
  DeviceSummary,
  EntitySummary,
  JsonMap,
  SequenceStep,
  StudioSnapshot,
  SwitchManagerBlueprint,
  SwitchManagerConfig,
  TargetKind
} from "../../shared/types";
import {
  cloneStep,
  isRecord,
  matchesSearch,
  selectedTargetIds,
  stepTargetKind,
  summarizeStep,
  targetLabel,
  updateStepTarget
} from "../helpers";

type StepTemplateKind =
  | "action"
  | "condition"
  | "delay"
  | "event"
  | "if"
  | "parallel"
  | "raw"
  | "sequence"
  | "stop"
  | "variables"
  | "wait_for_trigger"
  | "choose";

type StepKind =
  | StepTemplateKind
  | "device_action"
  | "repeat"
  | "unsupported"
  | "wait_template";

type ConditionType =
  | "and"
  | "not"
  | "numeric_state"
  | "or"
  | "raw"
  | "state"
  | "sun"
  | "template"
  | "time"
  | "trigger"
  | "zone";

type TriggerType = "event" | "homeassistant" | "raw" | "state" | "template" | "time";

interface TargetOption {
  detail: string;
  id: string;
  label: string;
}

interface DurationParts {
  hours: number;
  milliseconds: number;
  minutes: number;
  seconds: number;
}

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

const ZERO_DURATION: DurationParts = {
  hours: 0,
  milliseconds: 0,
  minutes: 0,
  seconds: 0
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

  return (
    <section className="panel panel--editor">
      <div className="panel-head">
        <div>
          <p className="eyebrow">Mapping</p>
          <h3>Button {selectedButtonIndex + 1}</h3>
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
        <div className="empty-state">This button has no action slots.</div>
      )}
    </section>
  );
}

function SequenceListEditor(props: SequenceListEditorProps) {
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
    if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0 || fromIndex >= sequence.length || toIndex >= sequence.length) {
      return;
    }
    const nextSequence = sequence.map((entry) => cloneStep(entry));
    const [moved] = nextSequence.splice(fromIndex, 1);
    nextSequence.splice(toIndex, 0, moved);
    commit(nextSequence, toIndex);
  }

  return (
    <div className={`step-builder ${depth > 0 ? "step-builder--nested" : ""}`}>
      <div className="step-builder__toolbar">
        <div>
          <p className="eyebrow">{label}</p>
          <h4>{sequence.length} step{sequence.length === 1 ? "" : "s"}</h4>
        </div>
        <div className="step-builder__toolbar-actions">
          {sequence.length > 0 ? <span className="pill pill--muted">Cards stay collapsed until you edit one</span> : null}
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
                  <span className="pill pill--muted">{STEP_KIND_LABELS[kind]}</span>
                  {alias ? <span className="muted-chip">{alias}</span> : null}
                </div>
              </button>
            </div>
          );
        })}
      </div>

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
  const [selectedBranchIndex, setSelectedBranchIndex] = useState(0);
  const safeBranchIndex = branches.length === 0 ? 0 : Math.min(selectedBranchIndex, branches.length - 1);
  const selectedBranch = branches[safeBranchIndex] ?? null;

  useEffect(() => {
    if (safeBranchIndex !== selectedBranchIndex) {
      setSelectedBranchIndex(safeBranchIndex);
    }
  }, [safeBranchIndex, selectedBranchIndex]);

  function updateBranches(nextBranches: Array<Record<string, unknown>>, nextSelectedIndex = safeBranchIndex): void {
    const nextStep = cloneStep(step);
    nextStep.choose = nextBranches;
    onChange(nextStep);
    setSelectedBranchIndex(Math.max(0, Math.min(nextSelectedIndex, nextBranches.length - 1)));
  }

  function updateBranch(index: number, updater: (branch: Record<string, unknown>) => Record<string, unknown>): void {
    const nextBranches = branches.map((branch, branchIndex) =>
      branchIndex === index ? updater(structuredCloneBranch(branch)) : structuredCloneBranch(branch)
    );
    updateBranches(nextBranches, index);
  }

  return (
    <div className="branch-editor">
      <div className="step-builder__toolbar">
        <div>
          <p className="eyebrow">Choose branches</p>
          <h4>{branches.length} branch{branches.length === 1 ? "" : "es"}</h4>
        </div>
        <button
          className="button"
          onClick={() => {
            const nextBranches = [...branches.map((branch) => structuredCloneBranch(branch)), createChooseBranchTemplate()];
            updateBranches(nextBranches, nextBranches.length - 1);
          }}
          type="button"
        >
          Add branch
        </button>
      </div>

      <div className="branch-tabs">
        {branches.length === 0 ? <div className="empty-state">No branches yet. Add one to begin.</div> : null}
        {branches.map((branch, index) => (
          <button
            className={`action-tab ${index === safeBranchIndex ? "action-tab--selected" : ""}`}
            key={`branch-${index}`}
            onClick={() => setSelectedBranchIndex(index)}
            type="button"
          >
            <strong>{branch.alias && typeof branch.alias === "string" ? branch.alias : `Branch ${index + 1}`}</strong>
            <span>{asSequence(branch.sequence).length} steps</span>
          </button>
        ))}
      </div>

      {selectedBranch ? (
        <div className="stack-card">
          <div className="step-editor__head">
            <div>
              <p className="eyebrow">Selected branch</p>
              <h4>{selectedBranch.alias && typeof selectedBranch.alias === "string" ? selectedBranch.alias : `Branch ${safeBranchIndex + 1}`}</h4>
            </div>
            <div className="inline-actions">
              <button
                className="button button--ghost"
                disabled={safeBranchIndex === 0}
                onClick={() => moveArrayEntry(branches, safeBranchIndex, safeBranchIndex - 1, updateBranches)}
                type="button"
              >
                Move up
              </button>
              <button
                className="button button--ghost"
                disabled={safeBranchIndex >= branches.length - 1}
                onClick={() => moveArrayEntry(branches, safeBranchIndex, safeBranchIndex + 1, updateBranches)}
                type="button"
              >
                Move down
              </button>
              <button
                className="button button--danger"
                onClick={() => {
                  const nextBranches = branches.filter((_, index) => index !== safeBranchIndex).map((branch) => structuredCloneBranch(branch));
                  updateBranches(nextBranches, Math.max(0, safeBranchIndex - 1));
                }}
                type="button"
              >
                Remove branch
              </button>
            </div>
          </div>

          <label className="field">
            <span>Branch alias</span>
            <input
              onChange={(event) =>
                updateBranch(safeBranchIndex, (branch) => setOptionalStringField(branch, "alias", event.target.value))
              }
              placeholder="Optional branch label"
              type="text"
              value={typeof selectedBranch.alias === "string" ? selectedBranch.alias : ""}
            />
          </label>

          <ConditionListEditor
            conditions={asSequence(selectedBranch.conditions)}
            label="Branch conditions"
            onChange={(conditions) =>
              updateBranch(safeBranchIndex, (branch) => setSequenceField(branch, "conditions", conditions))
            }
          />

          <SequenceContainerEditor
            devicesById={devicesById}
            entitiesById={entitiesById}
            label="Branch steps"
            onChange={(sequence) =>
              updateBranch(safeBranchIndex, (branch) => setSequenceField(branch, "sequence", sequence))
            }
            sequence={asSequence(selectedBranch.sequence)}
            snapshot={snapshot}
          />
        </div>
      ) : null}

      <SequenceContainerEditor
        devicesById={devicesById}
        entitiesById={entitiesById}
        label="Default branch"
        onChange={(sequence) => onChange(setSequenceField(step, "default", sequence))}
        sequence={asSequence(step.default)}
        snapshot={snapshot}
      />
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
              placeholder="person.chris"
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
  const [text, setText] = useState(formatYaml(value));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setText(formatYaml(value));
    setError(null);
  }, [value]);

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
              setError(nextError instanceof Error ? nextError.message : String(nextError));
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

function buildTargetOptions(snapshot: StudioSnapshot | null, targetKind: TargetKind, search: string): TargetOption[] {
  const trimmedSearch = search.trim().toLowerCase();
  if (!snapshot) {
    return [];
  }
  if (targetKind === "device") {
    return snapshot.devices
      .filter((device) =>
        !trimmedSearch
          ? true
          : [device.name, device.manufacturer ?? "", device.model ?? "", device.id].some((value) =>
              matchesSearch(value, trimmedSearch)
            )
      )
      .slice(0, 50)
      .map((device) => ({
        id: device.id,
        label: device.name,
        detail: [device.manufacturer, device.model].filter(Boolean).join(" / ") || device.id
      }));
  }
  if (targetKind === "area") {
    return snapshot.areas
      .filter((area) =>
        !trimmedSearch ? true : [area.name, area.id, ...area.aliases].some((value) => matchesSearch(value, trimmedSearch))
      )
      .slice(0, 50)
      .map((area) => ({
        id: area.id,
        label: area.name,
        detail: area.aliases.join(", ") || area.id
      }));
  }
  return snapshot.entities
    .filter((entity) =>
      !trimmedSearch
        ? !entity.disabled
        : [entity.name, entity.entityId, entity.domain, entity.state ?? ""].some((value) =>
            matchesSearch(value, trimmedSearch)
          )
    )
    .slice(0, 80)
    .map((entity) => ({
      id: entity.entityId,
      label: entity.name,
      detail: `${entity.entityId}${entity.state ? ` / ${entity.state}` : ""}`
    }));
}

function pluralizeTargetKind(targetKind: TargetKind): string {
  if (targetKind === "entity") {
    return "entities";
  }
  if (targetKind === "area") {
    return "areas";
  }
  return "devices";
}

function createStepTemplate(kind: StepTemplateKind): SequenceStep {
  switch (kind) {
    case "action":
      return createServiceTemplate();
    case "condition":
      return createConditionTemplate("state");
    case "delay":
      return { delay: { seconds: 1 } };
    case "event":
      return { event: "switch_manager_action", event_data: {} };
    case "if":
      return { if: [createConditionTemplate("state")], then: [createServiceTemplate()], else: [] };
    case "parallel":
      return { parallel: [createServiceTemplate(), createServiceTemplate("script.turn_on")] };
    case "sequence":
      return { sequence: [createServiceTemplate()] };
    case "stop":
      return { stop: "Stop sequence" };
    case "variables":
      return { variables: {} };
    case "wait_for_trigger":
      return { wait_for_trigger: [createTriggerTemplate("state")], timeout: { seconds: 30 } };
    case "choose":
      return { choose: [createChooseBranchTemplate()], default: [] };
    case "raw":
    default:
      return {};
  }
}

function createServiceTemplate(service = "light.toggle"): SequenceStep {
  return {
    action: service,
    data: {},
    metadata: {},
    target: {}
  };
}

function createChooseBranchTemplate(): Record<string, unknown> {
  return {
    alias: "Branch 1",
    conditions: [createConditionTemplate("state")],
    sequence: [createServiceTemplate()]
  };
}

function createConditionTemplate(type: ConditionType): SequenceStep {
  switch (type) {
    case "template":
      return { condition: "template", value_template: "{{ true }}" };
    case "numeric_state":
      return { condition: "numeric_state", entity_id: "", above: "0" };
    case "time":
      return { condition: "time", after: "18:00:00", before: "23:00:00" };
    case "trigger":
      return { condition: "trigger", id: "trigger_id" };
    case "and":
      return { condition: "and", conditions: [createConditionTemplate("state")] };
    case "or":
      return { condition: "or", conditions: [createConditionTemplate("state"), createConditionTemplate("template")] };
    case "not":
      return { condition: "not", conditions: [createConditionTemplate("state")] };
    case "zone":
      return { condition: "zone", entity_id: "person.chris", zone: "zone.home", event: "enter" };
    case "sun":
      return { condition: "sun", after: "sunset" };
    case "raw":
      return {};
    case "state":
    default:
      return { condition: "state", entity_id: "", state: "on" };
  }
}

function createTriggerTemplate(type: TriggerType): SequenceStep {
  switch (type) {
    case "event":
      return { trigger: "event", event_type: "timer.finished", event_data: {} };
    case "homeassistant":
      return { trigger: "homeassistant", event: "start" };
    case "template":
      return { trigger: "template", value_template: "{{ true }}" };
    case "time":
      return { trigger: "time", at: "23:00:00" };
    case "raw":
      return {};
    case "state":
    default:
      return { trigger: "state", entity_id: "", to: "on" };
  }
}

function classifyStep(step: SequenceStep): StepKind {
  if (typeof step.action === "string") {
    return "action";
  }
  if (Array.isArray(step.choose)) {
    return "choose";
  }
  if (Array.isArray(step.if)) {
    return "if";
  }
  if (step.delay !== undefined) {
    return "delay";
  }
  if (typeof step.condition === "string") {
    return "condition";
  }
  if (Array.isArray(step.parallel)) {
    return "parallel";
  }
  if (Array.isArray(step.sequence)) {
    return "sequence";
  }
  if (step.variables !== undefined) {
    return "variables";
  }
  if (step.wait_for_trigger !== undefined) {
    return "wait_for_trigger";
  }
  if (step.wait_template !== undefined) {
    return "wait_template";
  }
  if (step.stop !== undefined) {
    return "stop";
  }
  if (step.event !== undefined) {
    return "event";
  }
  if (step.repeat !== undefined) {
    return "repeat";
  }
  if (step.device_id && step.type && step.domain) {
    return "device_action";
  }
  return "unsupported";
}

function classifyCondition(condition: SequenceStep): ConditionType {
  if (typeof condition.condition === "string") {
    if (
      condition.condition === "and" ||
      condition.condition === "not" ||
      condition.condition === "numeric_state" ||
      condition.condition === "or" ||
      condition.condition === "state" ||
      condition.condition === "sun" ||
      condition.condition === "template" ||
      condition.condition === "time" ||
      condition.condition === "trigger" ||
      condition.condition === "zone"
    ) {
      return condition.condition;
    }
  }
  return "raw";
}

function classifyTrigger(trigger: SequenceStep): TriggerType {
  const type = typeof trigger.trigger === "string" ? trigger.trigger : typeof trigger.platform === "string" ? trigger.platform : "";
  if (type === "event" || type === "homeassistant" || type === "state" || type === "template" || type === "time") {
    return type;
  }
  return "raw";
}

function isSupportedStepKind(kind: StepKind): kind is StepTemplateKind {
  return (
    kind === "action" ||
    kind === "choose" ||
    kind === "condition" ||
    kind === "delay" ||
    kind === "event" ||
    kind === "if" ||
    kind === "parallel" ||
    kind === "raw" ||
    kind === "sequence" ||
    kind === "stop" ||
    kind === "variables" ||
    kind === "wait_for_trigger"
  );
}

function parseDuration(value: unknown): DurationParts | null {
  if (value === undefined || value === null) {
    return ZERO_DURATION;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return { ...ZERO_DURATION, seconds: value };
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    const match = trimmed.match(/^(?:(\d+):)?(\d{1,2}):(\d{1,2})(?:\.(\d{1,3}))?$/);
    if (!match) {
      return null;
    }
    const hasHours = match[1] !== undefined;
    return {
      hours: hasHours ? Number.parseInt(match[1] ?? "0", 10) : 0,
      milliseconds: Number.parseInt(match[4] ?? "0", 10),
      minutes: Number.parseInt(hasHours ? match[2] : "0", 10),
      seconds: Number.parseInt(hasHours ? match[3] : match[2], 10)
    };
  }
  if (isRecord(value)) {
    return {
      hours: coerceNumericField(value.hours),
      milliseconds: coerceNumericField(value.milliseconds),
      minutes: coerceNumericField(value.minutes),
      seconds: coerceNumericField(value.seconds)
    };
  }
  return null;
}

function coerceNumericField(value: unknown): number {
  if (value === undefined || value === null || value === "") {
    return 0;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && /^\d+$/.test(value.trim())) {
    return Number.parseInt(value, 10);
  }
  return 0;
}

function durationToValue(parts: DurationParts): JsonMap {
  return {
    hours: Math.max(0, parts.hours),
    milliseconds: Math.max(0, parts.milliseconds),
    minutes: Math.max(0, parts.minutes),
    seconds: Math.max(0, parts.seconds)
  };
}

function moveSequenceEntry<T>(items: T[], fromIndex: number, toIndex: number, onChange: (next: T[], nextIndex?: number) => void): void {
  if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0 || fromIndex >= items.length || toIndex >= items.length) {
    return;
  }
  const next = items.map((item) => cloneValue(item));
  const [moved] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, moved);
  onChange(next, toIndex);
}

function moveArrayEntry<T extends Record<string, unknown>>(items: T[], fromIndex: number, toIndex: number, onChange: (next: T[], nextIndex?: number) => void): void {
  moveSequenceEntry(items, fromIndex, toIndex, onChange);
}

function asSequence(value: unknown): SequenceStep[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((entry): entry is SequenceStep => isRecord(entry)).map((entry) => cloneStep(entry));
}

function cloneValue<T>(value: T): T {
  if (typeof structuredClone === "function") {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value)) as T;
}

function structuredCloneBranch(branch: Record<string, unknown>): Record<string, unknown> {
  return cloneValue(branch);
}

function parseYamlRecord(parsed: unknown): Record<string, unknown> {
  if (!isRecord(parsed)) {
    throw new Error("YAML must resolve to an object.");
  }
  return parsed;
}

function parseSequenceStep(parsed: unknown): SequenceStep {
  if (!isRecord(parsed)) {
    throw new Error("Step YAML must resolve to an object.");
  }
  return parsed;
}

function formatYaml(value: unknown): string {
  if (value === undefined) {
    return "{}\n";
  }
  const rendered = stringifyYaml(value);
  return rendered.trim().length > 0 ? rendered : "{}\n";
}

function preserveCommonStepFields(current: SequenceStep, next: SequenceStep): SequenceStep {
  const merged = cloneStep(next);
  (["alias", "continue_on_error", "enabled", "metadata"] as const).forEach((key) => {
    if (current[key] !== undefined) {
      merged[key] = cloneValue(current[key]);
    }
  });
  return merged;
}

function setOptionalStringField<T extends Record<string, unknown>>(entry: T, key: string, value: string): T {
  const next = cloneValue(entry);
  if (value.trim()) {
    next[key] = value;
  } else {
    delete next[key];
  }
  return next;
}

function setBooleanField<T extends Record<string, unknown>>(entry: T, key: string, value: boolean, defaultValue: boolean): T {
  const next = cloneValue(entry);
  if (value === defaultValue) {
    delete next[key];
  } else {
    next[key] = value;
  }
  return next;
}

function setObjectField<T extends Record<string, unknown>>(entry: T, key: string, value: Record<string, unknown>): T {
  const next = cloneValue(entry);
  if (Object.keys(value).length === 0) {
    delete next[key];
  } else {
    next[key] = value;
  }
  return next;
}

function setScalarField<T extends Record<string, unknown>>(entry: T, key: string, value: unknown): T {
  const next = cloneValue(entry);
  if (value === undefined || value === null || value === "") {
    delete next[key];
  } else {
    next[key] = value;
  }
  return next;
}

function setSequenceField<T extends Record<string, unknown>>(entry: T, key: string, sequence: SequenceStep[]): T {
  const next = cloneValue(entry);
  next[key] = sequence.map((step) => cloneStep(step));
  return next;
}

function setListishField<T extends Record<string, unknown>>(entry: T, key: string, value: string): T {
  const next = cloneValue(entry);
  const listish = parseListish(value);
  if (listish === undefined) {
    delete next[key];
  } else {
    next[key] = listish;
  }
  return next;
}

function setYamlValueField<T extends Record<string, unknown>>(entry: T, key: string, value: unknown): T {
  const next = cloneValue(entry);
  if (value === undefined) {
    delete next[key];
  } else {
    next[key] = value;
  }
  return next;
}

function listishToText(value: unknown): string {
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry)).join(", ");
  }
  if (typeof value === "string" || typeof value === "number") {
    return String(value);
  }
  return "";
}

function parseListish(value: string): string | string[] | undefined {
  const parts = value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (parts.length === 0) {
    return undefined;
  }
  if (parts.length === 1) {
    return parts[0];
  }
  return parts;
}

function scalarToText(value: unknown): string {
  if (value === undefined || value === null) {
    return "";
  }
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return "";
}

function summarizeCondition(condition: SequenceStep): string {
  const type = classifyCondition(condition);
  if (type === "state") {
    return `state ${listishToText(condition.entity_id) || "entity"} = ${listishToText(condition.state) || "state"}`;
  }
  if (type === "template") {
    return "template condition";
  }
  if (type === "numeric_state") {
    return `numeric ${listishToText(condition.entity_id) || "entity"}`;
  }
  if (type === "trigger") {
    return `trigger ${listishToText(condition.id) || "id"}`;
  }
  if (type === "and" || type === "or" || type === "not") {
    return `${type.toUpperCase()} group`;
  }
  return "custom condition";
}

function summarizeTrigger(trigger: SequenceStep): string {
  const type = classifyTrigger(trigger);
  if (type === "state") {
    return `state ${listishToText(trigger.entity_id) || "entity"} -> ${listishToText(trigger.to) || "state"}`;
  }
  if (type === "event") {
    return `event ${typeof trigger.event_type === "string" ? trigger.event_type : "event"}`;
  }
  if (type === "time") {
    return `time ${typeof trigger.at === "string" ? trigger.at : "at"}`;
  }
  if (type === "homeassistant") {
    return `homeassistant ${typeof trigger.event === "string" ? trigger.event : "start"}`;
  }
  if (type === "template") {
    return "template trigger";
  }
  return "custom trigger";
}
