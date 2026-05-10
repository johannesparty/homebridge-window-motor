// Name of the platform that users register in the Homebridge config.json.
export const PLATFORM_NAME = 'WindowMotorPlugin';

// Must match the `name` property in package.json.
export const PLUGIN_NAME = 'homebridge-window-motor';

// Interval, in seconds, to initiate mDNS discovery requests for new window motor devices.
export const WINDOW_MOTOR_AUTODISCOVERY_INTERVAL = 10;

// mDNS TXT record project names associated with a window motor device.
export const WINDOW_MOTOR_AUTODISCOVERY_PROJECT_NAMES: RegExp[] = [ /^window-motor\.esphome$/i ];

// mDNS service type associated with the device (ESPHome native).
export const WINDOW_MOTOR_AUTODISCOVERY_TYPE = 'esphomelib';

// Duration, in seconds, to wait for a ping from the ESPHome eventsource API. ESPHome defaults to a ping every 10 seconds.
export const WINDOW_MOTOR_EVENT_API_HEARTBEAT_DURATION = 10 * 2;

// Duration, in seconds, for a single heartbeat connection to keep the device's ESPHome API failsafe satisfied.
export const WINDOW_MOTOR_HEARTBEAT_DURATION = 120;

// Interval, in seconds, between heartbeat connection attempts.
export const WINDOW_MOTOR_HEARTBEAT_INTERVAL = 300;

// Duration, in seconds, default time for window open or close.
export const WINDOW_MOTOR_OPENCLOSE_DURATION = 30;

// Duration, in seconds, for relay operation.
export const WINDOW_MOTOR_RELAY_DURATION = 5;
