/**
 * This is the name of the platform that users will use to register the plugin in the Homebridge config.json
 */
export const PLATFORM_NAME = 'WindowMotorPlugin';

/**
 * This must match the name of your plugin as defined the package.json `name` property
 */
export const PLUGIN_NAME = 'homebridge-window-motor';

// Discovery Related
// Interval, in seconds, to initiate mDNS discovery requests for new Ratgdo devices.
export const WINDOW_MOTOR_AUTODISCOVERY_INTERVAL = 10;

// mDNS TXT record project name associated with a Ratgdo device.
export const WINDOW_MOTOR_AUTODISCOVERY_PROJECT_NAMES: RegExp[] = [ /^window-motor\.esphome$/i ];

// mDNS service types associated with a Ratgdo device.
export const WINDOW_MOTOR_AUTODISCOVERY_TYPES = [ 'esphomelib' ];
