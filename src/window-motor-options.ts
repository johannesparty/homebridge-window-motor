import { FeatureOptionEntry } from 'homebridge-plugin-utils';
import { WINDOW_MOTOR_OPENCLOSE_DURATION } from './settings.js';
// Plugin configuration options.
export type WindowMotorOptions = Partial<{

  debug: boolean,
  options: string[]
}>;

// Feature option categories.
export const featureOptionCategories = [
  { description: 'Device feature options.', name: 'Device' },
  { description: 'Logging feature options.', name: 'Log' },
  { description: 'Window feature options.', name: 'Window' },
];

// Individual feature options, broken out by category.
export const featureOptions: { [index: string]: FeatureOptionEntry[] } = {

  // Device options.
  'Device': [
    { default: true, description: 'Make this device available in HomeKit.', name: '' },
  ],

  // Logging options.
  'Log': [
    { default: true, description: 'Log window events in Homebridge.', name: 'Opener' },
  ],


  // Window options.
  'Window': [
    { default: false, description: 'Make this window read-only by ignoring open and close requests from HomeKit.', name: 'ReadOnly' },
    { default: true,  description: 'Motor includes connected window closed sensor.', name: 'Builtin.Closed.Sensor' },
    { default: false, description: 'Add a contact sensor accessory for window closed.', name: 'Homekit.Switch.WindowClosed' },
    { default: true, defaultValue: WINDOW_MOTOR_OPENCLOSE_DURATION, description: 'Time to open or close window', name: 'OpenCloseDuration' },
  ],

};
