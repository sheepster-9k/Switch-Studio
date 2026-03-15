# Switch Manager Studio

Switch Manager Studio is a visual editor for the Home Assistant `switch_manager` custom component. It gives you a switch-focused workspace for building configs, mapping buttons, importing or exporting automations, running learn mode, and packaging blueprint changes without hand-editing YAML.

It also includes an optional mmWave Studio workspace for tuning Zigbee2MQTT-based mmWave presence sensors (like the Aqara FP1/FP2 or VZM32) with live zone editing, teach mode, corner fit, and profile management.

It can run as a Home Assistant add-on or as a standalone Node service, but the add-on is the recommended install for most Home Assistant setups.

## What It Does

### Switch Manager

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

### mmWave Studio

- Live zone editor for detection, interference, and stay areas with real-time feedback.
- Teach mode that records motion transitions and highlights hot detection lanes.
- Corner fit tool for deriving zone geometry from live target dot positions.
- Profile save, load, import, export, and per-device apply.
- Per-area custom labels persisted across sessions.
- Settings panel for room preset, sensitivity, trigger speed, hold time, and more.
- Auto-discovers Zigbee2MQTT MQTT configuration from the Z2M config file.

## Requirements

Switch Manager Studio is the editor, not the underlying integration. Before using it, make sure you already have:

- Home Assistant running
- `custom_components/switch_manager` installed and loaded
- Switch Manager blueprints available in `blueprints/switch_manager` if you want blueprint export or raw blueprint-backed workflows

Feature-specific requirements:

| Feature | Additional requirement |
| --- | --- |
| Learn mode | Access to the Home Assistant config directory |
| Automation import/export | Access to `automations.yaml` |
| mmWave Studio | Zigbee2MQTT running with MQTT accessible to the studio |

The Home Assistant add-on handles config directory access automatically. mmWave auto-discovers Z2M's MQTT settings from its `configuration.yaml`.

## Home Assistant Add-on Installation

The recommended install is as a Home Assistant add-on. **No token or manual auth setup is required** — the add-on authenticates automatically using the Supervisor-injected token.

### 1. Add the repository

In Home Assistant, go to **Settings > Add-ons > Add-on Store**, open the three-dot menu, select **Repositories**, and add:

```text
https://github.com/sheepster-9k/Switch-Studio
```

### 2. Install and start the add-on

Find **Switch Manager Studio** in the store and click **Install**, then **Start**.

Once running:

- A sidebar entry appears as **Switch Manager Studio**
- The add-on talks to Home Assistant through `http://supervisor/core`
- Your Home Assistant config is mounted at `/homeassistant`, enabling learn mode, automation import/export, and raw blueprint export
- mmWave auto-discovers Zigbee2MQTT if its config is at `/homeassistant/zigbee2mqtt/configuration.yaml` or `/share/zigbee2mqtt/data/configuration.yaml`

### 3. Open the studio

Use the Home Assistant sidebar entry. Direct access on port `8878` is also available, but ingress is the cleanest default.

## Standalone Installation

Standalone mode runs the studio as a separate Node service on the same LAN. Unlike the add-on, standalone installs require a **long-lived access token** from Home Assistant.

### Environment

Create a long-lived access token in Home Assistant (**Profile > Security > Long-Lived Access Tokens > Create Token**) and set at least:

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

To enable mmWave Studio in standalone mode, either:

- Set `Z2M_CONFIG` to the path of your Zigbee2MQTT `configuration.yaml` (MQTT settings are read automatically), or
- Set `MQTT_URL` and `Z2M_BASE_TOPIC` manually

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

| Option | Default | Description |
| --- | --- | --- |
| `ha_token` | *(empty)* | Optional override token. Leave blank to use the automatic Supervisor token. Only set this if you need to authenticate as a specific HA user. |
| `port` | `8878` | Port exposed by the add-on |

### Standalone environment variables

| Variable | Default | Description |
| --- | --- | --- |
| `HA_BASE_URL` | `http://127.0.0.1:8123` | Base URL for Home Assistant |
| `HA_TOKEN` | *(none)* | **Required.** Long-lived access token for Home Assistant |
| `HA_CONFIG_PATH` | *(none)* | Path to the Home Assistant config directory |
| `HOST` | `0.0.0.0` | Bind host |
| `PORT` | `8878` | API and web server port |
| `HA_REQUEST_TIMEOUT_MS` | `10000` | Request timeout to Home Assistant (ms) |
| `MQTT_URL` | *(auto from Z2M)* | MQTT broker URL for mmWave (e.g. `mqtt://127.0.0.1:1883`) |
| `MQTT_USER` | *(auto from Z2M)* | MQTT username |
| `MQTT_PASSWORD` | *(auto from Z2M)* | MQTT password |
| `Z2M_BASE_TOPIC` | *(auto from Z2M)* | Zigbee2MQTT base topic (default `zigbee2mqtt`) |
| `Z2M_CONFIG` | *(auto-discovered)* | Path to Zigbee2MQTT `configuration.yaml` |

Advanced variables (rarely needed):

| Variable | Default | Description |
| --- | --- | --- |
| `SWITCH_MANAGER_AUTH_SESSION_STORE` | `data/auth-sessions.json` | Session storage file path |
| `SWITCH_MANAGER_BLUEPRINT_IMAGE_DIR` | `data/blueprints` | Local PNG blueprint image directory |
| `SWITCH_MANAGER_BLUEPRINT_OVERRIDE_IMAGE_DIR` | `data/blueprints-overrides` | Directory for uploaded image overrides |
| `SWITCH_MANAGER_BLUEPRINT_DIR` | `blueprints/switch_manager` | Blueprint directory inside HA config |
| `SWITCH_MANAGER_LEARNING_STORE_PATH` | `.storage/switch_manager_learning` | Learning store path relative to HA config |
| `SWITCH_MANAGER_AUTOMATIONS_PATH` | `automations.yaml` | Automations file path relative to HA config |

## Feature Availability

| Feature | Add-on | Standalone |
| --- | --- | --- |
| Config editing, save/delete, enable/disable | Automatic | `HA_TOKEN` required |
| Snapshot loading and device discovery | Automatic | `HA_TOKEN` required |
| Device property panel and entity control | Automatic | `HA_TOKEN` required |
| Learn mode | Automatic | `HA_TOKEN` + `HA_CONFIG_PATH` |
| Automation import/export | Automatic | `HA_TOKEN` + `HA_CONFIG_PATH` |
| Blueprint package export | Automatic | `HA_TOKEN` |
| Raw blueprint-backed export details | Automatic | `HA_CONFIG_PATH` |
| Blueprint image override storage | Automatic | Local writable data directory |
| mmWave Studio | Auto-discovered from Z2M | `MQTT_URL` + `Z2M_BASE_TOPIC` or `Z2M_CONFIG` |

## Security Notes

- This is a LAN tool. Do not expose it to the internet without an authentication layer in front of it.
- The add-on authenticates automatically via the Supervisor token. No manual token setup is needed.
- In standalone mode, the studio stores authenticated sessions on disk so you don't need to paste the token every visit. Sessions expire after 90 days.
- The session system is intentionally convenience-first for LAN use. Any browser on the same network can access the studio once a token has been configured.
- The Home Assistant token used here can modify Switch Manager configs and interact with Home Assistant APIs. Protect it accordingly.
- API requests are rate-limited (auth endpoint: 15 requests/minute per IP).
- Image uploads are size-limited (max ~2 MB).
- WebSocket connections are capped at 50 concurrent clients with a 1 MB message size limit.

## Troubleshooting

### Add-on

- **Authentication errors**: Restart the add-on. The Supervisor token refreshes on each start. If problems persist, set a long-lived access token in the add-on configuration as `ha_token`.
- **Add-on not appearing**: Re-scan add-ons from the Add-on Store three-dot menu and restart Home Assistant if needed.
- **mmWave not working**: Confirm Zigbee2MQTT is running as an add-on or that its config is at one of the auto-discovered paths. Check the add-on log for MQTT connection messages.

### Standalone

- **Authentication or snapshot errors**: Verify the `HA_TOKEN` environment variable is set and the token is still valid in Home Assistant.
- **Learn mode or automation import/export not available**: Confirm `HA_CONFIG_PATH` is set and points to the correct directory.
- **mmWave not detected**: Set `Z2M_CONFIG` to the path of your Zigbee2MQTT `configuration.yaml`, or set `MQTT_URL` and `Z2M_BASE_TOPIC` manually.

### General

- **Blueprint images missing**: Place PNG files in `data/blueprints` or rely on Home Assistant-served assets under `/assets/switch_manager`.
- **Nothing to edit**: Confirm `custom_components/switch_manager` is loaded and already returning blueprints and configs.

## Architecture

- Browser UI served by the studio's Fastify server
- Studio backend keeps Home Assistant auth server-side
- Backend talks to Home Assistant over WebSocket and REST
- Home Assistant remains the source of truth for Switch Manager configs, blueprints, and service calls
- mmWave Studio connects directly to the MQTT broker for real-time sensor communication
