/**
 * This is the name of the platform that users will use to register the plugin in the Homebridge config.json
 */
export const PLATFORM_NAME = 'WindowMotorPlugin';

/**
 * This must match the name of your plugin as defined the package.json `name` property
 * and must start with 'homebridge-'
 */
export const PLUGIN_NAME = 'homebridge-window-motor';

// Discovery Related
// Interval, in seconds, to initiate mDNS discovery requests for new Ratgdo devices.
export const WINDOW_MOTOR_AUTODISCOVERY_INTERVAL = 10;

// mDNS TXT record project name associated with a Ratgdo device.
export const WINDOW_MOTOR_AUTODISCOVERY_PROJECT_NAMES: RegExp[] = [ /^window-motor\.esphome$/i ];

// mDNS service types associated with a Ratgdo device.
export const WINDOW_MOTOR_AUTODISCOVERY_TYPE = 'esphomelib';

// Duration, in seconds, to wait for a ping event from the ESPHome eventsource API. ESPHome defaults to sending a ping every 10 seconds.
export const WINDOW_MOTOR_EVENT_API_HEARTBEAT_DURATION = 10 * 2;

// Duration, in seconds, for a single heartbeat to ensure the Ratgdo doesn't autoreboot.
export const WINDOW_MOTOR_HEARTBEAT_DURATION = 120;

// Interval, in seconds, for heartbeat requests to ensure the Ratgdo doesn't autoreboot.
export const WINDOW_MOTOR_HEARTBEAT_INTERVAL = 300;

// duration, in seconds, default time for window open or close
export const WINDOW_MOTOR_OPENCLOSE_DURATION = 30;
