# Switch Manager Studio

Switch Manager Studio is a visual editor for the Home Assistant `switch_manager` custom component. It gives you a switch-focused workspace for building configs, mapping buttons, importing or exporting automations, running learn mode, and packaging blueprint changes without hand-editing YAML.

It can run as a Home Assistant add-on or as a standalone Node service, but the add-on is the recommended install for most Home Assistant setups.

## What It Does

- Visual editor for `switch_manager` configs, including button actions and per-button sequencing.
- Guided discovery for unmapped devices so you can start from a draft instead of a blank config.
- Blueprint-aware editing with button layout overrides, rotation, and area assignment.
- Virtual multi-press editing for synthetic 2x, 3x, and higher press actions.
- Learn mode integration for capturing switch events and applying discovered identifiers.
- Automation import and export for moving actions between Switch Manager and `automations.yaml`.
- Blueprint package export, including current layout changes and image overrides.
- Device property inspection and light control style actions from inside the studio.
- Blueprint image override upload and reset support.
- Save, enable, disable, and delete Switch Manager configs directly through Home Assistant.

## Requirements

Switch Manager Studio is the editor, not the underlying integration. Before using it, make sure you already have:

- Home Assistant running
- `custom_components/switch_manager` installed and loaded
- Switch Manager blueprints available in `blueprints/switch_manager` if you want blueprint export or raw blueprint-backed workflows
Feature-specific requirements:

- Learn mode requires access to the Home Assistant config directory
- Automation import and export requires access to `automations.yaml`
- The Home Assistant add-on handles both of those automatically by mounting `/config` as `/homeassistant`

## Home Assistant Installation

The recommended install is as a local Home Assistant add-on.

### 1. Place the add-on in your Home Assistant config

This project should live at:

```text
/config/addons/local/switch_manager_studio
```

In this environment that is already the active source path:

```text
addons/local/switch_manager_studio
```

### 2. Refresh the local add-on list

In Home Assistant:

1. Go to `Settings -> Add-ons -> Add-on Store`
2. Open the three-dot menu
3. Click `Check for updates`

If Home Assistant does not pick it up immediately, restart Home Assistant or the Supervisor and check again.

### 3. Install the add-on

Find `Switch Manager Studio` under `Local add-ons` and click `Install`.

### 4. Start the add-on

No token setup is required. The add-on authenticates to Home Assistant automatically using the Supervisor token.

Once started:

- Home Assistant ingress is enabled automatically
- The sidebar entry appears as `Switch Manager Studio`
- The add-on talks to Home Assistant through `http://supervisor/core`
- Your Home Assistant config is mounted at `/homeassistant`

That mount is what enables:

- learn mode
- automation import and export
- raw blueprint-backed package export

If you need to override the automatic token (rare), you can set `ha_token` in the add-on configuration to a long-lived access token.

### 5. Open the studio

Use the Home Assistant sidebar entry first. Direct access on port `8878` is available, but ingress is the cleanest and safest default inside Home Assistant.

## Standalone Installation

Standalone mode is useful if you want to run the studio as a separate Node service on the same LAN. Unlike the add-on, standalone installs require a long-lived access token from Home Assistant.

### Environment

Create a long-lived access token in Home Assistant (Profile → Security → Long-Lived Access Tokens → Create Token) and set at least:

```bash
HA_BASE_URL=http://homeassistant.local:8123
HA_TOKEN=your-long-lived-token
PORT=8878
```

To enable learn mode, automation import/export, and raw blueprint export, also set:

```bash
HA_CONFIG_PATH=/path/to/homeassistant/config
```

Common values:

- Home Assistant OS: `/config`
- Home Assistant Container or Supervised: your mounted config path
- Home Assistant Core venv install: often `/home/homeassistant/.homeassistant`

### Run with Node

```bash
npm install
npm run build
npm start
```

### Development mode

```bash
npm install
npm run dev
```

Default ports:

- Web UI: `5175`
- API server: `8878`

### Run with Docker

```bash
docker build -t switch-manager-studio .
docker run -p 8878:8878 \
  -e HA_BASE_URL=http://homeassistant.local:8123 \
  -e HA_TOKEN=your-token \
  -e HA_CONFIG_PATH=/homeassistant \
  -v /path/to/ha/config:/homeassistant \
  switch-manager-studio
```

## Configuration Reference

### Add-on options

- `ha_token`: Optional override token. Leave blank to use the automatic Supervisor token. Only set this if you need to authenticate as a specific HA user.
- `port`: Port exposed by the add-on, default `8878`

### Standalone environment variables

- `HA_BASE_URL`: Base URL for Home Assistant, default `http://127.0.0.1:8123`
- `HA_TOKEN`: Long-lived access token for Home Assistant
- `HA_CONFIG_PATH`: Path to the Home Assistant config directory
- `HOST`: Bind host, default `0.0.0.0`
- `PORT`: API and packaged web server port, default `8878`
- `HA_REQUEST_TIMEOUT_MS`: Request timeout to Home Assistant, default `10000`
- `SWITCH_MANAGER_AUTH_SESSION_STORE`: Session storage file, default `data/auth-sessions.json`
- `SWITCH_MANAGER_BLUEPRINT_IMAGE_DIR`: Local PNG blueprint image directory, default `data/blueprints`
- `SWITCH_MANAGER_BLUEPRINT_OVERRIDE_IMAGE_DIR`: Directory for uploaded image overrides, default `data/blueprints-overrides`
- `SWITCH_MANAGER_BLUEPRINT_DIR`: Blueprint directory inside Home Assistant config, default `blueprints/switch_manager`
- `SWITCH_MANAGER_LEARNING_STORE_PATH`: Learning store path relative to the HA config, default `.storage/switch_manager_learning`
- `SWITCH_MANAGER_AUTOMATIONS_PATH`: Automations file path relative to the HA config, default `automations.yaml`

## Feature Availability

| Feature | Requires |
| --- | --- |
| Config editing, save/delete, enable/disable | HA connection (automatic in add-on) |
| Snapshot loading and device discovery | HA connection |
| Device property panel and entity control | HA connection |
| Learn mode | HA connection + `HA_CONFIG_PATH` |
| Automation import/export | HA connection + `HA_CONFIG_PATH` |
| Blueprint package export | HA connection |
| Raw blueprint-backed export details | `HA_CONFIG_PATH` |
| Blueprint image override storage | Local writable data directory |

In the add-on, both the HA connection and config path are handled automatically. For standalone installs, set `HA_TOKEN` and `HA_CONFIG_PATH` as environment variables.

## Security Notes

- This is an internal tool. Keep it on your trusted network.
- Do not expose it publicly without a real authentication layer in front of it.
- In standalone mode, the studio stores authenticated sessions on disk so you do not need to paste the token every visit.
- The session system is intentionally convenience-first for LAN use. Treat it as trusted-admin tooling, not an internet-facing app.
- The Home Assistant token used here can modify Switch Manager configs and interact with Home Assistant APIs. Protect it accordingly.

## Troubleshooting

- If the add-on shows authentication errors, restart it. The Supervisor token is refreshed on each start. If problems persist, set a long-lived access token in the add-on configuration as `ha_token`.
- In standalone mode, if the studio loads but shows authentication or snapshot errors, verify the `HA_TOKEN` environment variable.
- If discovery works but learn mode or automation import/export does not, confirm `HA_CONFIG_PATH` is set correctly in standalone mode.
- If blueprint images are missing, place PNG files in `data/blueprints` or rely on Home Assistant-served assets under `/assets/switch_manager`.
- If the add-on does not appear in Home Assistant, re-scan local add-ons from the Add-on Store menu and restart Home Assistant if needed.
- If the studio has nothing to edit, confirm `custom_components/switch_manager` is loaded and already returning blueprints and configs.

## Architecture

- Browser UI served by the studio
- Studio backend keeps Home Assistant auth server-side
- Backend talks to Home Assistant over WebSocket and REST
- Home Assistant remains the source of truth for Switch Manager configs, blueprints, and service calls
