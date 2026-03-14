# Switch Manager Studio

Standalone interactive editor for the `switch_manager` Home Assistant custom component.

## Goals
- Keep Home Assistant auth server-side.
- Run as a Home Assistant addon (recommended) or as a separate Node service.
- Provide a switch-focused editor for button mappings, entity/device/area targets, and raw sequence steps.
- Use direct Home Assistant websocket and REST access only.

## Architecture
- Browser → Switch Manager Studio web app
- Studio backend → Home Assistant WebSocket API
- Home Assistant → existing `custom_components/switch_manager`

---

## Installation: HA Addon (recommended)

1. The `addons/local/switch_manager_studio/` directory in your HA config is the local addon. HA Supervisor scans this automatically.
2. In HA, go to **Settings → Add-ons → Add-on Store** (three-dot menu) → **Check for updates** to detect the local addon.
3. Install "Switch Manager Studio" from the **Local add-ons** section.
4. In the addon **Configuration** tab, paste a long-lived HA token into `ha_token`.
5. Start the addon. The **Switch Manager Studio** sidebar entry appears automatically via HA ingress.

The addon mounts your HA config at `/homeassistant` automatically, which enables automations import/export, learn mode, and raw blueprint YAML access.

---

## Installation: Standalone (external service)

Build and run alongside Home Assistant on any reachable host.

### Environment

Create `/etc/default/switch-manager-studio`:

```bash
HA_BASE_URL=http://homeassistant.local:8123
HA_TOKEN=your-long-lived-token
PORT=8878
```

To enable automations, learn mode, and raw blueprint YAML, also set:

```bash
HA_CONFIG_PATH=/path/to/homeassistant/config
```

When running on the same machine as Home Assistant, `HA_CONFIG_PATH` is typically `/config` (HA OS) or `/home/homeassistant/.homeassistant`.

### Optional path overrides

```bash
SWITCH_MANAGER_BLUEPRINT_IMAGE_DIR=/opt/switch-manager-studio/data/blueprints
SWITCH_MANAGER_BLUEPRINT_OVERRIDE_IMAGE_DIR=/opt/switch-manager-studio/data/blueprints-overrides
SWITCH_MANAGER_AUTH_SESSION_STORE=/opt/switch-manager-studio/data/auth-sessions.json
```

`SWITCH_MANAGER_BLUEPRINT_IMAGE_DIR` should contain switch-manager blueprint `.png` files. The backend serves them locally; blueprint YAML data comes from Home Assistant via the WebSocket API.

`SWITCH_MANAGER_BLUEPRINT_OVERRIDE_IMAGE_DIR` stores studio-managed image overrides. The UI accepts PNG, JPG, WEBP, GIF, and SVG uploads, converts them to PNG, constrains them to the Switch Manager recommendation of 800px width or 500px height, and uses the result both in the editor canvas and exported blueprint packages.

### Feature availability

| Feature | Requires |
|---------|----------|
| Switch editor, blueprints, config save/delete | `HA_TOKEN` |
| Device discovery | `HA_TOKEN` |
| Automation import/export | `HA_TOKEN` + `HA_CONFIG_PATH` |
| Learn mode | `HA_TOKEN` + `HA_CONFIG_PATH` |
| Raw blueprint YAML (for export packages) | `HA_CONFIG_PATH` |

---

`SWITCH_MANAGER_AUTH_SESSION_STORE` is the runtime-only session file used to persist authenticated studio sessions across page reloads and service restarts.

## Development

```bash
npm install
npm run dev
```

The frontend runs on port `5175`. The API server runs on port `8878`.

## Production

```bash
npm install
npm run build
npm start
```

The example systemd unit is in [deploy/switch-manager-studio.service](./deploy/switch-manager-studio.service).

## Docker

```bash
docker build -t switch-manager-studio .
docker run -p 8878:8878 \
  -e HA_BASE_URL=http://homeassistant.local:8123 \
  -e HA_TOKEN=your-token \
  -v /path/to/ha/config:/homeassistant \
  switch-manager-studio
```

## Security

- Keep the app internal-only unless there is a real auth layer in front of it.
- Do not expose Home Assistant or this studio publicly without access control.
