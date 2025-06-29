import { API, CharacteristicValue, HAP, PlatformAccessory } from 'homebridge';
import { HomebridgePluginLogging, type Nullable, acquireService, validService, validateName } from 'homebridge-plugin-utils';
import { WINDOW_MOTOR_OPENCLOSE_DURATION, WINDOW_MOTOR_RELAY_DURATION } from './settings.js';
import { WindowMotorDevice, WindowMotorReservedNames } from './window-motor-types.js';
import { WindowMotorOptions } from './window-motor-options.js';
import { WindowMotorPlatform } from './window-motor-platform.js';
import util from 'node:util';

// ESPHome EventSource state messages.
// processed in updateState()
interface EspHomeEvent {
  current_operation?: string,
  id: string,
  name?: string,
  position?: number,
  state: string,
  value?: string
}

// Device-specific options and settings from HomeBridge setup screen
// setup in configureHints()
interface WindowMotorHints {
  logWindowMotor: boolean,
  openCloseDuration: number,
  relayDuration: number,
  builtinContactSensor: boolean,
  homekitWindowClosedSwitch: boolean,
  readOnly: boolean, // not sure how useful this is
}

// WindowMotor status information.
interface WindowMotorStatus {
  availability: boolean,

  // window service
  windowPositionState: CharacteristicValue,
  windowTargetPosition: CharacteristicValue,
  windowCurrentPosition: CharacteristicValue,

  // contact sensor service 
  // set using automation if we don't have built-in contact sensor
  switchOn: CharacteristicValue
}

export class WindowMotorAccessory {
  private readonly accessory: PlatformAccessory;
  private readonly api: API;
  private readonly config: WindowMotorOptions;
  public readonly device: WindowMotorDevice;
  private readonly hap: HAP;
  private readonly hints: WindowMotorHints;

  public readonly log: HomebridgePluginLogging;
  private readonly platform: WindowMotorPlatform;
  private readonly status: WindowMotorStatus;

  // The constructor initializes key variables and calls configureDevice().
  constructor(platform: WindowMotorPlatform, accessory: PlatformAccessory, device: WindowMotorDevice) {

    this.accessory = accessory;
    this.api = platform.api;
    this.status = {} as WindowMotorStatus;
    this.config = platform.config;
    this.hap = this.api.hap;
    this.hints = {} as WindowMotorHints;
    this.device = device;
    this.platform = platform;

    this.log = {
      debug: (message: string, ...parameters: unknown[]): void => platform.debug(util.format(this.name + ': ' + message, ...parameters)),
      error: (message: string, ...parameters: unknown[]): void => platform.log.error(util.format(this.name + ': ' + message, ...parameters)),
      info: (message: string, ...parameters: unknown[]): void => platform.log.info(util.format(this.name + ': ' + message, ...parameters)),
      warn: (message: string, ...parameters: unknown[]): void => platform.log.warn(util.format(this.name + ': ' + message, ...parameters)),
    };

    // Initialize our internal state.
    this.status.availability = false;
    this.status.windowPositionState = this.hap.Characteristic.PositionState.STOPPED;
    this.status.windowCurrentPosition = 0;
    this.status.windowTargetPosition = 0;   
    this.status.switchOn = true;
    this.configureDevice();
  }

  // Configure a garage door accessory for HomeKit.
  private configureDevice(): void {

    // Clean out the context object.
    this.accessory.context = {};

    // Configure ourselves.
    this.configureHints();
    this.configureServiceAccessoryInformation();
    this.configureWindowService();
    this.configureSwitchService();
  }

  // Configure device-specific settings.
  // read using hasFeature() and put in this.hints
  private configureHints(): boolean {
    // Device feature is checked in window-motor-platform in configureWindowMotor

    // Log features
    this.hints.logWindowMotor = this.hasFeature('Log.Opener');

    // Window features
    this.hints.readOnly = this.hasFeature('Window.ReadOnly');
    this.hints.homekitWindowClosedSwitch = this.hasFeature('Window.Homekit.Switch.WindowClosed');
    this.hints.builtinContactSensor = this.hasFeature('Window.Builtin.Closed.Sensor');
    this.hints.openCloseDuration = this.platform.featureOptions.getInteger('Window.OpenCloseDuration', this.device.mac) ?? WINDOW_MOTOR_OPENCLOSE_DURATION;
    this.hints.relayDuration = this.platform.featureOptions.getInteger('Window.RelayDuration', this.device.mac) ?? WINDOW_MOTOR_RELAY_DURATION;
    if(this.hints.readOnly) {
      this.log.info('Window opener is read-only. The opener will not respond to open and close requests from HomeKit.');
    }

    return true;
  }

  // Configure Homekit accessory information
  private configureServiceAccessoryInformation(): boolean {

    // Update the manufacturer information for this device.
    this.accessory.getService(this.hap.Service.AccessoryInformation)?.updateCharacteristic(this.hap.Characteristic.Manufacturer, 'github.com/schmidtparty');

    // Update the model information for this device.
    this.accessory.getService(this.hap.Service.AccessoryInformation)?.updateCharacteristic(this.hap.Characteristic.Model, 'WindowMotor');

    // Update the serial number for this device.
    this.accessory.getService(this.hap.Service.AccessoryInformation)?.updateCharacteristic(this.hap.Characteristic.SerialNumber, this.device.mac);

    // Update the firmware information for this device.
    this.accessory.getService(this.hap.Service.AccessoryInformation)?.updateCharacteristic(this.hap.Characteristic.FirmwareRevision,
      this.device.firmwareVersion);

    return true;
  }

  
  // Configure the Window service for HomeKit.
  // Homekit Window service has
  //    TargetPosition  - get, set
  //    CurrentPosition - get
  //    PositionState   - get
  private configureWindowService(): boolean {

    this.log.info('configuringWindowService for %s', this.name);

    // Acquire the service.
    const service = acquireService(this.hap, this.accessory, this.hap.Service.WindowCovering, this.name);
    if(!service) {
      this.log.error('Unable to add the window service.');
      return false;
    }

  
    // Set the initial current and target door states to closed since windowmotor doesn't tell us initial state on startup.
    service.updateCharacteristic(this.hap.Characteristic.TargetPosition, this.status.windowTargetPosition);
    service.updateCharacteristic(this.hap.Characteristic.PositionState, this.status.windowPositionState);
    service.updateCharacteristic(this.hap.Characteristic.CurrentPosition, this.status.windowCurrentPosition);

    // TargetPosition  
    service.getCharacteristic(this.hap.Characteristic.TargetPosition).onGet(() => {
      this.log.info('onGet TargetPosition: %s', this.status.windowTargetPosition);
      return this.status.windowTargetPosition;
    });
    service.getCharacteristic(this.hap.Characteristic.TargetPosition).onSet((value: CharacteristicValue) => {
      this.log.info('onSet,  TargetPosition: %s', value);
      this.status.windowTargetPosition = value;
      this.setWindowTargetPosition(value); 
    } );

    // PositionState
    service.getCharacteristic(this.hap.Characteristic.PositionState).onGet(() => {
      this.log.info(`onGet PositionState: ${this.status.windowPositionState}`);
      return this.status.windowPositionState; 
    });

    // CurrentPosition
    service.getCharacteristic(this.hap.Characteristic.CurrentPosition).onGet(() => {
      this.log.info(`onGet CurrentPosition: ${this.status.windowCurrentPosition}`);
      return this.status.windowCurrentPosition;
    });

    // Let HomeKit know that this is the primary service on this accessory.
    service.setPrimaryService(true);

    this.log.info('configureWindowService returning true for %s', this.name);

    return true;
  }

  
  // Configure the switch service; set using HomeKit automation in case
  // we don't have built-in contact sensor, automation can set this for us
  // Homekit Switch service has
  //    on  - get, set (bool)
  private configureSwitchService(): boolean {

    // Validate whether we should have this service enabled.
    if(!validService(this.accessory, this.hap.Service.Switch, () => {
      // We only enable this on WindowMotor devices when the user has enabled this capability.
      return this.hints.homekitWindowClosedSwitch;
    }, WindowMotorReservedNames.HOMEKIT_SWITCH_WINDOW_CLOSED)) {
      return false;
    }

    // Acquire the service.
    const service = acquireService(this.hap, this.accessory, this.hap.Service.Switch, 
      this.name + ' Closed', WindowMotorReservedNames.HOMEKIT_SWITCH_WINDOW_CLOSED);

    if(!service) {
      this.log.error('Unable to add the Windows Closed Homekit Switch.');
      return false;
    }

    // Return the current state of the switch.
    service.getCharacteristic(this.hap.Characteristic.On)?.onGet(() => this.status.switchOn);

    // Open or close the switch.
    service.getCharacteristic(this.hap.Characteristic.On)?.onSet((value: CharacteristicValue) => this.status.switchOn = value);

    // Initialize the switch.
    service.updateCharacteristic(this.hap.Characteristic.On, this.status.switchOn);
    this.log.info('Enabling the Homekit Switch service.');

    return true;
  }

  
  
  // Open or close the garage door.
  private setWindowTargetPosition(value: CharacteristicValue): boolean {

    // Understand what we're targeting.
    const target_position = value as number;
    this.log.info('setWindowTargetPosition: %d', target_position);

    // If we have an invalid target state, we're done.
    if(target_position !== 0 && target_position !== 100) {
      this.log.error('target position must be 0 or 100: %s.', target_position);
      return false;
    }

    // If this window door is read-only, we won't process any requests to set state.
    if(this.hints.readOnly) {
      this.log.info('Unable to operate window: read-only mode enabled.');

      // Tell HomeKit that we haven't in fact changed our state so we don't end up in an inadvertent opening or closing state.
      setImmediate(() => {
        this.accessory.getService(this.hap.Service.WindowCovering)?.
          updateCharacteristic(this.hap.Characteristic.TargetPosition, this.status.windowTargetPosition);
        return false;
      });
    }

    // If we are already opening or closing the windowr, we assume the user wants to stop the garage door opener at it's current location.
    // todo

    // Set the window state, assuming we're not already there.

    this.log.info(`User-initiated window position change: ${target_position.toString()}`);

    // Execute the command.
    void this.command('window', target_position === 0 ? 'close' : 'open');

    return true;
  }

  private updateCharacteristics(): void {
    const windowService = this.accessory.getService(this.hap.Service.WindowCovering);
    if(!windowService) {
      this.log.error('Unable to get Window Service');
      return;
    }

  
    // eslint-disable-next-line max-len
    this.log.info(`updateCharacteristics:\n\tPositionState:   ${this.status.windowPositionState}\n\tCurrentPosition: ${this.status.windowCurrentPosition}\n\tTargetPosition:  ${this.status.windowTargetPosition}`);

    this.log.info(`< PositionState is   ${windowService.getCharacteristic(this.hap.Characteristic.PositionState).value}`);
    this.log.info(`< CurrentPosition is ${windowService.getCharacteristic(this.hap.Characteristic.CurrentPosition).value}`);
    this.log.info(`< TargetPosition is  ${windowService.getCharacteristic(this.hap.Characteristic.TargetPosition).value}`);

    windowService.updateCharacteristic(this.hap.Characteristic.TargetPosition, this.status.windowTargetPosition);
    windowService.updateCharacteristic(this.hap.Characteristic.CurrentPosition, this.status.windowCurrentPosition);
    windowService.updateCharacteristic(this.hap.Characteristic.PositionState, this.status.windowPositionState);

    this.log.info(`> PositionState is   ${windowService.getCharacteristic(this.hap.Characteristic.PositionState).value}`);
    this.log.info(`> CurrentPosition is ${windowService.getCharacteristic(this.hap.Characteristic.CurrentPosition).value}`);
    this.log.info(`> TargetPosition is  ${windowService.getCharacteristic(this.hap.Characteristic.TargetPosition).value}`);
    // eslint-disable-next-line max-len
    this.log.info(`  Target Position == Current Position? ${windowService.getCharacteristic(this.hap.Characteristic.CurrentPosition).value === windowService.getCharacteristic(this.hap.Characteristic.TargetPosition).value}`);
  }


  // Update the state of the accessory.
  public updateState(event: EspHomeEvent): void {

    // const camelCase = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);
    // const windowService = this.accessory.getServiceById(this.hap.Service.WindowCovering, 'window_cover');
    const windowService = this.accessory.getService(this.hap.Service.WindowCovering);
    if(!windowService) {
      this.log.error('Unable to get Window Service');
      return;
    }

    // const switchService = this.accessory.getServiceById(this.hap.Service.Switch, WindowMotorReservedNames.HOMEKIT_SWITCH_WINDOW_CLOSED);
    //const switchService = this.accessory.getServiceById(this.hap.Service.Switch, 'Switch.WindowClosed');
    //if (!switchService) {
    //  this.log.error('did not get Switch Service');
    //  return;
    //}

    if (event.id !== 'availability') {
      this.log.info('got updateState with ' + util.inspect(event, { colors: true, depth: null, sorted: true }));
    }
    this.log.info(`event.id: ${event.id}, event.state: ${event.state}, event.position: ${event.position}, event.value: ${event.value}`);
    switch(event.id) {

    case 'availability':

      // Update our availability.

      // Inform the user if our availability state has changed.
      if(this.status.availability !== (event.state === 'online')) {
        this.status.availability = event.state === 'online';
        this.log.info('WindowMotor %s.', this.status.availability ? 'connected' : 'disconnected');
      }

      break;

    case 'number-relay_duration': {
        
      const value = parseInt(event.value ?? '0', 10);
      if (value !== this.hints.relayDuration) {
        this.command('relay_duration', this.hints.relayDuration.toString());
        this.log.info(`relay_duration changed from ${value} to ${this.hints.relayDuration}`);
      }
      break;
    }

    case 'number-open_duration': {

      const value = parseInt(event.value ?? '0', 10);
      if (value !== this.hints.openCloseDuration) {
        this.command('open_duration', this.hints.openCloseDuration.toString());
        this.log.info(`open_duration changed from ${value} to ${this.hints.openCloseDuration}`);
      }
      break;
    }

    case 'cover-window_cover': {

      const position = (event.position ?? 0) * 100;

      // event.current_operation is CLOSING, OPENING, IDLE 
      // event.state             is OPEN, CLOSED
      let state = event.current_operation?.toLowerCase();
      if (state === 'idle') {
        state = event.state.toLowerCase();
      }
      this.log.info(`computed state = ${state}, position = ${position}`);

      switch(state) {

      case 'closing':
        this.status.windowTargetPosition = 0;
        this.status.windowPositionState = this.hap.Characteristic.PositionState.DECREASING;
        this.status.windowCurrentPosition = position;
        break;

      case 'opening':
        this.status.windowTargetPosition = 100;
        this.status.windowPositionState = this.hap.Characteristic.PositionState.INCREASING;
        this.status.windowCurrentPosition = position;
        break;

      case 'open':
        if (position !== 100) { 
          this.log.error(`position is ${position}, should be 100`); 
        }
        this.status.windowPositionState = this.hap.Characteristic.PositionState.STOPPED;
        this.status.windowCurrentPosition = position;
        this.status.windowTargetPosition = position;
        break;

      case 'closed': 
        if (position !== 0) { 
          this.log.error(`position is ${position}, should be 0`); 
        }
        this.status.windowPositionState = this.hap.Characteristic.PositionState.STOPPED;
        this.status.windowCurrentPosition = position;
        this.status.windowTargetPosition = position;
        break;

      default:
        this.log.error('Unknown door operation detected: %s.', event.current_operation);
        this.status.windowCurrentPosition = position;
        break;

      }
    }
      this.updateCharacteristics();
      break;

    case 'default':
      break;
    }
  }

  // Utility function to transmit a command to ESPHome firmware
  // Commands are sent as HTTP POST requests to the ESPHome API.
  
  // led,on
  // led,off

  // window,open
  // window,close
  // 
  // virtual_sensor,on
  // virtual_sensor,off
  // 
  private async command(topic: string, payload = ''): Promise<boolean> {
    let endpoint;
    let action;

    this.log.info(`command(topic ${topic}, payload ${payload})`);

    switch(topic) {

    case 'led':

      endpoint = 'light/relay_led';
      action = (payload === 'on') ? 'turn_on' : 'turn_off';
      break;

    case 'window':

      endpoint = 'cover/window_cover';

      switch(payload) {

      case 'open':
        action = 'open';
        break;

      case 'close':
        action = 'close';
        break;

      default:
        this.log.error('Unknown window command received: %s.', payload);
      }
      break;

    case 'virtual_sensor':

      endpoint = 'switch/virtual_window_sensor';

      switch(payload) {

      case 'on':
        action = 'turn_on';
        break;

      case 'off':
        action = 'turn_off';
        break;

      default:
        this.log.error('Unknown virtual_sensor command received: %s.', payload);
        return false;
      }
      break;  

    case 'relay_duration':

      endpoint = 'number/relay_duration';
      action = 'set?value=' + payload;
      break;

    case 'open_duration':

      endpoint = 'number/open_duration';  
      action = 'set?value=' + payload;
      break;

    default:

      this.log.error('Unknown command received: %s - %s.', topic, payload);
      return false;
    }

    try {

      // Execute the action.
      // TODO: consider adding timeout; see AbortController
      const response = await fetch('http://' + this.device.address + '/' + endpoint + '/' + action, { 
        body: JSON.stringify({}), 
        method: 'POST' });

      if(!response?.ok) {
        this.log.error('Unable to execute command: %s - %s.', topic, action);
        return false;
      }

    } catch(error) {

      let errorMessage = '\n' + util.inspect(error, { colors: true, depth: null, sorted: true });

      if(error instanceof TypeError) {

        switch((error.cause as NodeJS.ErrnoException)?.code) {

        case 'ECONNRESET':

          errorMessage = 'Connection to the WindowMotor controller has been reset';
          break;

        case 'EHOSTDOWN':

          errorMessage = 'Connection to the WindowMotor controller has been reset';
          break;

        case 'ETIMEDOUT':
        case 'UND_ERR_BODY_TIMEOUT':
        case 'UND_ERR_CONNECT_TIMEOUT':
        case 'UND_ERR_HEADERS_TIMEOUT':

          errorMessage = 'Connection to the WindowMotor controller has timed out';

          break;

        default:

          errorMessage = ' ' + (error.cause as NodeJS.ErrnoException)?.code + ' (errno: ' + (error.cause as NodeJS.ErrnoException)?.errno?.toString() + ')\n' +
              util.inspect(error.cause, { depth: null, sorted: true });

          break;
        }
      }

      this.log.error('WindowMotor API error sending command:%s', errorMessage);

      return false;
    }

    return true;
  }

  

  // Utility for checking feature options on a device.
  private hasFeature(option: string): boolean {

    return this.platform.featureOptions.test(option, this.device.mac);
  }

  // Utility function to return the name of this device.
  private get name(): string {

    // We use the garage door service as the natural proxy for the name.
    let name = this.accessory.getService(this.hap.Service.GarageDoorOpener)?.getCharacteristic(this.hap.Characteristic.Name).value as string;

    if(name?.length) {

      return name;
    }

    name = this.accessory.displayName;

    if(name?.length) {

      return name;
    }

    // If we don't have a name for the garage door service, return the device name from WindowMotor.
    return this.device.name;
  }

  // Utility function to return the current accessory name of this device.
  private get accessoryName(): string {

    return (this.accessory.getService(this.hap.Service.AccessoryInformation)?.
      getCharacteristic(this.hap.Characteristic.Name).value as string) ?? this.device.name;
  }

  // Utility function to set the current accessory name of this device.
  private set accessoryName(name: string) {

    const cleanedName = validateName(name);

    // Set all the internally managed names within Homebridge to the new accessory name.
    this.accessory.displayName = cleanedName;
    this.accessory._associatedHAPAccessory.displayName = cleanedName;

    // Set all the HomeKit-visible names.
    this.accessory.getService(this.hap.Service.AccessoryInformation)?.updateCharacteristic(this.hap.Characteristic.Name, cleanedName);
  }
}
