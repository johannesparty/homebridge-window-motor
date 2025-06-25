/* Copyright(C) 2017-2025, HJD (https://github.com/hjdhjd). All rights reserved.
 *
 * ui.mjs: Homebridge Ratgdo webUI.
 */
'use strict';

import { webUi } from './lib/webUi.mjs';

console.log('Custom Window Motor UI loading...');

// Show the details for this device.
const showWindowMotorDetails = (device) => {

  // No device specified, we must be in a global context.
  if(!device) {

    document.getElementById('device_model').innerHTML = 'N/A';
    document.getElementById('device_mac').innerHTML = 'N/A';
    document.getElementById('device_firmware').innerHTML = 'N/A';

    return;
  }

  // Populate the device details.
  document.getElementById('device_model').innerHTML = device.model;
  document.getElementById('device_mac').innerHTML = device.serialNumber;
  document.getElementById('device_firmware').innerHTML = device.firmwareRevision;
};

// Parameters for our feature options webUI.
const featureOptionsParams = { hasControllers: false, infoPanel: showWindowMotorDetails, sidebar: { deviceLabel: 'Window Motor Devices' } };

// Instantiate the webUI. // tried WindowMotor, WindowMotorPlugin, homebridge-window-motor 
const ui = new webUi({ featureOptions: featureOptionsParams, name: 'WindowMotor' });

// Display the webUI.
ui.show();
