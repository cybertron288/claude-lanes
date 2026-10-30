import { describe, expect, test } from "bun:test";
import { decodePublish, encodeConnect, encodeDisconnect, encodePublish, encodeSubscribe } from "../src/mqtt";

describe("encodeSubscribe", () => {
  test("starts 0x82 and requests QoS 0", () => {
    const packet = encodeSubscribe("t", 1);
    expect(packet[0]).toBe(0x82);
    expect(packet[packet.length - 1]).toBe(0);
  });

  test("carries the packet id and topic", () => {
    expect([...encodeSubscribe("t", 1)]).toEqual([0x82, 6, 0, 1, 0, 1, 0x74, 0]);
  });
});

describe("decodePublish", () => {
  test("round-trips encodePublish", () => {
    expect(decodePublish(encodePublish("a/api", '{"on":true}', { retain: true }))).toEqual({
      topic: "a/api",
      payload: '{"on":true}',
    });
  });

  test("reads a payload past 127 bytes (two-byte remaining length)", () => {
    const payload = "y".repeat(300);
    expect(decodePublish(encodePublish("t", payload, { retain: false }))?.payload).toBe(payload);
  });

  test("returns null for a CONNACK", () => {
    expect(decodePublish(new Uint8Array([0x20, 0x02, 0, 0]))).toBeNull();
  });
});

describe("encodePublish", () => {
  test("retained QoS 0 publish starts 0x31", () => {
    expect(encodePublish("t", "x", { retain: true })[0]).toBe(0x31);
  });

  test("unretained publish starts 0x30", () => {
    expect(encodePublish("t", "x", { retain: false })[0]).toBe(0x30);
  });

  test("remaining length is a varint: 2 + 1 + 200 = 203 → [0xCB, 0x01]", () => {
    const packet = encodePublish("t", "x".repeat(200), { retain: true });
    expect([...packet.slice(1, 3)]).toEqual([0xcb, 0x01]);
    expect(packet.length).toBe(1 + 2 + 203);
  });

  test("carries the topic and payload bytes", () => {
    const packet = encodePublish("a/api", "{}", { retain: true });
    expect([...packet]).toEqual([0x31, 9, 0, 5, ...new TextEncoder().encode("a/api"), 0x7b, 0x7d]);
  });
});

describe("encodeConnect", () => {
  test("starts 0x10 with protocol MQTT, level 4 and clean session", () => {
    const packet = encodeConnect("c");
    expect(packet[0]).toBe(0x10);
    const text = new TextDecoder().decode(packet);
    expect(text).toContain("MQTT");
    const at = text.indexOf("MQTT") + 4;
    expect(packet[at]).toBe(4);
    expect(packet[at + 1]).toBe(0x02);
  });
});

describe("encodeDisconnect", () => {
  test("is [0xE0, 0]", () => {
    expect([...encodeDisconnect()]).toEqual([0xe0, 0]);
  });
});
