/*
 * ui.mjs: Homebridge Window Motor webUI.
 *
 * Originally adapted from Copyright(C) 2017-2025, HJD (https://github.com/hjdhjd).
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

featureOptionsParams.getDevices = async () => {

  // Retrieve the full list of cached accessories.
  let cached_devices = await homebridge.getCachedAccessories();

  // Filter out only the components we're interested in.
  cached_devices = cached_devices.map(device => ({

    firmwareRevision: (device.services.find(service => service.constructorName ===
      'AccessoryInformation')?.characteristics.find(characteristic => characteristic.constructorName === 'FirmwareRevision')?.value ?? ''),
    manufacturer: (device.services.find(service => service.constructorName ===
      'AccessoryInformation')?.characteristics.find(characteristic => characteristic.constructorName === 'Manufacturer')?.value ?? ''),
    model: (device.services.find(service => service.constructorName ===
      'AccessoryInformation')?.characteristics.find(characteristic => characteristic.constructorName === 'Model')?.value ?? ''),
    name: device.displayName,
    serialNumber: (device.services.find(service => service.constructorName ===
      'AccessoryInformation')?.characteristics.find(characteristic => characteristic.constructorName === 'SerialNumber')?.value ?? '')
  }));

  // We don't want to show the WindowMotorSwitch devices in the UI, so we filter them out.
  // This is because the WindowMotorSwitch is a virtual accessory that represents the window motor switch,
  // and we only want to show the actual window motor devices.
  let devices = cached_devices.filter(device => device.model !== 'WindowMotorSwitch');  

  // Sort it for posterity.
  devices.sort((a, b) => {

    const aCase = (a.name ?? '').toLowerCase();
    const bCase = (b.name ?? '').toLowerCase();

    return aCase > bCase ? 1 : (bCase > aCase ? -1 : 0);
  });

  // Return the list.
  return devices;
};


const ui = new webUi({ featureOptions: featureOptionsParams, name: 'WindowMotor' });

// Display the webUI.
ui.show();
