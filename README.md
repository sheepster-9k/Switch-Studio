# Switch Manager Studio

Standalone interactive entity UI for the `switch_manager` Home Assistant custom component.

## Goals
- Keep Home Assistant auth server-side.
- Reuse the existing HA Vibecode Agent on the Home Assistant host when available.
- Fall back to the native Home Assistant websocket API when an agent is not available.
- Run as a separate Node service alongside Home Assistant or on another reachable host.
- Provide a switch-focused editor for button mappings, entity/device/area targets, and raw sequence steps.

## Architecture
- Browser -> `Switch Manager Studio` web app
- Studio backend -> HA Vibecode Agent (`:8099`) or Home Assistant websocket API
- Home Assistant -> existing `custom_components/switch_manager`

## Environment

Create `/etc/default/switch-manager-studio` on the target host:

```bash
HA_BASE_URL=http://homeassistant.local:8123
HA_AGENT_URL=http://homeassistant.local:8099
HA_AGENT_KEY=replace-with-live-agent-key
PORT=8878
```

Preferred runtime:
- `HA_AGENT_URL` and `HA_AGENT_KEY` point at the existing HA Vibecode Agent.
- `HA_TOKEN` remains supported as a fallback for environments that do not have the agent.
- If `HA_AGENT_URL` is omitted, the backend derives it from `HA_BASE_URL` using port `8099`.

Optional paths:

```bash
SWITCH_MANAGER_STORE_PATH=.storage/switch_manager
SWITCH_MANAGER_BLUEPRINT_DIR=blueprints/switch_manager
SWITCH_MANAGER_BLUEPRINT_IMAGE_DIR=/opt/switch-manager-studio/data/blueprints
SWITCH_MANAGER_BLUEPRINT_OVERRIDE_IMAGE_DIR=/opt/switch-manager-studio/data/blueprints-overrides
```

`SWITCH_MANAGER_BLUEPRINT_IMAGE_DIR` should contain the switch-manager blueprint `.png` files. The backend serves those locally while the blueprint YAML data comes from Home Assistant through the agent.

`SWITCH_MANAGER_BLUEPRINT_OVERRIDE_IMAGE_DIR` stores studio-managed image overrides created from the editor. The UI accepts PNG, JPG, WEBP, GIF, and SVG uploads, converts them to PNG, constrains them to the Switch Manager recommendation of 800px width or 500px height, and uses the result both in the editor canvas and exported blueprint packages.

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

## Security

- Keep the app internal-only unless there is a real auth layer in front of it.
- Do not expose Home Assistant or this studio publicly without access control.
