# homebridge-window-motor

A [Homebridge](https://homebridge.io) plugin that exposes ESP32-based DIY window motor controllers (running custom ESPHome firmware) to HomeKit as Window accessories.

## What it does

- Auto-discovers window motor devices on the local network via mDNS (ESPHome's `esphomelib` service type, filtered by project name `window-motor.esphome`).
- Registers each device as a HomeKit `Window` accessory with `TargetPosition` (0/100), `CurrentPosition`, and `PositionState`.
- Optionally exposes a virtual "Window Closed" switch accessory, useful when no physical contact sensor is wired.
- Sends HTTP commands to the device's ESPHome web server to drive the open/close relays.
- Subscribes to the device's ESPHome event stream to track operation state and availability.

## Requirements

- Homebridge 1.8+ or 2.0 beta.
- Node.js 18, 20, or 22.
- ESP32 controllers running the ESPHome firmware in [esphome/](./esphome) (project name must be `window-motor.esphome`).

## Install

In the Homebridge UI: install `homebridge-window-motor`, then add the `WindowMotorPlugin` platform to your config (the UI will do this for you).

Or by hand:

```json
{
  "platforms": [
    {
      "platform": "WindowMotorPlugin",
      "name": "Window Motor Plugin"
    }
  ]
}
```

For best performance, run this plugin as a [child bridge](https://github.com/homebridge/homebridge/wiki/Child-Bridges).

## Configuration

The plugin auto-discovers devices — no per-device config is required. Per-device feature options are available in the plugin's custom UI:

- **Device** — enable/disable individual devices in HomeKit.
- **Window > ReadOnly** — ignore open/close requests from HomeKit.
- **Window > Builtin.Closed.Sensor** — the device has a wired contact sensor on GPIO25.
- **Window > Homekit.Switch.WindowClosed** — expose a virtual switch (ignored if a wired sensor is present).
- **Window > OpenCloseDuration** — seconds the cover takes to fully open/close (default 30).
- **Window > RelayDuration** — seconds to hold the relay during a movement command (default 5).
- **Log > Opener** — verbose logging of window events.

## ESPHome firmware

The ESPHome configuration files in [esphome/](./esphome) target the LilyGo T-Relay board. Key features:

- Two GPIO relays (open and close) driven by a `cover` template.
- Configurable `open_duration` and `relay_duration` exposed as ESPHome `number` entities.
- Optional GPIO closed-sensor on GPIO25 and/or a virtual sensor.
- Status LED on GPIO23 indicating when the relay is active.

## Development

```sh
npm install
npm run build      # tsc → dist/
npm run lint
```

`npm run watch` (configure `test/hbConfig/config.json` first) runs Homebridge in debug mode and rebuilds on save.

## Acknowledgements

The plugin scaffolding and parts of the discovery / event-stream code are adapted from the work of [HJD (hjdhjd)](https://github.com/hjdhjd) and the Homebridge plugin template.
