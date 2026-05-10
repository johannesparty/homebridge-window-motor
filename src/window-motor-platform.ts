import type { API, DynamicPlatformPlugin, Logging, PlatformAccessory,
  HAP, PlatformConfig } from 'homebridge';
import { Bonjour, type Service as BonjourService } from 'bonjour-service';
import { FeatureOptions, type Nullable, validateName } from 'homebridge-plugin-utils';

import {
  PLATFORM_NAME, PLUGIN_NAME,
  WINDOW_MOTOR_AUTODISCOVERY_INTERVAL, WINDOW_MOTOR_AUTODISCOVERY_TYPE, WINDOW_MOTOR_AUTODISCOVERY_PROJECT_NAMES,
  WINDOW_MOTOR_EVENT_API_HEARTBEAT_DURATION, WINDOW_MOTOR_HEARTBEAT_DURATION, WINDOW_MOTOR_HEARTBEAT_INTERVAL } from './settings.js';

import { type WindowMotorOptions, featureOptionCategories, featureOptions } from './window-motor-options.js';
import { EventSource } from 'eventsource';
import { WindowMotorAccessory } from './window-motor-device.js';

import net from 'node:net';
import util from 'node:util';


export class WindowMotorPlatform implements DynamicPlatformPlugin {
  private readonly accessories: PlatformAccessory[];
  public readonly api: API;
  private discoveredDevices: { [index: string]: boolean };
  private readonly espHomeEvents: { [index: string]: EventSource };
  private readonly pingTimers: { [index: string]: NodeJS.Timeout };
  public featureOptions: FeatureOptions;
  public config: WindowMotorOptions;
  public readonly configuredDevices: { [index: string]: WindowMotorAccessory };
  public readonly hap: HAP;
  public readonly log: Logging;

  constructor(
    log: Logging,
    config: PlatformConfig,
    api: API) {

    this.accessories = [];
    this.api = api;
    this.config = {};
    this.configuredDevices = {};
    this.discoveredDevices = {};
    this.espHomeEvents = {};
    this.featureOptions = new FeatureOptions(featureOptionCategories, featureOptions, config?.options);
    this.hap = api.hap;
    this.log = log;
    this.log.debug = this.debug.bind(this);
    this.pingTimers = {};

    this.log.debug('Finished constructing WindowMotorPlatform');
    if (!config) {
      return; 
    }

    this.config = {
      debug: config.debug === true,
      options: config.options as string[],
    };

    this.log.debug('Debug logging on. Expect a lot of data.');


    // When this event is fired it means Homebridge has restored all cached accessories from disk.
    // Dynamic Platform plugins should only register new accessories after this event was fired,
    // in order to ensure they weren't added to homebridge already. This event can also be used
    // to start discovery of new accessories.
    api.on('didFinishLaunching', () => {
      log.debug('Executing didFinishLaunching callback');
      this.configureWindowMotorPlatform();
    });

    
    api.on('shutdown', () => {
      log.debug('Executing shutdown callback');
      // Close our events connection.
      Object.values(this.espHomeEvents).map(deviceEvents => deviceEvents.close());

      // Clear any open ping timers.
      Object.values(this.pingTimers).map(timer => clearTimeout(timer));

      // Inform our accessories we're going offline.
      Object.values(this.configuredDevices).map(device => device.updateState({ id: 'availability', state: 'offline' }));
    });

  }

  // This gets called when homebridge restores cached accessories at startup. 
  // We intentionally avoid doing anything significant here, and save all that logic for device discovery.
  public configureAccessory(accessory: PlatformAccessory): void {
    this.log.info(`configureAccessory: Cached: ${accessory.displayName} (${accessory.UUID})`);    
    this.accessories.push(accessory);
  }

  // Configure and connect to Window Motor ESPHome clients.
  private configureWindowMotorPlatform() : void {
    this.log.info('Configuring Window Motor Platform');
  
    // Instantiate our mDNS stack.
    const mdns = new Bonjour();

    // Make sure we cleanup our mDNS client on shutdown.
    this.api.on('shutdown', () => mdns.destroy());

    // Start ESPHome device discovery.
    const mdnsBrowser = mdns.find({ type: WINDOW_MOTOR_AUTODISCOVERY_TYPE }, this.discoverWindowMotorDevice.bind(this));

    // Trigger an initial update of our discovery.
    mdnsBrowser.update();

    // Refresh device discovery regular intervals.
    setInterval(() => mdnsBrowser.update(), WINDOW_MOTOR_AUTODISCOVERY_INTERVAL * 1000);
  }

  // Window motor ESPHome device discovery.
  private discoverWindowMotorDevice(service: BonjourService): void {

    // Define the EventSource error message type.
    interface ESError {
      message?: string,
      status?: number,
      type: string
    }

    // We're only interested in ESPHome window motor devices (and compatible variants) with valid MAC and IP addresses. Otherwise, we're done.
    if((!service.txt?.esphome_version && !service.txt?.version) || !service.txt?.mac || !service.addresses ||
      !WINDOW_MOTOR_AUTODISCOVERY_PROJECT_NAMES.some(project => (service.txt as Record<string, string>)?.project_name?.match(project))) {

      return;
    }

    this.log.debug('discoverWindowMotorDevice: %s', util.inspect(service, { depth: null, sorted: true }));

    // We grab the first address provided for the ESPHome device.
    const address = service.addresses[0];

    // Grab the MAC address. We uppercase it and put it in the familiar colon notation first.
    const mac = (service.txt as Record<string, string>).mac.toUpperCase().replace(/(.{2})(?=.)/g, '$1:');

    // Configure the device.
    const window_motor_accessory = this.configureWindowMotor(address, mac, service.txt);

    // If we've already configured this one, we're done.
    if(!window_motor_accessory) {
      return;
    }

    try {
      // Connect to the window motor ESPHome events API.
      const eventsUrl = 'http://' + address + '/events';
      window_motor_accessory.log.info('Connecting to ESPHome events API at %s', eventsUrl);
      this.espHomeEvents[mac] = new EventSource(eventsUrl);

      // Handle errors in the events API.
      this.espHomeEvents[mac].addEventListener('error', (payload: ESError) => {

        // The eventsource library returns unknown network errors at times. We ignore them.
        if(typeof payload.message === 'undefined') {
          return;
        }

        const getErrorMessage = (payload: ESError): string => {

          const { message } = payload;
          const errorMessage = 'Unrecognized error: ' + util.inspect(payload, { sorted: true });

          if(typeof message !== 'string') {
            return errorMessage;
          }

          if(message.startsWith('connect ECONNREFUSED ')) {
            return 'Connection to the window motor controller refused';
          }

          if(message.startsWith('connect ETIMEDOUT ')) {
            return 'Connection to the window motor controller has timed out';
          }

          if(message.startsWith('connect EHOSTDOWN ')) {
            return 'Unable to connect to the window motor controller. The host appears to be down';
          }

          const errorMessages: { [index: string]: string } = {
            'read ECONNRESET': 'Connection to the window motor controller has been reset',
            'read ETIMEDOUT': 'Connection to the window motor controller has timed out while listening for events',
            'unknown error.': 'An unknown error on the window motor controller has occurred. This will happen occasionally and can generally be ignored',
          };

          return errorMessages[message] ?? errorMessage;
        };

        window_motor_accessory.log.error('%s.', getErrorMessage(payload));
      });

      // Inform the user when we've successfully connected.
      this.espHomeEvents[mac].addEventListener('open', () => {
        window_motor_accessory.updateState({ id: 'availability', state: 'online' });
      });

      // Inform the user about the availability of the events API.
      this.espHomeEvents[mac].addEventListener('ping', () => {

        if(this.pingTimers[mac]) {

          clearTimeout(this.pingTimers[mac]);
          delete this.pingTimers[mac];
        }

        window_motor_accessory.updateState({ id: 'availability', state: 'online' });

        this.pingTimers[mac] = setTimeout(
          () => window_motor_accessory.updateState({ id: 'availability', state: 'offline' }), 
          WINDOW_MOTOR_EVENT_API_HEARTBEAT_DURATION * 1000);
      });

      // Capture log updates from the controller.
      this.espHomeEvents[mac].addEventListener('log', (message: MessageEvent<string>) => {

        // The controller occasionally sends empty status updates - we ignore them.
        if(!message.data.length) {
          return;
        }

        window_motor_accessory.log.debug('Log event received: %s', message.data);
      });

      // Capture state updates from the controller.
      this.espHomeEvents[mac].addEventListener('state', (message: MessageEvent<string>) => {

        // Log the state event received.
        window_motor_accessory.log.debug('State event received: %s', util.inspect(message.data, { sorted: true }));

        // The controller occasionally sends empty status updates - we ignore them.
        if(!message.data.length) {
          return;
        }

        let event;
        try {
          event = JSON.parse(message.data);
        } catch(error) {
          window_motor_accessory.log.error('Unable to parse state message: "%s". Invalid JSON.', message.data);
          return;
        }

        window_motor_accessory.updateState(event);
      });

      // Heartbeat the controller at regular intervals.
      // The ESPHome firmware has a failsafe that auto-reboots the device every 15 minutes if it
      // doesn't receive a native API connection. The failsafe only checks for an open connection,
      // so we periodically reopen one.
      const heartbeat = (): void => {

        const socket = net.createConnection({ host: address, port: 6053 }, () => setTimeout(() => {

          socket.destroy();
        }, WINDOW_MOTOR_HEARTBEAT_DURATION * 1000));

        socket.on('error', (err) => window_motor_accessory.log.debug('Heartbeat error: %s.', util.inspect(err, { sorted: true })));

        socket.on('close', () => setTimeout(() => heartbeat(), WINDOW_MOTOR_HEARTBEAT_INTERVAL * 1000));
      };

      heartbeat();
    } catch(error) {

      if(error instanceof Error) {
        window_motor_accessory.log.error('Window motor API error: %s', error.message);
      }
    }
  }

  private configureWindowMotor(address: string, mac: string, deviceInfo: Record<string, string>): Nullable<WindowMotorAccessory> {

    // eslint-disable-next-line max-len
    this.log.info(`configureWindowMotor: address: ${address}, mac: ${mac}, deviceInfo: ${util.inspect(deviceInfo, { colors: true, depth: null, sorted: true })}`);

    // If we've already discovered this device, we're done.
    if(this.discoveredDevices[mac]) {
      return null;
    }

    // Generate this device's unique identifier.
    const uuid = this.hap.uuid.generate(mac);

    // See if we already know about this accessory or if it's truly new.
    let accessory = this.accessories.find(x => x.UUID === uuid);

    // Our device details.
    const device = {
      address: address,
      firmwareVersion: deviceInfo.version ?? deviceInfo.esphome_version,
      mac: mac.replace(/:/g, ''),
      name: deviceInfo.friendly_name ?? 'Window Motor',
    };

    // Inform the user that we've discovered a device.
    this.log.info('Discovered: %s (address: %s mac: %s ESPHome firmware: v%s).', 
      device.name, device.address, device.mac, device.firmwareVersion,
    );

    // Mark it as discovered.
    this.discoveredDevices[mac] = true;

    // Check to see if the user has disabled the device.
    if(!this.featureOptions.test('Device', device.mac)) {

      // If the accessory already exists, let's remove it.
      if(accessory) {

        // Inform the user.
        this.log.info('%s: Removing device from HomeKit.', accessory.displayName);

        // Unregister the accessory and delete its remnants from HomeKit.
        this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [ accessory ]);
        this.accessories.splice(this.accessories.indexOf(accessory), 1);
      }

      // remove switchAccessory (if exists
      const switchUUID  = this.hap.uuid.generate(mac+'-virtual-switch');
      const switchAccessory = this.accessories.find(x => x.UUID === switchUUID);
      if (switchAccessory) {
        // Create a new accessory for the virtual switch.
        this.log.info('%s: Removing virtual switch from HomeKit (C).', switchAccessory.displayName);
        this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [ switchAccessory ]);
        this.accessories.splice(this.accessories.indexOf(switchAccessory), 1);
      }

      this.api.updatePlatformAccessories(this.accessories);

      // We're done.
      return null;
    }

    // If we've already configured this device before, we're done.
    if(this.configuredDevices[uuid]) {
      return null;
    }

    // It's a new device - let's add it to HomeKit.
    if(!accessory) {
      accessory = new this.api.platformAccessory(validateName(device.name), uuid);

      // Register this accessory with Homebridge and add it to the accessory array so we can track it.
      this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
      this.accessories.push(accessory);
    }

    // Inform the user.
    this.log.info('Configuring: %s (address: %s mac: %s ESPHome firmware: v%s).', 
      device.name, device.address, device.mac, device.firmwareVersion);

    // optionally create switchAccessory
    // manage with both accessories with single WindowMotorAccessory
    const useVirtualSwitch = this.featureOptions.test('Window.Homekit.Switch.WindowClosed', device.mac);
    let switchAccessory: PlatformAccessory | undefined = undefined;
    if (useVirtualSwitch) {
      // If the user has requested a virtual switch, we add it to the accessory. 
      const switchUUID  = this.hap.uuid.generate(mac+'-virtual-switch');
      switchAccessory = this.accessories.find(x => x.UUID === switchUUID);
      if (!switchAccessory) {
        // Create a new accessory for the virtual switch.
        this.log.info('%s: Adding virtual switch to HomeKit.', device.name + ' Window Closed');
        switchAccessory = new this.api.platformAccessory(validateName(device.name + ' Window Closed'), switchUUID);
        this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [switchAccessory]);
        this.accessories.push(switchAccessory);
      }
    } else {
      // remove switchAccessory (if exists
      const switchUUID  = this.hap.uuid.generate(mac+'-virtual-switch');
      const switchAccessory = this.accessories.find(x => x.UUID === switchUUID);
      if (switchAccessory) {
        // Create a new accessory for the virtual switch.
        this.log.info('%s: Removing virtual switch from HomeKit (B).', switchAccessory.displayName);
        this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [ switchAccessory ]);
        this.accessories.splice(this.accessories.indexOf(switchAccessory), 1);
        this.api.updatePlatformAccessories(this.accessories);
      }
    }


    // Add it to our list of configured devices.
    this.configuredDevices[uuid] = new WindowMotorAccessory(this, accessory, switchAccessory, device);

    // Refresh the accessory cache.
    this.api.updatePlatformAccessories([accessory]);
    if (switchAccessory) {
      this.api.updatePlatformAccessories([switchAccessory]);
    }

    return this.configuredDevices[uuid];
  }

  // Utility for debug logging. Routes through log.error so messages are visible in normal Homebridge
  // output when the plugin's `debug` config flag is on, regardless of the homebridge -D flag.
  public debug(message: string, ...parameters: unknown[]): void {

    if(this.config.debug) {

      this.log.error(util.format(message, ...parameters));
    }
  }
}
