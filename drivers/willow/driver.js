const Homey = require("homey");
const axios = require("axios");
const crypto = require("crypto");

class Driver extends Homey.Driver {
  // this method is called when the app is started and the Driver is inited
  async onInit() {
    this.homey.dashboards
      .getWidget("willow")
      .registerSettingAutocompleteListener(
        "device",
        async (query, settings) => {
          let willows = [];

          let devices = this.homey.drivers.getDriver("willow").getDevices();
          devices.forEach((device) => {
            willows.push({
              name: device.getName(),
              id: device.getData().id,
            });
          });
          return willows.filter((item) =>
            item.name.toLowerCase().includes(query.toLowerCase())
          );
        }
      );
  }

  async onPair(session) {
    let connect_to_willow_address = null;

    session.setHandler("manual_pairing", async (data) => {
      this.log("Session data", data, data.address);
      try {
        const url = `http://${data.address}:8080/api/system/version`;
        const resp = await axios.get(url, { timeout: 30000 });
        this.log("result is", resp.status);
        if (resp.status !== 200)
          return Promise.reject(
            "Could not find a Willow on this address (not 200)"
          );
        connect_to_willow_address = data.address;
        const to_add_willow_device = {
          name: "Willow",
          data: {
            id: crypto.randomUUID(),
          },
          settings: {
            ipaddress: connect_to_willow_address,
            interval: 60,
          },
        };
        const result = {
          applicationVersion: resp.data.applicationVersion.split("-")[0],
          device: to_add_willow_device,
        };
        return Promise.resolve(result);
      } catch (error) {
        this.error(error);
        return Promise.reject("Could not find a Willow on this address");
      }
    });
  }
}

module.exports = Driver;
