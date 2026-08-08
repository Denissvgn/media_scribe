import assert from "node:assert/strict";
import test from "node:test";
import {
  isBlockedRelayDestination,
  isRelayRedirectStatus,
  parseRelayTarget
} from "../relaySecurity.ts";

const target = (value: string) => {
  const parsed = parseRelayTarget(value);
  assert.ok(parsed, `Expected a valid relay target: ${value}`);
  return parsed;
};

test("parseRelayTarget accepts supported local, private, and public HTTP endpoints", () => {
  for (const value of [
    "http://localhost:1234/v1",
    "http://127.0.0.1:8000/v1",
    "http://[::1]:11434/api/tags",
    "http://10.1.2.3:8000/v1/models",
    "http://172.16.4.5:8000/v1/models",
    "http://192.168.1.20:8000/v1/models",
    "https://api.groq.com/openai/v1"
  ]) {
    assert.ok(parseRelayTarget(value), value);
  }
});

test("parseRelayTarget rejects malformed or unsupported endpoints", () => {
  for (const value of [
    undefined,
    "",
    "not a URL",
    "ftp://localhost/models",
    "http://user:secret@localhost/models",
    "http://localhost\n:8000/models",
    `http://${"a".repeat(2049)}.example/models`
  ]) {
    assert.equal(parseRelayTarget(value), null, String(value));
  }
});

test("destination policy blocks IPv4 link-local and metadata targets", () => {
  for (const value of [
    "http://169.254.0.1/v1/models",
    "http://169.254.169.254/latest/meta-data",
    "http://169.254.255.255/v1/audio/transcriptions",
    "http://0xA9FEA9FE/v1/models",
    "http://2852039166/v1/models",
    "http://100.100.100.200/v1/models",
    "http://METADATA.GOOGLE.INTERNAL./v1/models"
  ]) {
    assert.equal(isBlockedRelayDestination(target(value)), true, value);
  }
});

test("destination policy blocks IPv6 link-local, AWS metadata, and mapped link-local targets", () => {
  for (const value of [
    "http://[fe80::1]/v1/models",
    "http://[fe90::1]/v1/models",
    "http://[febf::ffff]/v1/audio/transcriptions",
    "http://[fd00:ec2::254]/latest/meta-data",
    "http://[::ffff:169.254.169.254]/v1/models",
    "http://[::ffff:169.254.0.1]/v1/audio/transcriptions"
  ]) {
    assert.equal(isBlockedRelayDestination(target(value)), true, value);
  }
});

test("destination policy preserves loopback, RFC1918, and non-link-local IPv6", () => {
  for (const value of [
    "http://localhost:1234/v1/models",
    "http://127.0.0.1:1234/v1/models",
    "http://[::1]:1234/v1/models",
    "http://10.0.0.2/v1/models",
    "http://172.31.255.254/v1/models",
    "http://192.168.0.2/v1/models",
    "http://169.253.255.255/v1/models",
    "http://169.255.0.1/v1/models",
    "http://[fec0::1]/v1/models",
    "http://[::ffff:192.168.1.20]/v1/models",
    "https://api.groq.com/openai/v1/models"
  ]) {
    assert.equal(isBlockedRelayDestination(target(value)), false, value);
  }
});

test("redirect status policy covers every 3xx without treating adjacent statuses as redirects", () => {
  for (const status of [300, 301, 302, 303, 304, 305, 306, 307, 308, 399]) {
    assert.equal(isRelayRedirectStatus(status), true, String(status));
  }
  for (const status of [299, 400, 500]) {
    assert.equal(isRelayRedirectStatus(status), false, String(status));
  }
});
