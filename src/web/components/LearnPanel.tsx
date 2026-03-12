import type { LearnedEvent, LearningLibraryResponse, SwitchManagerBlueprint, SwitchManagerConfig } from "../../shared/types";

interface LearnPanelProps {
  draft: SwitchManagerConfig | null;
  learning: LearningLibraryResponse | null;
  selectedBlueprint: SwitchManagerBlueprint | null;
  onApplyIdentifier: (identifier: string) => void;
  onClear: () => void;
  onStart: () => void;
  onStop: () => void;
}

function summarizeLearnedEvent(event: LearnedEvent): string {
  const parts = [
    event.identifier,
    typeof event.button === "number" ? `Button ${event.button + 1}` : null,
    event.actionTitle,
    typeof event.pressCount === "number" ? `${event.pressCount}x` : null
  ];
  return parts.filter(Boolean).join(" / ");
}

export function LearnPanel(props: LearnPanelProps) {
  const { draft, learning, selectedBlueprint, onApplyIdentifier, onClear, onStart, onStop } = props;
  const active = learning?.activeSession?.active ?? false;

  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <p className="eyebrow">Teach</p>
          <h3>Learn Switch Presses</h3>
        </div>
        <span className={`pill ${active ? "pill--ok" : "pill--muted"}`}>{active ? "Listening" : "Idle"}</span>
      </div>

      <p className="panel-copy">
        {draft && selectedBlueprint
          ? `Listening against ${selectedBlueprint.name}${draft.identifier ? ` for identifier ${draft.identifier}` : ""}.`
          : "Select or create a draft first, then start learning to capture raw switch presses and identifiers."}
      </p>

      <div className="inline-actions">
        <button className="button" disabled={!draft || !selectedBlueprint || active} onClick={onStart} type="button">
          Start learn
        </button>
        <button className="button" disabled={!active} onClick={onStop} type="button">
          Stop
        </button>
        <button className="button" disabled={!learning?.events.length} onClick={onClear} type="button">
          Clear library
        </button>
      </div>

      <div className="stack-list">
        {(learning?.events ?? []).slice(0, 12).map((event) => (
          <div className="stack-card" key={`${event.capturedAt}-${event.identifier}-${event.button}-${event.action}`}>
            <div className="stack-card__top">
              <div>
                <strong>{summarizeLearnedEvent(event)}</strong>
                <p>{new Date(event.capturedAt).toLocaleString()}</p>
              </div>
              {event.identifier ? (
                <button className="button" onClick={() => onApplyIdentifier(event.identifier ?? "")} type="button">
                  Use ID
                </button>
              ) : null}
            </div>
            <pre className="raw-block">{JSON.stringify(event.data, null, 2)}</pre>
          </div>
        ))}
      </div>
    </section>
  );
}
