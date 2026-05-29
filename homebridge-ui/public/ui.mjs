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

// Collapse the feature-options three-state cycle to two states for value-centric
// options (those rendered with a numeric input alongside the checkbox, e.g.
// OpenCloseDuration, RelayDuration). The library's default cycle is:
//   Checked → Indeterminate (inherit upstream) → Unchecked (explicit Disable) → Checked
// The "Unchecked" state writes a useless Disable.X.MAC config entry and shows
// the hard-coded default, which is confusing for duration-style options where
// users really only want "override" vs "inherit." We auto-advance past Unchecked
// so the visible cycle is:
//   Checked ↔ Indeterminate
const installTwoStateCycleForValueOptions = () => {
  const isValueOptionCheckbox = (checkbox) => {
    // Value-centric options are rendered as a checkbox + adjacent <input type="text">
    // in the same table row. Boolean-only options have no such input.
    const row = checkbox.closest('tr');
    return !!row?.querySelector('input[type="text"], input[type="number"]');
  };

  const wireCheckbox = (checkbox) => {
    if(checkbox.dataset.twoStateCycleWired) {
      return;
    }
    if(!isValueOptionCheckbox(checkbox)) {
      return;
    }
    checkbox.dataset.twoStateCycleWired = '1';

    checkbox.addEventListener('change', () => {
      // The library's own change handler runs synchronously in the same event;
      // queue a microtask to observe the resulting state.
      queueMicrotask(() => {
        // We've landed on the "Unchecked" state if all three flags are false.
        // (Checked → checked=true; Indeterminate → indeterminate=true and/or readOnly=true.)
        if(!checkbox.checked && !checkbox.indeterminate && !checkbox.readOnly) {
          // Auto-advance to Checked. This re-fires the change event so the library
          // updates its state and config accordingly.
          checkbox.click();
        }
      });
    });
  };

  // Wire any checkboxes present at startup (typically none — the feature options
  // table is rendered lazily when the user opens that page).
  document.querySelectorAll('input[type="checkbox"]').forEach(wireCheckbox);

  // Observe future additions so we catch checkboxes rendered after navigation.
  new MutationObserver((mutations) => {
    for(const mutation of mutations) {
      for(const node of mutation.addedNodes) {
        if(node.nodeType !== Node.ELEMENT_NODE) {
          continue;
        }
        if(node.matches?.('input[type="checkbox"]')) {
          wireCheckbox(node);
        }
        node.querySelectorAll?.('input[type="checkbox"]').forEach(wireCheckbox);
      }
    }
  }).observe(document.body, { childList: true, subtree: true });
};

installTwoStateCycleForValueOptions();
