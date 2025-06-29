import type { API /* ,Characteristic */, DynamicPlatformPlugin, Logging, PlatformAccessory, 
  HAP, PlatformConfig /* ,Service as HomeBridgeService */ } from 'homebridge';
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


/**
 * HomebridgePlatform
 * This class is the main constructor for your plugin, this is where you should
 * parse the user config and discover/register accessories with Homebridge.
 */
export class WindowMotorPlatform implements DynamicPlatformPlugin {
  private readonly accessories: PlatformAccessory[];
  public readonly api: API;
  private discoveredDevices: { [index: string]: boolean };
  private readonly espHomeEvents: { [index: string]: EventSource };
  private readonly pingTimers: { [index: string]: NodeJS.Timeout } = {};
  public featureOptions: FeatureOptions;
  public config: WindowMotorOptions;
  // configOptions: string[]  
  public readonly configuredDevices: { [index: string]: WindowMotorAccessory };
  public readonly hap: HAP;
  public readonly log: Logging;

  // public readonly Service: typeof HomeBridgeService;
  // public readonly Characteristic: typeof Characteristic;
  // this is used to track restored cached accessories
  //public readonly accessories: Map<string, PlatformAccessory> = new Map();
  // public readonly discoveredCacheUUIDs: string[] = [];


  
  constructor(
    log: Logging,
    config: PlatformConfig,
    api: API) {
    // public readonly config: PlatformConfig,
      
    this.accessories = [];
    this.api = api;
    this.config = {};
    // this.configOptions = [];
    this.configuredDevices = {};
    this.discoveredDevices = {};
    this.espHomeEvents = {};
    this.featureOptions = new FeatureOptions(featureOptionCategories, featureOptions, config?.options);
    this.hap = api.hap;
    this.log = log;
    this.log.debug = this.debug.bind(this);
    this.pingTimers = {};

    // this.Service = api.hap.Service;
    // this.Characteristic = api.hap.Characteristic;

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
      // run the method to discover / register your devices as accessories
      // this.discoverDevices();
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
    // Add this to the accessory array so we can track it.
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

  // WINDOW_MOTOR ESPHome device discovery.
  private discoverWindowMotorDevice(service: BonjourService): void {

    // Define the EventSource error message type.
    interface ESError {
      message?: string,
      status?: number,
      type: string
    }

    // We're only interested in ESPHome WINDOW_MOTOR devices (and compatible variants) with valid MAC and IP addresses. Otherwise, we're done.
    if((!service.txt?.esphome_version && !service.txt?.version) || !service.txt?.mac || !service.addresses ||
      !WINDOW_MOTOR_AUTODISCOVERY_PROJECT_NAMES.some(project => (service.txt as Record<string, string>)?.project_name?.match(project))) {

      return;
    }

    console.log('Discovered service: ', util.inspect(service, { colors: true, depth: null, sorted: true }));

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
      // Connect to the WINDOW_MOTOR ESPHome events API.
      this.espHomeEvents[mac] = new EventSource('http://' + address + '/events');

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
            return 'Connection to the WINDOW_MOTOR controller refused';
          }

          if(message.startsWith('connect ETIMEDOUT ')) {
            return 'Connection to the WINDOW_MOTOR controller has timed out';
          }

          if(message.startsWith('connect EHOSTDOWN ')) {
            return 'Unable to connect to the WINDOW_MOTOR controller. The host appears to be down';
          }

          const errorMessages: { [index: string]: string } = {
            'read ECONNRESET': 'Connection to the WINDOW_MOTOR controller has been reset',
            'read ETIMEDOUT': 'Connection to the WINDOW_MOTOR controller has timed out while listening for events',
            'unknown error.': 'An unknown error on the WINDOW_MOTOR controller has occurred. This will happen occasionally and can generally be ignored',
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

        window_motor_accessory.log.debug('Log event received: %s', message);

        // WINDOW_MOTOR occasionally sends empty status updates - we ignore them.
        if(!message.data.length) {
          return;
        }

      });

      // Capture state updates from the controller.
      this.espHomeEvents[mac].addEventListener('state', (message: MessageEvent<string>) => {

        // Log the state event received.
        window_motor_accessory.log.debug('State event received: %s', util.inspect(message.data, { sorted: true }));

        // WINDOW_MOTOR occasionally sends empty status updates - we ignore them.
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

      // Heartbeat the WINDOW_MOTOR controller at regular intervals. 
      // We need to do this because the ESPHome firmware for WINDOW_MOTOR has a failsafe that will autoreboot the
      // WINDOW_MOTOR every 15 minutes if it doesn't receive a native API connection. 
      // Fortunately, the failsafe only looks for an open connection to the API, allowing us the
      // opportunity to heartbeat it with a connection we periodically reopen.
      const heartbeat = (): void => {

        // Connect to the WINDOW_MOTOR, and setup our heartbeat to close after a configured duration.
        const socket = net.createConnection({ host: address, port: 6053 }, () => setTimeout(() => {

          socket.destroy();
        }, WINDOW_MOTOR_HEARTBEAT_DURATION * 1000));

        // Handle heartbeat errors.
        socket.on('error', (err) => window_motor_accessory.log.debug('Heartbeat error: %s.', util.inspect(err, { sorted: true })));

        // Perpetually restart our heartbeat when it ends.
        socket.on('close', () => setTimeout(() => heartbeat(), WINDOW_MOTOR_HEARTBEAT_INTERVAL * 1000));
      };

      heartbeat();
    } catch(error) {

      if(error instanceof Error) {
        window_motor_accessory.log.error('WINDOW_MOTOR API error: %s', error.message);
      }
    }
  }

  private configureWindowMotor(address: string, mac: string, deviceInfo: Record<string, string>): Nullable<WindowMotorAccessory> {

    // If we've already discovered this device, we're done.
    if(this.discoveredDevices[mac]) {
      return null;
    }

    // Generate this device's unique identifier.
    const uuid = this.hap.uuid.generate(mac);

    // See if we already know about this accessory or if it's truly new.
    let accessory = this.accessories.find(x => x.UUID === uuid);
    // let accessory = Array.from(this.accessories.values()).find(x => x.UUID === uuid);

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
        this.api.updatePlatformAccessories(this.accessories);
      }

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

    // Add it to our list of configured devices.
    this.configuredDevices[uuid] = new WindowMotorAccessory(this, accessory, device);

    // Refresh the accessory cache.
    this.api.updatePlatformAccessories([accessory]);

    return this.configuredDevices[uuid];
  }

  // Utility for debug logging.
  public debug(message: string, ...parameters: unknown[]): void {

    if(this.config.debug) {

      this.log.error(util.format(message, ...parameters));
    }
  }


  // /**
  //  * This function is invoked when homebridge restores cached accessories from disk at startup.
  //  * It should be used to set up event handlers for characteristics and update respective values.
  //  */
  // configureAccessory(accessory: PlatformAccessory) {
  //   this.log.info('Loading accessory from cache:', accessory.displayName);

  //   // add the restored accessory to the accessories cache, so we can track if it has already been registered
  //   this.accessories.set(accessory.UUID, accessory);
  // }

  // /**
  //  * This is an example method showing how to register discovered accessories.
  //  * Accessories must only be registered once, previously created accessories
  //  * must not be registered again to prevent "duplicate UUID" errors.
  //  */
  // discoverDevices() {
  //   // EXAMPLE ONLY
  //   // A real plugin you would discover accessories from the local network, cloud services
  //   // or a user-defined array in the platform config.
  //   const exampleDevices = [
  //     {
  //       exampleUniqueId: 'abc1234',
  //       exampleDisplayName: 'Left Blind',
  //       url: 'http://window-motor-lr-left.local/',
  //     },
  //     // {
  //     //   exampleUniqueId: 'abc8790',
  //     //   exampleDisplayName: 'Right Blind',
  //     // },
  //   ];

  //   // loop over the discovered devices and register each one if it has not already been registered
  //   for (const device of exampleDevices) {
  //     // generate a unique id for the accessory this should be generated from
  //     // something globally unique, but constant, for example, the device serial
  //     // number or MAC address
  //     const uuid = this.api.hap.uuid.generate(device.exampleUniqueId);

  //     // see if an accessory with the same uuid has already been registered and restored from
  //     // the cached devices we stored in the `configureAccessory` method above
  //     const existingAccessory = this.accessories.get(uuid);

  //     if (existingAccessory) {
  //       // the accessory already exists
  //       this.log.info('Restoring existing accessory from cache:', existingAccessory.displayName);

  //       // if you need to update the accessory.context then you should run `api.updatePlatformAccessories`. e.g.:
  //       // existingAccessory.context.device = device;
  //       // this.api.updatePlatformAccessories([existingAccessory]);

  //       // create the accessory handler for the restored accessory
  //       // this is imported from `platformAccessory.ts`
  //       new WindowMotorAccessory(this, existingAccessory);

  //       // it is possible to remove platform accessories at any time using `api.unregisterPlatformAccessories`, e.g.:
  //       // remove platform accessories when no longer present
  //       // this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [existingAccessory]);
  //       // this.log.info('Removing existing accessory from cache:', existingAccessory.displayName);
  //     } else {
  //       // the accessory does not yet exist, so we need to create it
  //       this.log.info('Adding new accessory:', device.exampleDisplayName);

  //       // create a new accessory
  //       const accessory = new this.api.platformAccessory(device.exampleDisplayName, uuid);

  //       // store a copy of the device object in the `accessory.context`
  //       // the `context` property can be used to store any data about the accessory you may need
  //       accessory.context.device = device;

  //       // create the accessory handler for the newly create accessory
  //       // this is imported from `platformAccessory.ts`
  //       new WindowMotorAccessory(this, accessory);

  //       // link the accessory to your platform
  //       this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
  //     }

  //     // push into discoveredCacheUUIDs
  //     this.discoveredCacheUUIDs.push(uuid);
  //   }

  //   // you can also deal with accessories from the cache which are no longer present by removing them from Homebridge
  //   // for example, if your plugin logs into a cloud account to retrieve a device list, and a user has previously removed a device
  //   // from this cloud account, then this device will no longer be present in the device list but will still be in the Homebridge cache
  //   for (const [uuid, accessory] of this.accessories) {
  //     if (!this.discoveredCacheUUIDs.includes(uuid)) {
  //       this.log.info('Removing existing accessory from cache:', accessory.displayName);
  //       this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
  //     }
  //   }
  // }
}
