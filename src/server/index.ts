// Process entry: load config, build the app, listen, print LAN addresses.

import { networkInterfaces } from "node:os";
import { createServerApp } from "./app.js";
import { loadConfig } from "./config.js";

const config = loadConfig();
const app = createServerApp(config);

app.listen().then(({ port }) => {
  const ips: string[] = [];
  for (const nets of Object.values(networkInterfaces())) {
    for (const net of nets || []) {
      if (net.family === "IPv4" && !net.internal) ips.push(net.address);
    }
  }
  console.log(`fripoker listening on http://127.0.0.1:${port}`);
  if (config.basePath) console.log(`BASE_PATH=${config.basePath}`);
  for (const ip of ips) {
    console.log(`LAN: http://${ip}:${port}${config.basePath}/`);
  }
});
