// Ratgdo device settings.
export interface WindowMotorDevice {
  address: string,
  firmwareVersion: string,
  mac: string,
  name: string
}

export enum WindowMotorReservedNames {
  HOMEKIT_SWITCH_WINDOW_CLOSED = 'Homekit.Switch.WindowClosed',
}


