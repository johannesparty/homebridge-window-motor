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

## Using the virtual sensor switch

If your window motor doesn't have a wired contact sensor but you do have a separate HomeKit window/contact sensor nearby, you can use this plugin's virtual switch to feed that sensor's state back into the motor. The motor needs to know whether the window is currently open or closed so its `check_window_sensor` script can correct the cover position if it drifts (e.g. after a manual operation or a reboot).

### Plugin setup

In the plugin's Feature Options UI, for each device:

1. Enable **Window > Homekit.Switch.WindowClosed** ("Add a virtual switch to indicate window closed").
2. Make sure **Window > Builtin.Closed.Sensor** is **not** checked. The wired sensor takes precedence and would override the virtual switch.

Restart Homebridge. A new switch accessory named `<device> Is Closed` will appear in HomeKit alongside the window itself.

### HomeKit automations — mirror the contact sensor

Create two automations in the Home app so that the contact sensor drives the virtual switch:

- **When** "<window sensor> detects window closed", **turn on** "<device> Is Closed".
- **When** "<window sensor> detects window opened", **turn off** "<device> Is Closed".

That's enough for normal operation. But after a Homebridge restart, an iPad/Apple TV hub blip, or any other interruption the switch state can drift from the actual sensor state, because the automations only fire on change events. The next two automations close that gap by re-syncing on a timer.

### Periodic re-sync via a timer

Add a recurring trigger. There are a few ways to do this in HomeKit; one that works well is [homebridge-schedule](https://github.com/kbrashears5/homebridge-schedule) by @kbrashears5. Configure it as a virtual switch with a cron string:

```
*/15 * * * *
```

That fires every 15 minutes. (An Interval-based plugin or any other recurring trigger works equally well — what matters is that something in HomeKit toggles on a fixed cadence.)

Then create two more automations driven by the timer:

- **When** the timer switch turns on, **only if** the window contact sensor reads *closed*, **turn on** "<device> Is Closed".
- **When** the timer switch turns on, **only if** the window contact sensor reads *open*, **turn off** "<device> Is Closed".

With these in place, even if the change-driven automations miss an event (HomeKit restart, hub offline, plugin restart), the state is reconciled within 15 minutes.

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
