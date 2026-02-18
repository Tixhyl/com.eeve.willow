"use strict";

const { Device } = require("homey");
const fetch = require("node-fetch");
const { WillowApi, WillowApiError } = require("./api");

class MyDevice extends Device {
  async onInit() {
    this.alive = true;
    this.is_error = false;
    this.error_message = "";
    this.ip = this.getSettings().ipaddress;
    this.rtsp_url = this.getSettings().rtsp_url;
    this.interval = this.getSettings().interval;
    this.person_detected = false;
    this.person_detected_flag = false;

    // Initialize the API instance
    this.api = new WillowApi(this.ip, this.log.bind(this));

    const state = await this.api.checkInEmergency();
    this.log("EmergencyState is", state);
    // Add capabilities if they do not exist
    await this.addMissingCapabilities([
      "measure_current.mower_current",
      "measure_current.left_wheel_current",
      "measure_current.right_wheel_current",
      "measure_voltage.battery_voltage",
      "measure_voltage.receiver_voltage",
      "accuracy",
      "measure_location_latitude",
      "measure_location_longitude",
    ]);

    // Remove legacy capabilities if needed
    if (this.hasCapability("measure_noise")) {
      await this.removeCapability("measure_noise");
    }

    this.registerFlows();

    // Set camera image
    this.myImage = await this.homey.images.createImage();
    this.myImage.setStream(async (stream) => {
      const res = await fetch(`http://${this.ip}:8080/image/front/img.jpg`);
      if (!res.ok) throw new Error("Invalid Response");
      return res.body.pipe(stream);
    });

    this.setCameraImage("front", this.homey.__("camera"), this.myImage).catch(
      (err) => this.error("Failed to set camera image:", err)
    );

    // Update the image every 2 seconds
    setInterval(() => {
      this.myImage.update().catch(this.error);
    }, 2000);

    // Initial parameter retrieval
    this.getParameters(true).catch((err) => this.handleApiError(err));
    this.getPersonDetection(true).catch((err) => this.handleApiError(err));

    // Setup camera video
    await this.setupCameraVideo();

    this.log("Willow has been initialized");
  }

  async setupCameraVideo() {
    try {
      const video = await this.homey.videos.createVideoRTSP({
        allowInvalidCertificates: true,
        demuxer: "h265",
      });

      /*
       * The video url listener takes no arguments. It simply builds the
       * URL to the RTSP stream using the username and password.
       */
      video.registerVideoUrlListener(async () => {
        return {
          url: this.rtsp_url,
        };
      });

      /*
       * Attach the camera to the device.
       */
      await this.setCameraVideo("", "Willow Camera", video);

      // Store the video instance for potential updates
      this.video = video;
    } catch (err) {
      this.error("Error creating camera:", err);
    }
  }

  async getFrontImage() {
    if (this.myImage) return this.myImage;
  }

  async goDocking() {
    await this.safeApiCall(() => this.api.docking());
    await this.getParameters();
  }

  registerFlows() {
    // Register capability listeners and flows
    this.registerCapabilityListener("button.emergency", async () => {
      await this.safeApiCall(() => this.api.activateEmergency());
      await this.getParameters();
    });

    this.homey.flow
      .getActionCard("activate-emergency")
      .registerRunListener(async () => {
        await this.safeApiCall(() => this.api.activateEmergency());
        await this.getParameters();
      });

    this.registerCapabilityListener("button.release_emergency", async () => {
      await this.safeApiCall(() => this.api.releaseEmergency());
      await this.getParameters();
    });
    this.homey.flow
      .getActionCard("release-emergency")
      .registerRunListener(async () => {
        await this.safeApiCall(() => this.api.releaseEmergency());
        await this.getParameters();
      });

    this.registerCapabilityListener("button.start_mowing", async () => {
      await this.safeApiCall(() => this.api.startMowing());
      await this.getParameters();
    });
    this.homey.flow
      .getActionCard("start-random-mowing")
      .registerRunListener(async () => {
        await this.safeApiCall(() => this.api.startMowing());
        await this.getParameters();
      });

    this.registerCapabilityListener("button.stop_mowing", async () => {
      await this.safeApiCall(() => this.api.stopMowing());
      await this.getParameters();
    });
    this.homey.flow
      .getActionCard("stop-random-mowing")
      .registerRunListener(async () => {
        await this.safeApiCall(() => this.api.stopMowing());
        await this.getParameters();
      });

    this.registerCapabilityListener("button.docking", async () => {
      await this.goDocking();
    });
    this.homey.flow
      .getActionCard("go-docking")
      .registerRunListener(async () => {
        await this.goDocking();
      });

    this.registerCapabilityListener("button.reboot", async () => {
      await this.safeApiCall(() => this.api.reboot());
      await this.getParameters();
    });
    this.homey.flow.getActionCard("reboot").registerRunListener(async () => {
      await this.safeApiCall(() => this.api.reboot());
      await this.getParameters();
    });

    this.homey.flow
      .getActionCard("play-sound")
      .registerRunListener(async (args) => {
        await this.safeApiCall(() => this.api.playSound(args.Volume));
      });
    this.homey.flow
      .getActionCard("stop-sound")
      .registerRunListener(async () => {
        await this.safeApiCall(() => this.api.stopSound());
      });

    // Conditions
    this.homey.flow
      .getConditionCard("is-in-emergency-stop")
      .registerRunListener(async () => {
        await this.getParameters();
        return this.scheduledActivity === "EmergencyStop";
      });

    this.homey.flow
      .getConditionCard("is-mowing")
      .registerRunListener(async () => {
        await this.getParameters();
        return (
          this.userActivity === "MowActivity" ||
          this.scheduledActivity === "MowingPlannerActivity"
        );
      });
  }

  async addMissingCapabilities(capabilities) {
    for (const cap of capabilities) {
      if (!this.hasCapability(cap)) {
        await this.addCapability(cap);
      }
    }
  }

  async safeApiCall(apiFunc) {
    try {
      await apiFunc();
    } catch (err) {
      this.handleApiError(err);
    }
  }

  /**
   * Handle errors from the API in a uniform way.
   * @param {Error} err the error instance
   */
  handleApiError(err) {
    this.error("API Error:", err);

    let translatedError = this.homey.__("device_unknown_error");
    if (err instanceof WillowApiError) {
      // Translate known error codes to user-friendly messages
      if (err.errorCode === 1) {
        translatedError = this.homey.__("device_timeout");
      } else if (err.errorCode === 2) {
        translatedError = this.homey.__("device_404");
      } else {
        translatedError = this.homey.__("device_other_error");
      }
    }

    this.setUnavailable(translatedError).catch(this.error);
  }

  async getParameters(startinterval = false) {
    if (!this.alive) {
      this.log("Exiting, device has been removed");
      return;
    }

    this.log("Getting parameters, interval (seconds):", this.interval);

    try {
      const [
        activitiesInfo,
        batteryStatus,
        baseboardSensors,
        moduleSensors,
        mowerInfo,
        dockingInfo,
        rainSensor,
        powerSensor,
        odometry,
        gps,
      ] = await Promise.all([
        this.api.getActivitiesInfo(),
        this.api.getBatteryStatus(),
        this.api.getBaseboardSensors(),
        this.api.getModuleSensors(),
        this.api.getMowerInfo(),
        this.api.getDockingInfo(),
        this.api.getRainSensor(),
        this.api.getPowerSensor(),
        this.api.getOdometry(),
        this.api.getGPS(),
      ]);

      this.setAvailable().catch(this.error);

      this.userActivity = activitiesInfo.userActivity;
      this.scheduledActivity = activitiesInfo.scheduledActivity;

      await this.setCapabilityValue("status.user_activity", this.userActivity);
      await this.setCapabilityValue(
        "status.scheduled_activity",
        this.scheduledActivity
      );
      await this.setCapabilityValue(
        "measure_temperature.battery",
        batteryStatus.temperature
      );
      await this.setCapabilityValue(
        "measure_battery",
        batteryStatus.percentage
      );
      await this.setCapabilityValue(
        "measure_temperature.motherboard",
        baseboardSensors.temperature
      );
      await this.setCapabilityValue(
        "measure_humidity",
        baseboardSensors.humidity
      );
      await this.setCapabilityValue(
        "measure_temperature.module",
        moduleSensors.temperature
      );
      await this.setCapabilityValue("rpm", mowerInfo.rpm);
      await this.setCapabilityValue(
        "height",
        Math.round(mowerInfo.mowerHeight * 1000) / 10
      );
      await this.setCapabilityValue(
        "measure_current.charging_current",
        dockingInfo.chargingCurrent
      );
      await this.setCapabilityValue(
        "measure_power",
        powerSensor.receiver_power
      );
      await this.setCapabilityValue(
        "status.docking_state",
        dockingInfo.dockingState
      );
      await this.setCapabilityValue("alarm_water", rainSensor.state === 1);

      await this.setCapabilityValue(
        "measure_current.mower_current",
        powerSensor.mower_current
      );
      await this.setCapabilityValue(
        "measure_current.left_wheel_current",
        powerSensor.left_wheel_current
      );
      await this.setCapabilityValue(
        "measure_current.right_wheel_current",
        powerSensor.right_wheel_current
      );
      await this.setCapabilityValue(
        "measure_voltage.battery_voltage",
        powerSensor.chg_bat_voltage
      );
      await this.setCapabilityValue(
        "measure_voltage.receiver_voltage",
        powerSensor.receiver_voltage
      );
      await this.setCapabilityValue("measure_location_latitude", odometry.lat);
      await this.setCapabilityValue("measure_location_longitude", odometry.lon);
      await this.setCapabilityValue("accuracy", odometry.acc);

      this.log("Getting parameters done!");
    } catch (err) {
      this.handleApiError(err);
    }

    if (startinterval) {
      setTimeout(() => this.getParameters(true), this.interval * 1000);
    }
  }

  async getPersonDetection(startinterval = false) {
    try {
      const value = await this.api.getPersonDistance();
      if (
        Object.prototype.hasOwnProperty.call(value, "distance") &&
        !this.person_detected
      ) {
        this.person_detected = true;
        this.person_detected_flag = true;
        this.log("A person has been detected!");
        this.homey.flow
          .getDeviceTriggerCard("person-detected")
          .trigger(this, {
            distance: Math.round(value.distance * 100) / 100.0,
          })
          .catch(this.error);
      } else if (
        !Object.prototype.hasOwnProperty.call(value, "distance") &&
        this.person_detected
      ) {
        this.person_detected = false;
        this.log("Person has gone away!");
      }
    } catch (err) {
      this.handleApiError(err);
    }

    if (startinterval) {
      setTimeout(() => this.getPersonDetection(true), 10000);
    }
  }

  async onAdded() {
    this.log("Willow has been added");
  }

  async onSettings({ newSettings }) {
    if (newSettings.ipaddress !== undefined) {
      this.ip = newSettings.ipaddress;
      this.api.setIp(this.ip);
    }
    if (newSettings.interval !== undefined) {
      this.interval = newSettings.interval;
    }
    if (newSettings.rtsp_url !== undefined) {
      this.rtsp_url = newSettings.rtsp_url;
      // Recreate camera video with new RTSP URL
      await this.setupCameraVideo();
    }
    this.getParameters().catch((err) => this.handleApiError(err));
  }

  async onDeleted() {
    this.log("Willow has been deleted");
    this.alive = false;
  }
}

module.exports = MyDevice;
