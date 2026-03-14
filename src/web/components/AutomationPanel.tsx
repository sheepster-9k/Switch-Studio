import { useDeferredValue, useEffect, useState } from "react";

import type { AutomationSummary, SwitchManagerConfig } from "../../shared/types";

interface AutomationPanelProps {
  automations: AutomationSummary[];
  draft: SwitchManagerConfig | null;
  filterConfigId: string | null;
  importTargetLabel: string;
  onExportCurrent: () => void;
  onImportAutomation: (automation: AutomationSummary) => void;
}

export function AutomationPanel(props: AutomationPanelProps) {
  const { automations, draft, filterConfigId, importTargetLabel, onExportCurrent, onImportAutomation } = props;
  const [search, setSearch] = useState("");
  const [showAll, setShowAll] = useState(false);
  const deferredSearch = useDeferredValue(search);

  useEffect(() => {
    setShowAll(false);
  }, [filterConfigId]);

  const scopedAutomations =
    filterConfigId && !showAll
      ? automations.filter((automation) => automation.matchedConfigId === filterConfigId)
      : automations;

  const filteredAutomations = scopedAutomations.filter((automation) => {
    const query = deferredSearch.trim().toLowerCase();
    if (!query) {
      return true;
    }
    return [automation.alias, automation.description ?? "", automation.matchSummary ?? automation.id]
      .join(" ")
      .toLowerCase()
      .includes(query);
  });

  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <p className="eyebrow">Automations</p>
          <h3>Import / Export</h3>
        </div>
        <button className="button" disabled={!draft} onClick={onExportCurrent} type="button">
          Export current action
        </button>
      </div>

      <p className="panel-copy">
        Import copies the selected automation action sequence into {importTargetLabel}. Export creates a native Home Assistant automation triggered by the normalized <code>switch_manager_action</code> event.
      </p>

      <div className="toggle-strip">
        <div className="inline-toggle">
          <div>
            <strong>Current switch only</strong>
            <p>
              {draft?.name
                ? `Show automation matches for ${draft.name} first.`
                : "Select a switch first."}
            </p>
          </div>
          <button
            className={`toggle ${!showAll && filterConfigId ? "toggle--on" : ""}`}
            disabled={!filterConfigId}
            onClick={() => setShowAll((current) => !current)}
            type="button"
          >
            <span />
          </button>
        </div>
      </div>

      <label className="field">
        <span>Filter automations</span>
        <input
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search alias, description, or inferred match"
          type="search"
          value={search}
        />
      </label>

      <p className="panel-copy">
        Showing {filteredAutomations.length} of {scopedAutomations.length} automations
        {!showAll && filterConfigId && draft?.name ? ` matched to ${draft.name}` : ""}.
      </p>

      <div className="stack-list">
        {filteredAutomations.length === 0 ? (
          <div className="stack-card">
            <strong>No automations in this view</strong>
            <p>
              {!showAll && filterConfigId
                ? "No matched automations for the active switch. Turn off the filter to browse all automations."
                : "Try a different search or select a switch first."}
            </p>
          </div>
        ) : null}
        {filteredAutomations.map((automation) => (
          <div className="stack-card" key={automation.id}>
            <div className="stack-card__top">
              <div>
                <strong>{automation.alias}</strong>
                <p>{automation.matchSummary ?? automation.id}</p>
              </div>
              <button
                className="button"
                disabled={automation.actions.length === 0}
                onClick={() => onImportAutomation(automation)}
                type="button"
              >
                Import
              </button>
            </div>
            {automation.description ? <p className="stack-card__meta">{automation.description}</p> : null}
            {automation.actions.length === 0 ? (
              <p className="stack-card__meta">This automation has no importable action sequence.</p>
            ) : null}
          </div>
        ))}
      </div>
    </section>
  );
}
