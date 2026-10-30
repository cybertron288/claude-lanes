// Publish a WLED JSON state file to the panel's topic, retained.
// Usage: bun scripts/publish.ts <file.json>
import { publish } from "../worker/src/mqtt";

const file = process.argv[2];
const topic = process.env.MQTT_TOPIC;
const broker = process.env.BROKER_URL ?? "wss://broker.emqx.io:8084/mqtt";
if (!file || !topic) {
  console.error("usage: MQTT_TOPIC=<topic> bun scripts/publish.ts <file.json>");
  process.exit(2);
}

const payload = JSON.stringify(await Bun.file(file).json());
await publish(broker, `${topic}/api`, payload);
console.log(`published ${payload.length} bytes`);
