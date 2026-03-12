import { useEffect, useState } from "react";

import type { AuthStatusResponse } from "../../shared/types";

interface AuthPanelProps {
  blocking?: boolean;
  busy?: boolean;
  error?: string | null;
  open: boolean;
  onClose?: () => void;
  onSubmit: (credentials: { accessToken: string; haBaseUrl: string }) => void;
  status: AuthStatusResponse | null;
}

export function AuthPanel(props: AuthPanelProps) {
  const { blocking = false, busy = false, error, open, onClose, onSubmit, status } = props;
  const [haBaseUrl, setHaBaseUrl] = useState("");
  const [accessToken, setAccessToken] = useState("");
  const [revealToken, setRevealToken] = useState(false);

  useEffect(() => {
    if (!open) {
      return;
    }
    setHaBaseUrl(status?.haBaseUrl ?? status?.defaultHaBaseUrl ?? "");
    setAccessToken("");
    setRevealToken(false);
  }, [open, status?.defaultHaBaseUrl, status?.haBaseUrl]);

  if (!open) {
    return null;
  }

  return (
    <div className={blocking ? "auth-screen" : "auth-overlay"}>
      <div aria-modal="true" className="auth-panel panel" role="dialog">
        <div className="auth-panel__head">
          <div>
            <p className="eyebrow">Authentication</p>
            <h2>Connect to Home Assistant</h2>
          </div>
          {!blocking && onClose ? (
            <button className="button button--ghost" disabled={busy} onClick={onClose} type="button">
              Close
            </button>
          ) : null}
        </div>

        <p className="panel-copy">
          Enter a Home Assistant base URL and a long-lived access token. The token is held only in this running
          studio session.
        </p>

        <form
          className="auth-form"
          onSubmit={(event) => {
            event.preventDefault();
            onSubmit({
              haBaseUrl,
              accessToken
            });
          }}
        >
          <label className="field">
            <span>Home Assistant URL</span>
            <input
              autoCapitalize="off"
              autoComplete="url"
              autoCorrect="off"
              disabled={busy}
              onChange={(event) => setHaBaseUrl(event.target.value)}
              placeholder="http://homeassistant.local:8123"
              spellCheck={false}
              type="url"
              value={haBaseUrl}
            />
          </label>

          <label className="field">
            <span>Long-lived access token</span>
            <div className="auth-token-row">
              <input
                autoCapitalize="off"
                autoComplete="off"
                autoCorrect="off"
                className="auth-token-row__input"
                disabled={busy}
                onChange={(event) => setAccessToken(event.target.value)}
                placeholder="Paste token"
                spellCheck={false}
                type={revealToken ? "text" : "password"}
                value={accessToken}
              />
              <button
                className="button button--ghost"
                disabled={busy}
                onClick={() => setRevealToken((current) => !current)}
                type="button"
              >
                {revealToken ? "Hide" : "Show"}
              </button>
            </div>
          </label>

          {error ? <section className="panel error-panel auth-panel__error">{error}</section> : null}

          <div className="auth-panel__actions">
            {!blocking && onClose ? (
              <button className="button button--ghost" disabled={busy} onClick={onClose} type="button">
                Cancel
              </button>
            ) : null}
            <button
              className="button button--primary"
              disabled={busy || !haBaseUrl.trim() || !accessToken.trim()}
              type="submit"
            >
              {busy ? "Connecting..." : "Connect"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
