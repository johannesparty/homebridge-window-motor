
import { PLATFORM_NAME, PLUGIN_NAME } from './settings.js';
import type { API } from 'homebridge';
import { WindowMotorPlatform } from './window-motor-platform.js';

// Register our platform with Homebridge.
export default (api: API): void => {
  api.registerPlatform(PLUGIN_NAME, PLATFORM_NAME, WindowMotorPlatform);
};
