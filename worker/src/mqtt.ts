// Minimal MQTT 3.1.1 over WebSocket: just enough to publish one retained
// message. Runs under Bun and Cloudflare Workers.
const enc = new TextEncoder();

function varint(n: number): number[] {
  const out: number[] = [];
  do {
    let byte = n % 128;
    n = Math.floor(n / 128);
    if (n > 0) byte |= 0x80;
    out.push(byte);
  } while (n > 0);
  return out;
}

function utf8(s: string): number[] {
  const bytes = enc.encode(s);
  return [bytes.length >> 8, bytes.length & 0xff, ...bytes];
}

function packet(header: number, body: number[]): Uint8Array {
  return new Uint8Array([header, ...varint(body.length), ...body]);
}

export function encodeConnect(clientId: string, keepAliveSec = 30): Uint8Array {
  // Protocol name, level 4 (3.1.1), clean session, keep-alive, client id.
  return packet(0x10, [...utf8("MQTT"), 4, 0x02, keepAliveSec >> 8, keepAliveSec & 0xff, ...utf8(clientId)]);
}

export function encodePublish(topic: string, payload: string, opts: { retain: boolean }): Uint8Array {
  return packet(opts.retain ? 0x31 : 0x30, [...utf8(topic), ...enc.encode(payload)]);
}

export function encodeDisconnect(): Uint8Array {
  return new Uint8Array([0xe0, 0]);
}

export function encodeSubscribe(topic: string, packetId: number): Uint8Array {
  return packet(0x82, [packetId >> 8, packetId & 0xff, ...utf8(topic), 0]);
}

export function encodePingReq(): Uint8Array {
  return new Uint8Array([0xc0, 0]);
}

export function decodePublish(bytes: Uint8Array): { topic: string; payload: string } | null {
  if ((bytes[0]! & 0xf0) !== 0x30) return null;
  let at = 1;
  while (bytes[at]! & 0x80) at++;
  at++;
  const topicLen = (bytes[at]! << 8) | bytes[at + 1]!;
  at += 2;
  const topic = new TextDecoder().decode(bytes.slice(at, at + topicLen));
  at += topicLen;
  if ((bytes[0]! >> 1) & 0x03) at += 2; // QoS > 0 carries a packet id
  return { topic, payload: new TextDecoder().decode(bytes.slice(at)) };
}

async function bytesOf(data: unknown): Promise<Uint8Array> {
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (data instanceof Uint8Array) return data;
  if (data instanceof Blob) return new Uint8Array(await data.arrayBuffer());
  return new Uint8Array();
}

export function publish(brokerWssUrl: string, topic: string, payload: string, timeoutMs = 5000): Promise<void> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(brokerWssUrl, "mqtt");
    ws.binaryType = "arraybuffer";
    let settled = false;
    const finish = (err?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        ws.close();
      } catch {}
      if (err) reject(err);
      else resolve();
    };
    const timer = setTimeout(() => finish(new Error(`MQTT publish timed out after ${timeoutMs} ms`)), timeoutMs);

    ws.addEventListener("open", () => ws.send(encodeConnect(`ccsl-${crypto.randomUUID().slice(0, 8)}`)));
    ws.addEventListener("message", async (ev) => {
      const bytes = await bytesOf(ev.data);
      if (bytes[0] !== 0x20) return;
      if (bytes[3] !== 0) return finish(new Error(`MQTT CONNACK refused with code ${bytes[3]}`));
      ws.send(encodePublish(topic, payload, { retain: true }));
      ws.send(encodeDisconnect());
      finish();
    });
    ws.addEventListener("error", () => finish(new Error("MQTT WebSocket error")));
    ws.addEventListener("close", () => finish(new Error("MQTT WebSocket closed before CONNACK")));
  });
}
