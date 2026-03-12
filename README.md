# Switch Manager Studio

Standalone interactive entity UI for the `switch_manager` Home Assistant custom component.

## Goals
- Keep Home Assistant auth server-side.
- Run as a separate Node service alongside Home Assistant or on another reachable host.
- Provide a switch-focused editor for button mappings, entity/device/area targets, and raw sequence steps.
- Use direct Home Assistant websocket and REST access only.

## Architecture
- Browser -> `Switch Manager Studio` web app
- Studio backend -> Home Assistant websocket API and REST API
- Home Assistant -> existing `custom_components/switch_manager`

## Environment

Create `/etc/default/switch-manager-studio` on the target host:

```bash
HA_BASE_URL=http://homeassistant.local:8123
PORT=8878
```

`HA_BASE_URL` is optional. When present, the auth panel uses it as the default Home Assistant URL. The access token is entered at runtime in the studio UI and stays in server memory for the active session only.

Optional paths:

```bash
SWITCH_MANAGER_BLUEPRINT_IMAGE_DIR=/opt/switch-manager-studio/data/blueprints
SWITCH_MANAGER_BLUEPRINT_OVERRIDE_IMAGE_DIR=/opt/switch-manager-studio/data/blueprints-overrides
```

`SWITCH_MANAGER_BLUEPRINT_IMAGE_DIR` should contain the switch-manager blueprint `.png` files. The backend serves those locally while the blueprint YAML data comes from Home Assistant through the `switch_manager` websocket commands.

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
