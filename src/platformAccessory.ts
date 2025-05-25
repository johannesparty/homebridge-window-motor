import { CharacteristicValue, PlatformAccessory, Service } from 'homebridge';

import { WindowMotorPlatform } from './platform.js';

/**
 * Platform Accessory
 * An instance of this class is created for each accessory your platform registers
 * Each accessory may expose multiple services of different service types.
 */
export class WindowMotorAccessory {
  private service: Service;

  /**
   * These are just used to create a working example
   * You should implement your own code to track the state of your accessory
   */
  private windowState = {
    currentPosition: 0.0, // 0.0 for closed, 1.0 for open
    targetPosition : 0.0, // 0.0 for closed, 1.0 for open
    positionState: 2, // 2 for STOPPED, 1 for INCREASING, 0 for DECREASING
  };

  constructor(
    private readonly platform: WindowMotorPlatform,
    private readonly accessory: PlatformAccessory,
  ) {
    // set accessory information
    this.accessory.getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.platform.Characteristic.Manufacturer, 'Default-Manufacturer')
      .setCharacteristic(this.platform.Characteristic.Model, 'Default-Model')
      .setCharacteristic(this.platform.Characteristic.SerialNumber, 'Default-Serial');

    // get the LightBulb service if it exists, otherwise create a new LightBulb service
    // you can create multiple services for each accessory
    this.service = this.accessory.getService(this.platform.Service.Window) 
                || this.accessory.addService(this.platform.Service.Window);

    // set the service name, this is what is displayed as the default name on the Home app
    // in this example we are using the name we stored in the `accessory.context` in the `discoverDevices` method.
    this.service.setCharacteristic(this.platform.Characteristic.Name, accessory.context.device.exampleDisplayName);

    // each service must implement at-minimum the "required characteristics" for the given service type
    // see https://developers.homebridge.io/#/service/Lightbulb

    // register handlers for CurrentPosition Characteristic
    this.service.getCharacteristic(this.platform.Characteristic.CurrentPosition)
      .onGet(this.getCurrentPosition.bind(this));

    // register handlers for TargetPosition Characteristic
    this.service.getCharacteristic(this.platform.Characteristic.TargetPosition)
      .onGet(this.getTargetPosition.bind(this))
      .onSet(this.setTargetPosition.bind(this)); 

    // register 
    this.service.getCharacteristic(this.platform.Characteristic.PositionState)
      .onGet(this.getPositionState.bind(this));

    /**
     * Updating characteristics values asynchronously.
     *
     * Example showing how to update the state of a Characteristic asynchronously instead
     * of using the `on('get')` handlers.
     * Here we change update the motion sensor trigger states on and off every 10 seconds
     * the `updateCharacteristic` method.
     *
     */
    /*
    let motionDetected = false;
    setInterval(() => {
      // EXAMPLE - inverse the trigger
      motionDetected = !motionDetected;

      // push the new value to HomeKit
      motionSensorOneService.updateCharacteristic(this.platform.Characteristic.MotionDetected, motionDetected);
      motionSensorTwoService.updateCharacteristic(this.platform.Characteristic.MotionDetected, !motionDetected);

      this.platform.log.debug('Triggering motionSensorOneService:', motionDetected);
      this.platform.log.debug('Triggering motionSensorTwoService:', !motionDetected);
    }, 10000);
  */
  }

 
  // CurrentPosition is the position of the device, e.g. 0.0 for closed, 1.0 for open
  async getCurrentPosition(): Promise<CharacteristicValue> {
    // implement your own code to check if the device is on

    const currentPosition = this.windowState.currentPosition;
    this.platform.log.debug('Get Characteristic CurrentPoisition ->', currentPosition);

    // if you need to return an error to show the device as "Not Responding" in the Home app:
    // throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);

    return currentPosition;
  }

  // TargetPosition is the position that the device should move to when the user sets it
  // 0.0 is closed, 1.0 is open
  async getTargetPosition(): Promise<CharacteristicValue> {
    // implement your own code to check the target position of the device
    const targetPosition = this.windowState.targetPosition;
    this.platform.log.debug('Get Characteristic TargetPosition ->', targetPosition);
    return targetPosition;
  }

  async setTargetPosition(value: CharacteristicValue) {
    // implement your own code to set the target position of the device
    // e.g. send a command to the device to move to the specified position 
    this.platform.log.debug('Set Characteristic TargetPosition ->', value);

    if (value === 0) {
      // code to close the window
      this.platform.log.info('Closing the window');
      await fetch('http://192.168.30.187/number/target_position/set?value=0', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
      });
    } else {
      // code to open the window
      this.platform.log.info('Opening the window');
      await fetch('http://192.168.30.187/number/target_position/set?value=100', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
      });
    }
    this.windowState.targetPosition = value.valueOf() as number;
    this.windowState.currentPosition = value.valueOf() as number; // update current position to match target position
    this.windowState.positionState = this.platform.Characteristic.PositionState.STOPPED; // update position state to stopped
    // update the characteristics in HomeKit
    this.service.updateCharacteristic(this.platform.Characteristic.CurrentPosition, this.windowState.currentPosition);
    this.service.updateCharacteristic(this.platform.Characteristic.TargetPosition, this.windowState.targetPosition);
    this.service.updateCharacteristic(this.platform.Characteristic.PositionState, this.windowState.positionState);
  }


  // PositionState is the state of the device, e.g. moving, stopped, etc.
  // values are 0 for STOPPED, 1 for INCREASING, 2 for DECREASING
  async getPositionState(): Promise<CharacteristicValue> {
    // implement your own code to check the position state of the device
    const positionState = this.windowState.positionState;
    this.platform.log.debug('Get Characteristic PositionState ->', positionState);
    return positionState;
  }

}
