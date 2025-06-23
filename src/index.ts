
import { PLATFORM_NAME } from './settings.js';
import type { API } from 'homebridge';
import { WindowMotorPlatform } from './window-motor-platform.js';

/**
 * This method registers the platform with Homebridge
 */

export default (api: API) => {
  // api.registerPlatform('WindowMotorPlugin', 'Window Motor Plugin', WindowMotorPlatform);
  api.registerPlatform('WindowMotorPlugin', WindowMotorPlatform);
};

