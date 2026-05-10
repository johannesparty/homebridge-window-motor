import { API, CharacteristicValue, HAP, PlatformAccessory } from 'homebridge';
import { HomebridgePluginLogging, acquireService, validateName } from 'homebridge-plugin-utils';
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
  sensorType: 'none' | 'gpio' | 'virtual';
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
  private readonly switchAccessory?: PlatformAccessory;
  private readonly api: API;
  private readonly config: WindowMotorOptions;
  public readonly device: WindowMotorDevice;
  private readonly hap: HAP;
  private readonly hints: WindowMotorHints;

  public readonly log: HomebridgePluginLogging;
  private readonly platform: WindowMotorPlatform;
  private readonly status: WindowMotorStatus;

  // Tracks the most recent in-flight command so we can detect when a command is sent
  // but no state event ever arrives — useful for diagnosing the "I told it to open and
  // nothing happened" failure mode.
  private pendingCommand?: { topic: string, payload: string, sentAt: number, watchdog: NodeJS.Timeout };

  // The constructor initializes key variables and calls configureDevice().
  constructor(platform: WindowMotorPlatform, accessory: PlatformAccessory, switchAccessory: PlatformAccessory | undefined, device: WindowMotorDevice) {

    this.accessory = accessory;
    this.switchAccessory = switchAccessory;
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

  // Configure the window motor accessory for HomeKit.
  private configureDevice(): void {

    // Clean out the context object.
    this.accessory.context = {};

    // Configure ourselves.
    this.configureHints();
    this.configureServiceAccessoryInformation();
    this.configureWindowService();
    this.configureSwitchService();

    // Set the accessory name.
    this.accessoryName = this.device.name;
  }

  // Configure device-specific settings.
  // read using hasFeature() and put in this.hints
  private configureHints(): boolean {
    // Device feature is checked in window-motor-platform in configureWindowMotor

    // Log features
    this.hints.logWindowMotor = this.hasFeature('Log.Opener');

    // Window features
    this.hints.readOnly = this.hasFeature('Window.ReadOnly');

    this.hints.sensorType = 'none';
    if (this.hasFeature('Window.Builtin.Closed.Sensor')) {
      this.hints.sensorType = 'gpio';
      if (this.hasFeature('Window.Homekit.Switch.WindowClosed')) {
        this.log.warn('builtin contact sensor overwriting virtual window sensor');
      }
    } else if (this.hasFeature('Window.Homekit.Switch.WindowClosed')) {
      this.hints.sensorType = 'virtual';
    }

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
    const service = acquireService(this.hap, this.accessory, this.hap.Service.Window, this.name);
    if(!service) {
      this.log.error('Unable to add the window service.');
      return false;
    }

  
    // Set the initial current and target positions to closed since the device doesn't tell us its initial state on startup.
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

    if (!this.switchAccessory) {
      return false;
    }

    // configure AccessoryInformation service
    this.switchAccessory.getService(this.hap.Service.AccessoryInformation)?.
      updateCharacteristic(this.hap.Characteristic.Manufacturer, 'github.com/schmidtparty');
    this.switchAccessory.getService(this.hap.Service.AccessoryInformation)?.
      updateCharacteristic(this.hap.Characteristic.Model, 'WindowMotorSwitch');
    this.switchAccessory.getService(this.hap.Service.AccessoryInformation)?.updateCharacteristic(this.hap.Characteristic.SerialNumber, this.device.mac);
    this.switchAccessory.getService(this.hap.Service.AccessoryInformation)?.updateCharacteristic(this.hap.Characteristic.FirmwareRevision,
      this.device.firmwareVersion);


    // Acquire the service.
    const service = acquireService(this.hap, this.switchAccessory, this.hap.Service.Switch, 
      this.name + ' Closed', WindowMotorReservedNames.HOMEKIT_SWITCH_WINDOW_CLOSED);

    if(!service) {
      this.log.error('Unable to add the Windows Closed Homekit Switch.');
      return false;
    }

    // Return the current state of the switch.
    service.getCharacteristic(this.hap.Characteristic.On)?.onGet(() => this.status.switchOn);

    // Open or close the switch.
    service.getCharacteristic(this.hap.Characteristic.On)?.onSet((value: CharacteristicValue) => {
      this.log.info('virtual switch set to %s', value);
      this.command('virtual_window_sensor', value ? 'on' : 'off');
      this.status.switchOn = value; 
    });

    // Initialize the switch.
    service.updateCharacteristic(this.hap.Characteristic.On, this.status.switchOn);
    this.log.info('Enabling the Homekit Switch service.');

    return true;
  }
  
  // Open or close the window.
  private setWindowTargetPosition(value: CharacteristicValue): boolean {

    const target_position = value as number;
    this.log.info('setWindowTargetPosition: %d (availability=%s)', target_position, this.status.availability);

    if(target_position !== 0 && target_position !== 100) {
      this.log.error('target position must be 0 or 100: %s.', target_position);
      return false;
    }

    if(!this.status.availability) {
      this.log.warn('Issuing command while device is reported offline; the command may fail or the response may be delayed.');
    }

    if(this.hints.readOnly) {
      this.log.info('Unable to operate window: read-only mode enabled.');

      // Tell HomeKit that we haven't in fact changed our state so we don't end up in an inadvertent opening or closing state.
      setImmediate(() => {
        this.accessory.getService(this.hap.Service.Window)?.
          updateCharacteristic(this.hap.Characteristic.TargetPosition, this.status.windowTargetPosition);
        return false;
      });
      return false;
    }

    this.log.info(`User-initiated window position change: ${target_position.toString()}`);

    void this.command('window', target_position === 0 ? 'close' : 'open');

    return true;
  }

  private updateCharacteristics(): void {
    const windowService = this.accessory.getService(this.hap.Service.Window);
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

    const windowService = this.accessory.getService(this.hap.Service.Window);
    if(!windowService) {
      this.log.error('Unable to get Window Service');
      return;
    }

    // Skip the per-event log for availability pings (every ~10s); only log when event is interesting.
    // Format only defined fields.
    if (event.id !== 'availability') {
      const fields = Object.entries(event)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => `event.${k}: ${v}`)
        .join(', ');
      this.log.info(fields);
    }
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
        this.log.info(`relay_duration changed back from ${value} to ${this.hints.relayDuration}`);
      }
      break;
    }

    case 'number-open_duration': {

      const value = parseInt(event.value ?? '0', 10);
      if (value !== this.hints.openCloseDuration) {
        this.command('open_duration', this.hints.openCloseDuration.toString());
        this.log.info(`open_duration changed back from ${value} to ${this.hints.openCloseDuration}`);
      }
      break;
    }

    case 'switch-virtual_window_sensor': {

      const value = parseInt(event.value ?? '0', 10);
      if (value !== this.status.switchOn) {
        this.command('virtual_window_sensor', this.status.switchOn ? 'on' : 'off');
        this.log.info(`virtual_window_sensor changed back to ${this.status.switchOn}`);
      }
      break;
    }

    case 'select-sensor_type': {

      this.log.info(`select-sensor_type: ${event.value}, sensorType: ${this.hints.sensorType}`);
      if (event.value !== this.hints.sensorType) {
        this.command('sensor_type', this.hints.sensorType);
        this.log.info(`sensor_type changed back to ${this.hints.sensorType}`);
      }
      break;
    }

    case 'cover-window_cover': {

      // Got a state event from the cover — any in-flight watchdog can be cleared.
      if(this.pendingCommand) {
        const elapsed = Date.now() - this.pendingCommand.sentAt;
        this.log.info('Cover state event received %dms after %s/%s; clearing watchdog.',
          elapsed, this.pendingCommand.topic, this.pendingCommand.payload);
        this.clearPendingCommandWatchdog();
      }

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

  // Utility function to transmit a command to the ESPHome firmware over HTTP.
  // Supported topics:
  //   led                     payload: on | off
  //   window                  payload: open | close
  //   virtual_window_sensor   payload: on | off
  //   sensor_type             payload: none | gpio | virtual
  //   relay_duration          payload: <seconds>
  //   open_duration           payload: <seconds>
  private async command(topic: string, payload = ''): Promise<boolean> {
    let endpoint;
    let action;

    // Short correlation id so command -> response -> state-event can be matched in the log.
    const cid = Math.random().toString(36).slice(2, 8);
    const t0 = Date.now();
    this.log.info('[cmd %s] command(topic=%s, payload=%s)', cid, topic, payload);

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
        this.log.error('[cmd %s] Unknown window command received: %s.', cid, payload);
        return false;
      }
      break;

    case 'virtual_window_sensor':

      endpoint = 'switch/virtual_window_sensor';

      switch(payload) {

      case 'on':
        this.status.switchOn = true;
        action = 'turn_on';
        break;

      case 'off':
        this.status.switchOn = false;
        action = 'turn_off';
        break;

      default:
        this.log.error('[cmd %s] Unknown virtual_window_sensor command received: %s.', cid, payload);
        return false;
      }
      break;

    case 'sensor_type': // none, gpio, virtual

      endpoint = 'select/sensor_type';
      action = 'set?option=' + payload;
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

      this.log.error('[cmd %s] Unknown command received: %s - %s.', cid, topic, payload);
      return false;
    }

    const url = 'http://' + this.device.address + '/' + endpoint + '/' + action;

    // For window-movement commands, set up a watchdog so we notice if no state event arrives.
    if(topic === 'window') {
      this.armPendingCommandWatchdog(cid, topic, payload);
    }

    try {

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10_000);

      this.log.info('[cmd %s] POST %s', cid, url);
      const response = await fetch(url, {
        body: JSON.stringify({}),
        method: 'POST',
        signal: controller.signal,
      });
      clearTimeout(timeout);

      const elapsed = Date.now() - t0;
      this.log.info('[cmd %s] response: HTTP %d %s (%dms)', cid, response.status, response.statusText, elapsed);

      if(!response.ok) {
        // Try to surface the body — ESPHome typically returns plain text or a short error.
        let bodyText = '';
        try {
          bodyText = (await response.text()).slice(0, 500);
        } catch {
          // ignore
        }
        this.log.error('[cmd %s] non-OK response for %s/%s: HTTP %d %s body=%s',
          cid, topic, action, response.status, response.statusText, bodyText);
        this.clearPendingCommandWatchdog();
        return false;
      }

    } catch(error) {

      const elapsed = Date.now() - t0;
      let errorMessage = '\n' + util.inspect(error, { depth: null, sorted: true });

      if((error as Error)?.name === 'AbortError') {
        errorMessage = 'fetch aborted after 10s timeout';
      } else if(error instanceof TypeError) {

        const code = (error.cause as NodeJS.ErrnoException)?.code;
        switch(code) {

        case 'ECONNRESET':
          errorMessage = 'Connection to the window motor controller has been reset';
          break;

        case 'EHOSTDOWN':
        case 'EHOSTUNREACH':
          errorMessage = 'Window motor controller is unreachable (host down)';
          break;

        case 'ETIMEDOUT':
        case 'UND_ERR_BODY_TIMEOUT':
        case 'UND_ERR_CONNECT_TIMEOUT':
        case 'UND_ERR_HEADERS_TIMEOUT':
          errorMessage = 'Connection to the window motor controller has timed out';
          break;

        default:
          errorMessage = (code ?? 'unknown') + ' (errno: ' + (error.cause as NodeJS.ErrnoException)?.errno?.toString() + ')\n' +
              util.inspect(error.cause, { depth: null, sorted: true });
          break;
        }
      }

      this.log.error('[cmd %s] window motor API error after %dms: %s', cid, elapsed, errorMessage);
      this.clearPendingCommandWatchdog();
      return false;
    }

    return true;
  }

  // Arm a watchdog after sending a movement command. If we don't hear back via the
  // ESPHome event stream within a reasonable window, log loudly so the failure mode
  // (HomeKit said "open" but nothing happened) is visible in the logs.
  private armPendingCommandWatchdog(cid: string, topic: string, payload: string): void {
    this.clearPendingCommandWatchdog();

    // open_action waits roughly relayDuration + openCloseDuration; give it a 5s margin.
    const expectedMs = (this.hints.openCloseDuration + this.hints.relayDuration + 5) * 1000;

    const watchdog = setTimeout(() => {
      this.log.error('[cmd %s] WATCHDOG: no cover-window_cover state event observed within %dms of %s/%s. ' +
        'The HTTP POST succeeded but the device did not report progress. ' +
        'Check the device web UI at http://%s/ to see whether it actually moved, ' +
        'and whether ESPHome event stream is connected (check for "open"/"ping" log lines from this plugin).',
      cid, expectedMs, topic, payload, this.device.address);
      this.pendingCommand = undefined;
    }, expectedMs);

    this.pendingCommand = { topic, payload, sentAt: Date.now(), watchdog };
  }

  private clearPendingCommandWatchdog(): void {
    if(this.pendingCommand) {
      clearTimeout(this.pendingCommand.watchdog);
      this.pendingCommand = undefined;
    }
  }

  

  // Utility for checking feature options on a device.
  private hasFeature(option: string): boolean {

    return this.platform.featureOptions.test(option, this.device.mac);
  }

  // Utility function to return the name of this device.
  private get name(): string {

    // Prefer the Window service Name characteristic if set.
    let name = this.accessory.getService(this.hap.Service.Window)?.getCharacteristic(this.hap.Characteristic.Name).value as string;

    if(name?.length) {
      return name;
    }

    name = this.accessory.displayName;

    if(name?.length) {
      return name;
    }

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
