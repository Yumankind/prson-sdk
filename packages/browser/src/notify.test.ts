// node --test: reading the notification handle from the wallet's envelope.

import { test } from "node:test";
import assert from "node:assert/strict";
import { notifyHandleFrom } from "./notify.js";

const handle = `nh_${"A".repeat(40)}b-_`;

test("reads a well-formed handle", () => {
  assert.equal(notifyHandleFrom({ v: "prson_vp_v1", msg: "presentation", notifyHandle: handle }), handle);
});

test("anything else is no handle", () => {
  for (const envelope of [null, undefined, "x", {}, { notifyHandle: 42 }, { notifyHandle: "nh_short" }, { notifyHandle: `${handle}=` }, { notifyHandle: `xx_${"A".repeat(43)}` }]) {
    assert.equal(notifyHandleFrom(envelope), null);
  }
});
