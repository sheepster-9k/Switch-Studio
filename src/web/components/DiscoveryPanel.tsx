import { useDeferredValue, useState } from "react";

import type { DiscoveryCandidate, SwitchManagerBlueprint } from "../../shared/types";

interface DiscoveryPanelProps {
  blueprintsById: Map<string, SwitchManagerBlueprint>;
  candidates: DiscoveryCandidate[];
  onUseCandidate: (candidate: DiscoveryCandidate, blueprintId: string) => void;
}

export function DiscoveryPanel(props: DiscoveryPanelProps) {
  const { blueprintsById, candidates, onUseCandidate } = props;
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const filteredCandidates = candidates.filter((candidate) => {
    const query = deferredSearch.trim().toLowerCase();
    if (!query) {
      return true;
    }
    const blueprintNames = candidate.suggestedBlueprintIds
      .map((blueprintId) => blueprintsById.get(blueprintId)?.name ?? blueprintId)
      .join(" ");
    return [
      candidate.name,
      candidate.manufacturer ?? "",
      candidate.model ?? "",
      candidate.probableProtocol ?? "",
      blueprintNames,
      candidate.relatedAutomationIds.join(" ")
    ]
      .join(" ")
      .toLowerCase()
      .includes(query);
  });

  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <p className="eyebrow">Discovery</p>
          <h3>Switch Candidates</h3>
        </div>
        <span className="pill">{candidates.length} found</span>
      </div>

      <p className="panel-copy">
        Discovery stays separate from the main editor now. Review probable blueprints here, then create a draft and return to the editor with one click.
      </p>

      <label className="field">
        <span>Filter candidates</span>
        <input
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search name, model, protocol, or suggested blueprint"
          type="search"
          value={search}
        />
      </label>

      <p className="panel-copy">
        Showing {filteredCandidates.length} of {candidates.length} discovered switches.
      </p>

      <div className="stack-list">
        {filteredCandidates.length === 0 ? (
          <div className="stack-card">
            <strong>No discovery results in this view</strong>
            <p>Try a different search or refresh the Home Assistant snapshot.</p>
          </div>
        ) : null}

        {filteredCandidates.map((candidate) => {
          const topBlueprintId = candidate.suggestedBlueprintIds[0] ?? "";
          const topBlueprint = topBlueprintId ? blueprintsById.get(topBlueprintId) ?? null : null;

          return (
            <div className="stack-card" key={candidate.id}>
              <div className="stack-card__top">
                <div>
                  <strong>{candidate.name}</strong>
                  <p>
                    {[candidate.manufacturer, candidate.model, candidate.probableProtocol]
                      .filter(Boolean)
                      .join(" / ") || candidate.id}
                  </p>
                </div>
                {topBlueprint ? (
                  <button
                    className="button"
                    onClick={() => onUseCandidate(candidate, topBlueprint.id)}
                    type="button"
                  >
                    Create Draft
                  </button>
                ) : null}
              </div>

              <div className="target-chips">
                {candidate.suggestedBlueprintIds.length === 0 ? (
                  <span className="muted-chip">No blueprint match yet</span>
                ) : null}
                {candidate.suggestedBlueprintIds.map((blueprintId) => (
                  <span className="pill" key={`${candidate.id}-${blueprintId}`}>
                    {blueprintsById.get(blueprintId)?.name ?? blueprintId}
                  </span>
                ))}
              </div>

              {candidate.relatedAutomationIds.length > 0 ? (
                <p className="stack-card__meta">
                  Related automations: {candidate.relatedAutomationIds.join(", ")}
                </p>
              ) : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}
