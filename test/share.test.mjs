// node --test extension/test/share.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { writeFileSync } from "node:fs";
const require = createRequire(import.meta.url);
const { encode, decode } = require("../share.js");

const sample = {
  title: "Rick Astley - Never Gonna Give You Up (Official Video) (4K Remaster)",
  url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  thumbnailURL: "https://i.ytimg.com/vi/dQw4w9WgXcQ/maxresdefault.jpg",
  creators: ["Rick Astley", "共演者"],
  category: "YouTube",
  note: "メモ本文\n2 行目 😀",
};

test("round trip", async () => {
  const { url } = await encode(sample);
  const back = await decode(url);
  assert.equal(back.t, sample.title);
  assert.equal(back.u, sample.url);
  assert.deepEqual(back.c, sample.creators);
  assert.equal(back.g, "YouTube");
  assert.equal(back.n, sample.note);
  assert.ok(url.length < 700, `url length ${url.length}`);
  // アプリ側（Swift）の互換性テスト用の固定値。形式を変えたら Tests/ShelfCoreTests の値も更新すること。
  if (process.env.WRITE_FIXTURE) writeFileSync(process.env.WRITE_FIXTURE, url);
});

test("note is truncated to fit and to 300 characters", async () => {
  const long = { ...sample, note: "あ".repeat(1000) };
  const r = await encode(long);
  assert.equal(r.truncated, true);
  assert.ok(r.url.length <= 1700);
  const back = await decode(r.url);
  assert.ok(Array.from(back.n).length <= 300);
});

test("empty optional fields are omitted", async () => {
  const { url } = await encode({ title: "t", url: "", creators: [], category: "", note: "" });
  assert.deepEqual(await decode(url), { t: "t" });
});
