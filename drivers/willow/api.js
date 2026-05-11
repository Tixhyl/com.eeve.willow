"use strict";

const axios = require("axios");

class WillowApiError extends Error {
  constructor(message, errorCode) {
    super(message);
    this.name = "WillowApiError";
    this.errorCode = errorCode;
  }
}

class WillowApi {
  constructor(ip, logFn) {
    this.ip = ip;
    this.log = logFn || console.log;
    this.baseUrl = `http://${this.ip}:8080`;
  }

  setIp(ip) {
    this.ip = ip;
    this.baseUrl = `http://${this.ip}:8080`;
  }

  async axiosFetch(endpoint, _timeout = 30000, method = "get", data = null) {
    const url = `${this.baseUrl}${endpoint}`;
    try {
      const config = { timeout: _timeout, method };
      const resp = await axios(url, data ? { ...config, data } : config);
      return resp.data;
    } catch (error) {
      let errCode;
      if (!error.response) {
        // likely a timeout or connection error
        errCode = 1;
      } else if (error.response.status === 404) {
        errCode = 2; // Not found
      } else {
        errCode = 3; // other HTTP error
      }
      throw new WillowApiError(
        `Error fetching ${endpoint}: ${error.message}`,
        errCode,
      );
    }
  }

  async activateEmergency() {
    return this.axiosFetch("/navigation/hardEmergencyStop");
  }

  /** Returns true when in emergency mode */
  async checkInEmergency() {
    const state = await this.axiosFetch("/system/emergencyStop");
    return state?.description !== "none";
  }

  async releaseEmergency() {
    return this.axiosFetch("/navigation/releaseEmergencyStop");
  }

  async startMowing() {
    return this.axiosFetch("/navigation/startmowing");
  }

  async stopMowing() {
    return this.axiosFetch("/navigation/stopmowing");
  }

  async docking() {
    await this.axiosFetch("/navigation/stopmowing");
    return this.axiosFetch("/navigation/startdocking");
  }

  async reboot() {
    return this.axiosFetch("/maintenance/reboot");
  }

  async playSound(volume = 60) {
    this.log("Playing sound with volume", volume);
    return this.axiosFetch(
      `/maintenance/sound/play?fileName=R2D2.wav&volume=${volume}`,
    );
  }

  async stopSound() {
    this.log("Stopping sound");
    return this.axiosFetch("/maintenance/sound/stop");
  }

  async getActivitiesInfo() {
    return this.axiosFetch("/activities/info");
  }

  async getBatteryStatus() {
    return this.axiosFetch("/system/batteryStatus");
  }

  async getBaseboardSensors() {
    return this.axiosFetch("/system/sensors/baseboard");
  }

  async getModuleSensors() {
    return this.axiosFetch("/system/sensors/module");
  }

  async getMowerInfo() {
    return this.axiosFetch("/system/mowerInfo");
  }

  async getDockingInfo() {
    return this.axiosFetch("/system/dockingInfo");
  }

  async getRainSensor() {
    return this.axiosFetch("/statuslog/sensors/rain");
  }

  async getPowerSensor() {
    return this.axiosFetch("/statuslog/sensors/power");
  }

  async getOdometry() {
    return this.axiosFetch("/slam/odometry");
  }

  async getGPS() {
    return this.axiosFetch("/api/statuslog/sensors/gps");
  }

  async getPersonDistance() {
    return this.axiosFetch("/api/slam/distanceToObject/person");
  }
}

module.exports = { WillowApi, WillowApiError };
