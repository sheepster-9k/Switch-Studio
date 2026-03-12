import { useEffect, useState } from "react";

import type {
  AuthStatusResponse,
  HealthResponse,
  StudioSnapshot,
  SwitchManagerBlueprint,
  SwitchManagerConfig
} from "../../shared/types";
import { areaNameById, countActiveActions, countTotalActions, resolvedConfigAreaId } from "../helpers";

interface ConfigRailProps {
  authBusy: boolean;
  authStatus: AuthStatusResponse | null;
  blueprintsById: Map<string, SwitchManagerBlueprint>;
  configSearch: string;
  configs: SwitchManagerConfig[];
  health: HealthResponse | null;
  onConfigSearchChange: (value: string) => void;
  onOpenAuth: () => void;
  onSelectConfig: (config: SwitchManagerConfig) => void;
  onSignOut: () => void;
  selectedConfigId: string;
  snapshot: StudioSnapshot | null;
}

export function ConfigRail(props: ConfigRailProps) {
  const {
    authBusy,
    authStatus,
    blueprintsById,
    configSearch,
    configs,
    health,
    onConfigSearchChange,
    onOpenAuth,
    onSelectConfig,
    onSignOut,
    selectedConfigId,
    snapshot
  } = props;
  const devicesById = new Map(snapshot?.devices.map((device) => [device.id, device]) ?? []);
  const entitiesById = new Map(snapshot?.entities.map((entity) => [entity.entityId, entity]) ?? []);
  const groupedConfigs = configs
    .reduce<Array<{ id: string | null; key: string; name: string; configs: SwitchManagerConfig[] }>>(
      (groups, config) => {
        const areaId = snapshot ? resolvedConfigAreaId(config, devicesById, entitiesById) : null;
        const key = areaId ?? "__unassigned__";
        const existing = groups.find((entry) => entry.key === key);
        if (existing) {
          existing.configs.push(config);
          return groups;
        }
        groups.push({
          id: areaId,
          key,
          name: snapshot ? areaNameById(snapshot.areas, areaId) : "Unassigned",
          configs: [config]
        });
        return groups;
      },
      []
    )
    .sort((left, right) => {
      if (left.id === null) {
        return 1;
      }
      if (right.id === null) {
        return -1;
      }
      return left.name.localeCompare(right.name);
    });
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});
  const groupSignature = groupedConfigs.map((group) => group.key).join("|");

  useEffect(() => {
    setOpenGroups((current) => {
      const next: Record<string, boolean> = {};
      for (const group of groupedConfigs) {
        next[group.key] = current[group.key] ?? false;
      }
      return next;
    });
  }, [groupSignature]);

  const searchActive = configSearch.trim().length > 0;
  const connected = Boolean(authStatus?.authenticated && health?.ok);
  const statusTitle = connected ? "Connected" : authStatus?.authenticated ? "Session active" : "Not connected";
  const statusCopy = connected
    ? `${health?.version ?? "Home Assistant"} reachable at ${authStatus?.haBaseUrl ?? health?.haBaseUrl ?? ""}`.trim()
    : authStatus?.authenticated
      ? health?.error ?? authStatus?.haBaseUrl ?? "Session is active."
      : authStatus?.defaultHaBaseUrl
        ? `Enter a long-lived access token for ${authStatus.defaultHaBaseUrl}.`
        : "Enter a Home Assistant URL and long-lived access token.";

  return (
    <aside className="studio-sidebar">
      <div className="sidebar-head">
        <p className="eyebrow">Standalone editor</p>
        <h1>Switch Manager Studio</h1>
      </div>

      <label className="field search-field">
        <span>Filter switches</span>
        <input
          onChange={(event) => onConfigSearchChange(event.target.value)}
          placeholder="Search name, blueprint, or identifier"
          type="search"
          value={configSearch}
        />
      </label>

      <div className="status-block">
        <div>
          <span className={`status-dot ${connected ? "status-dot--ok" : ""}`}></span>
          <strong>{statusTitle}</strong>
        </div>
        <p>{statusCopy}</p>
        <div className="status-block__actions">
          <button className="button button--ghost" disabled={authBusy} onClick={onOpenAuth} type="button">
            {authStatus?.authenticated ? "Change token" : "Connect"}
          </button>
          {authStatus?.authenticated ? (
            <button className="button button--ghost" disabled={authBusy} onClick={onSignOut} type="button">
              Sign out
            </button>
          ) : null}
        </div>
      </div>

      <div className="accordion-toolbar">
        <button
          className="button button--ghost"
          onClick={() => setOpenGroups(Object.fromEntries(groupedConfigs.map((group) => [group.key, true])))}
          type="button"
        >
          Open all
        </button>
        <button
          className="button button--ghost"
          onClick={() => setOpenGroups(Object.fromEntries(groupedConfigs.map((group) => [group.key, false])))}
          type="button"
        >
          Shut all
        </button>
      </div>

      <div className="config-list">
        {groupedConfigs.map((group) => {
          const open = searchActive || openGroups[group.key];
          return (
            <section className="accordion-group" key={group.key}>
              <button
                className={`accordion-toggle ${open ? "accordion-toggle--open" : ""}`}
                onClick={() =>
                  setOpenGroups((current) => ({
                    ...current,
                    [group.key]: !open
                  }))
                }
                type="button"
              >
                <div>
                  <strong>{group.name}</strong>
                  <p>{group.configs.length} switch{group.configs.length === 1 ? "" : "es"}</p>
                </div>
                <span className="accordion-toggle__icon">{open ? "-" : "+"}</span>
              </button>

              {open ? (
                <div className="accordion-panel">
                  {group.configs.map((config) => {
                    const blueprint = blueprintsById.get(config.blueprintId);
                    return (
                      <button
                        className={`config-card ${config.id === selectedConfigId ? "config-card--selected" : ""}`}
                        key={config.id}
                        onClick={() => {
                          setOpenGroups((current) => ({
                            ...current,
                            [group.key]: true
                          }));
                          onSelectConfig(config);
                        }}
                        type="button"
                      >
                        <div className="config-card__top">
                          <strong>{config.name}</strong>
                          <span className={`pill ${config.enabled ? "pill--ok" : "pill--muted"}`}>
                            {config.enabled ? "Live" : "Disabled"}
                          </span>
                        </div>
                        <p>{blueprint?.name ?? config.blueprintId}</p>
                        <div className="config-card__meta">
                          <span>{countActiveActions(config)}/{countTotalActions(config)} mapped</span>
                          <span>ID {config.id}</span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              ) : null}
            </section>
          );
        })}
      </div>
    </aside>
  );
}
