import { useDeferredValue, useEffect, useMemo, useState } from "react";

import type { DiscoveryCandidate, SwitchManagerBlueprint } from "../../shared/types";

interface DiscoveryPanelProps {
  blueprintsById: Map<string, SwitchManagerBlueprint>;
  candidates: DiscoveryCandidate[];
  onUseBlueprint: (blueprintId: string) => void;
  onUseCandidate: (candidate: DiscoveryCandidate, blueprintId: string) => void;
}

type DiscoveryMode = "candidate" | "blank";

function countBlueprintActions(blueprint: SwitchManagerBlueprint): number {
  return blueprint.buttons.reduce((total, button) => total + button.actions.length, 0);
}

function discoverySearchText(candidate: DiscoveryCandidate, blueprintsById: Map<string, SwitchManagerBlueprint>): string {
  const blueprintNames = candidate.suggestedBlueprintIds
    .map((blueprintId) => blueprintsById.get(blueprintId)?.name ?? blueprintId)
    .join(" ");

  return [
    candidate.name,
    candidate.manufacturer ?? "",
    candidate.model ?? "",
    candidate.probableProtocol ?? "",
    candidate.suggestedIdentifier,
    blueprintNames,
    candidate.relatedAutomationIds.join(" ")
  ]
    .join(" ")
    .toLowerCase();
}

function protocolLabel(candidate: DiscoveryCandidate): string {
  return [candidate.manufacturer, candidate.model, candidate.probableProtocol].filter(Boolean).join(" / ") || candidate.id;
}

export function DiscoveryPanel(props: DiscoveryPanelProps) {
  const { blueprintsById, candidates, onUseBlueprint, onUseCandidate } = props;
  const [mode, setMode] = useState<DiscoveryMode>("candidate");
  const [candidateSearch, setCandidateSearch] = useState("");
  const [blueprintSearch, setBlueprintSearch] = useState("");
  const deferredCandidateSearch = useDeferredValue(candidateSearch);
  const deferredBlueprintSearch = useDeferredValue(blueprintSearch);

  const filteredCandidates = useMemo(() => {
    const query = deferredCandidateSearch.trim().toLowerCase();
    return candidates.filter((candidate) => (query ? discoverySearchText(candidate, blueprintsById).includes(query) : true));
  }, [blueprintsById, candidates, deferredCandidateSearch]);

  const [selectedCandidateId, setSelectedCandidateId] = useState("");
  const selectedCandidate =
    filteredCandidates.find((candidate) => candidate.id === selectedCandidateId) ??
    candidates.find((candidate) => candidate.id === selectedCandidateId) ??
    filteredCandidates[0] ??
    candidates[0] ??
    null;

  useEffect(() => {
    if (selectedCandidate) {
      setSelectedCandidateId(selectedCandidate.id);
      return;
    }
    setSelectedCandidateId("");
  }, [selectedCandidate?.id]);

  const suggestedBlueprints = useMemo(() => {
    if (!selectedCandidate) {
      return [];
    }
    return selectedCandidate.suggestedBlueprintIds
      .map((blueprintId) => blueprintsById.get(blueprintId) ?? null)
      .filter((blueprint): blueprint is SwitchManagerBlueprint => Boolean(blueprint));
  }, [blueprintsById, selectedCandidate]);

  const filteredSuggestedBlueprints = useMemo(() => {
    const query = deferredBlueprintSearch.trim().toLowerCase();
    return suggestedBlueprints.filter((blueprint) =>
      query ? [blueprint.name, blueprint.id, blueprint.service, blueprint.eventType].join(" ").toLowerCase().includes(query) : true
    );
  }, [deferredBlueprintSearch, suggestedBlueprints]);

  const blueprintLibrary = useMemo(() => {
    const query = deferredBlueprintSearch.trim().toLowerCase();
    return [...blueprintsById.values()]
      .filter((blueprint) => {
        if (!query) {
          return true;
        }
        return [blueprint.name, blueprint.id, blueprint.service, blueprint.eventType].join(" ").toLowerCase().includes(query);
      })
      .sort((left, right) => left.name.localeCompare(right.name));
  }, [blueprintsById, deferredBlueprintSearch]);

  const [selectedBlueprintId, setSelectedBlueprintId] = useState("");

  useEffect(() => {
    if (mode === "blank") {
      const fallbackBlueprint = blueprintLibrary[0] ?? null;
      setSelectedBlueprintId((current) => current || fallbackBlueprint?.id || "");
      return;
    }

    const fallbackBlueprint = filteredSuggestedBlueprints[0] ?? blueprintLibrary[0] ?? null;
    setSelectedBlueprintId((current) => {
      if (current && blueprintsById.has(current)) {
        return current;
      }
      return fallbackBlueprint?.id ?? "";
    });
  }, [blueprintLibrary, blueprintsById, filteredSuggestedBlueprints, mode]);

  const selectedBlueprint =
    (selectedBlueprintId ? blueprintsById.get(selectedBlueprintId) ?? null : null) ??
    suggestedBlueprints[0] ??
    blueprintLibrary[0] ??
    null;

  const candidateBlueprints =
    filteredSuggestedBlueprints.length > 0
      ? filteredSuggestedBlueprints
      : selectedBlueprint
        ? [selectedBlueprint]
        : [];

  const spawnLabel = mode === "blank" ? "Create base config" : "Create guided draft";

  return (
    <section className="panel discovery-panel">
      <div className="panel-head">
        <div>
          <p className="eyebrow">Discovery</p>
          <h3>New switch onboarding</h3>
        </div>
        <span className="pill">{candidates.length} found</span>
      </div>

      <p className="panel-copy">
        Start from a discovered switch or jump straight into a blank blueprint-based config. The onboarding path keeps
        image, button count, and base draft creation together instead of scattering them across the editor.
      </p>

      <div className="segmented">
        <button
          className={`button button--ghost ${mode === "candidate" ? "button--primary" : ""}`}
          onClick={() => setMode("candidate")}
          type="button"
        >
          Guided discovery
        </button>
        <button
          className={`button button--ghost ${mode === "blank" ? "button--primary" : ""}`}
          onClick={() => setMode("blank")}
          type="button"
        >
          Blank from blueprint
        </button>
      </div>

      <div className="discovery-layout">
        <section className="discovery-column discovery-column--list">
          {mode === "candidate" ? (
            <>
              <div className="discovery-column__head">
                <div>
                  <p className="eyebrow">Step 1</p>
                  <h4>Choose a switch</h4>
                </div>
                <span className="pill pill--muted">{filteredCandidates.length} shown</span>
              </div>

              <label className="field">
                <span>Filter candidates</span>
                <input
                  onChange={(event) => setCandidateSearch(event.target.value)}
                  placeholder="Search name, model, protocol, or blueprint"
                  type="search"
                  value={candidateSearch}
                />
              </label>

              <div className="discovery-list">
                {filteredCandidates.length === 0 ? (
                  <div className="stack-card">
                    <strong>No discovery results in this view</strong>
                    <p>Try a different search or switch to a blank blueprint-based config.</p>
                  </div>
                ) : null}

                {filteredCandidates.map((candidate) => (
                  <button
                    className={`stack-card discovery-candidate ${
                      candidate.id === selectedCandidate?.id ? "discovery-candidate--selected" : ""
                    }`}
                    key={candidate.id}
                    onClick={() => setSelectedCandidateId(candidate.id)}
                    type="button"
                  >
                    <div className="stack-card__top">
                      <div>
                        <strong>{candidate.name}</strong>
                        <p>{protocolLabel(candidate)}</p>
                      </div>
                    </div>

                    <div className="target-chips">
                      {candidate.suggestedBlueprintIds.length === 0 ? (
                        <span className="muted-chip">Manual blueprint selection required</span>
                      ) : (
                        <>
                          <span className="pill pill--muted">
                            {candidate.suggestedBlueprintIds.length} blueprint
                            {candidate.suggestedBlueprintIds.length === 1 ? "" : "s"}
                          </span>
                          {candidate.relatedAutomationIds.length > 0 ? (
                            <span className="pill pill--muted">
                              {candidate.relatedAutomationIds.length} related automation
                              {candidate.relatedAutomationIds.length === 1 ? "" : "s"}
                            </span>
                          ) : null}
                        </>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            </>
          ) : (
            <>
              <div className="discovery-column__head">
                <div>
                  <p className="eyebrow">Step 1</p>
                  <h4>Pick a blueprint</h4>
                </div>
                <span className="pill pill--muted">{blueprintLibrary.length} available</span>
              </div>

              <label className="field">
                <span>Filter blueprints</span>
                <input
                  onChange={(event) => setBlueprintSearch(event.target.value)}
                  placeholder="Search blueprint name, id, service, or event type"
                  type="search"
                  value={blueprintSearch}
                />
              </label>

              <div className="discovery-list">
                {blueprintLibrary.map((blueprint) => (
                  <button
                    className={`stack-card discovery-candidate ${
                      blueprint.id === selectedBlueprint?.id ? "discovery-candidate--selected" : ""
                    }`}
                    key={blueprint.id}
                    onClick={() => setSelectedBlueprintId(blueprint.id)}
                    type="button"
                  >
                    <div className="stack-card__top">
                      <div>
                        <strong>{blueprint.name}</strong>
                        <p>{[blueprint.service, blueprint.eventType].filter(Boolean).join(" / ")}</p>
                      </div>
                    </div>

                    <div className="target-chips">
                      <span className="pill pill--muted">
                        {blueprint.buttons.length} button{blueprint.buttons.length === 1 ? "" : "s"}
                      </span>
                      <span className="pill pill--muted">
                        {countBlueprintActions(blueprint)} mapped action{countBlueprintActions(blueprint) === 1 ? "" : "s"}
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            </>
          )}
        </section>

        <section className="discovery-column discovery-column--detail">
          <div className="discovery-column__head">
            <div>
              <p className="eyebrow">{mode === "candidate" ? "Step 2" : "Review"}</p>
              <h4>{mode === "candidate" ? "Confirm the blueprint" : "Spawn the base config"}</h4>
            </div>
          </div>

          {mode === "candidate" && selectedCandidate ? (
            <div className="stack-card discovery-summary">
              <strong>{selectedCandidate.name}</strong>
              <p>{protocolLabel(selectedCandidate)}</p>
              <div className="target-chips">
                {selectedCandidate.probableProtocol ? (
                  <span className="pill pill--muted">{selectedCandidate.probableProtocol}</span>
                ) : null}
                {selectedCandidate.relatedAutomationIds.length > 0 ? (
                  <span className="pill pill--muted">
                    {selectedCandidate.relatedAutomationIds.length} existing automation
                    {selectedCandidate.relatedAutomationIds.length === 1 ? "" : "s"}
                  </span>
                ) : null}
              </div>

              {selectedCandidate.suggestedIdentifier ? (
                <p className="stack-card__meta">
                  Identifier: <code>{selectedCandidate.suggestedIdentifier}</code>
                </p>
              ) : null}

              {selectedCandidate.relatedAutomationIds.length > 0 ? (
                <p className="stack-card__meta">
                  Related automations: {selectedCandidate.relatedAutomationIds.join(", ")}
                </p>
              ) : null}
            </div>
          ) : null}

          <label className="field">
            <span>{mode === "candidate" ? "Filter blueprint matches" : "Refine blueprint choice"}</span>
            <input
              onChange={(event) => setBlueprintSearch(event.target.value)}
              placeholder="Search blueprint name, id, service, or event type"
              type="search"
              value={blueprintSearch}
            />
          </label>

          <div className="discovery-blueprint-list">
            {(mode === "candidate" ? candidateBlueprints : blueprintLibrary).slice(0, mode === "candidate" ? undefined : 12).map((blueprint) => (
              <button
                className={`stack-card discovery-blueprint-card ${
                  blueprint.id === selectedBlueprint?.id ? "discovery-blueprint-card--selected" : ""
                }`}
                key={blueprint.id}
                onClick={() => setSelectedBlueprintId(blueprint.id)}
                type="button"
              >
                <div className="discovery-blueprint-card__preview">
                  {blueprint.hasImage ? (
                    <img alt={`${blueprint.name} blueprint`} loading="lazy" src={`api/blueprints/${encodeURIComponent(blueprint.id)}/image`} />
                  ) : (
                    <div className="discovery-blueprint-card__placeholder">
                      <span>No image</span>
                    </div>
                  )}
                </div>

                <div className="discovery-blueprint-card__body">
                  <div className="stack-card__top">
                    <div>
                      <strong>{blueprint.name}</strong>
                      <p>{[blueprint.service, blueprint.eventType].filter(Boolean).join(" / ")}</p>
                    </div>
                  </div>

                  <div className="target-chips">
                    <span className="pill pill--muted">
                      {blueprint.buttons.length} button{blueprint.buttons.length === 1 ? "" : "s"}
                    </span>
                    <span className="pill pill--muted">
                      {countBlueprintActions(blueprint)} action{countBlueprintActions(blueprint) === 1 ? "" : "s"}
                    </span>
                    {blueprint.hasImage ? <span className="pill pill--muted">Image ready</span> : null}
                  </div>

                  {blueprint.info ? <p className="stack-card__meta">{blueprint.info}</p> : null}
                </div>
              </button>
            ))}
          </div>

          {selectedBlueprint ? (
            <div className="panel discovery-spawn-panel">
              <div className="panel-head">
                <div>
                  <p className="eyebrow">{mode === "candidate" ? "Step 3" : "Create"}</p>
                  <h4>{spawnLabel}</h4>
                </div>
              </div>

              <p className="panel-copy">
                {mode === "candidate"
                  ? `This will create a draft named ${selectedCandidate?.name ?? "the discovered switch"} using ${selectedBlueprint.name}.`
                  : `This will create a blank starter config from ${selectedBlueprint.name} with ${selectedBlueprint.buttons.length} button${selectedBlueprint.buttons.length === 1 ? "" : "s"}.`}
              </p>

              <div className="target-chips">
                <span className="pill">
                  {selectedBlueprint.buttons.length} button{selectedBlueprint.buttons.length === 1 ? "" : "s"}
                </span>
                <span className="pill pill--muted">{countBlueprintActions(selectedBlueprint)} action slot seed{countBlueprintActions(selectedBlueprint) === 1 ? "" : "s"}</span>
                {mode === "candidate" && selectedCandidate?.relatedAutomationIds.length ? (
                  <span className="pill pill--muted">
                    {selectedCandidate.relatedAutomationIds.length} automation match{selectedCandidate.relatedAutomationIds.length === 1 ? "" : "es"}
                  </span>
                ) : null}
              </div>

              <div className="inline-actions">
                {mode === "candidate" && selectedCandidate ? (
                  <button className="button button--primary" onClick={() => onUseCandidate(selectedCandidate, selectedBlueprint.id)} type="button">
                    Create guided draft
                  </button>
                ) : (
                  <button className="button button--primary" onClick={() => onUseBlueprint(selectedBlueprint.id)} type="button">
                    Create base config
                  </button>
                )}
              </div>
            </div>
          ) : (
            <div className="empty-state">Pick a blueprint to preview its image and button layout before creating a draft.</div>
          )}
        </section>
      </div>
    </section>
  );
}
