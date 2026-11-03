import { test } from "node:test";
import assert from "node:assert/strict";
import { readNotifyHandle, sendNotification } from "../src/notify.ts";

const handle = `nh_${"Z".repeat(43)}`;

test("reads the handle from a SignInResult, its notifications, or as is", () => {
  assert.equal(readNotifyHandle({ notifications: { handle } }), handle);
  assert.equal(readNotifyHandle({ handle }), handle);
  assert.equal(readNotifyHandle(handle), handle);
  for (const v of [null, {}, { notifications: null }, { notifications: { handle: "nh_x" } }, `${handle}!`, 7]) assert.equal(readNotifyHandle(v), null);
});

test("sends with the key and reports a turned-off handle as revoked", async () => {
  const calls: { url: string; init: { method: string; headers: Record<string, string>; body: string } }[] = [];
  let status = 202;
  let reply: unknown = { id: "ntf_1", status: "queued" };
  const fetch = async (url: string, init: { method: string; headers: Record<string, string>; body: string }) => {
    calls.push({ url, init });
    return { status, json: async () => reply };
  };
  const ok = await sendNotification({ apiKey: "prs_live_k", handle, title: "Shipped", body: "Thursday", url: "https://shop.example.com/o/1", apiBase: "https://api.test/", fetch });
  assert.deepEqual(ok, { ok: true, id: "ntf_1", status: 202 });
  assert.equal(calls[0]!.url, "https://api.test/v1/notify");
  assert.equal(calls[0]!.init.headers.Authorization, "Bearer prs_live_k");
  assert.deepEqual(JSON.parse(calls[0]!.init.body), { handle, title: "Shipped", body: "Thursday", url: "https://shop.example.com/o/1" });

  status = 410;
  reply = { error: "handle_revoked", message: "turned off" };
  assert.deepEqual(await sendNotification({ apiKey: "k", handle, title: "a", body: "b", fetch }), { ok: false, status: 410, error: "handle_revoked", message: "turned off", revoked: true });
  status = 429;
  reply = { error: "handle_rate_limited" };
  const limited = await sendNotification({ apiKey: "k", handle, title: "a", body: "b", fetch });
  assert.equal(limited.ok, false);
  assert.equal(!limited.ok && limited.revoked, false);
});
