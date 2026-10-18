// Hikidashi（内部名 CSVShelf）の「QR で 1 作品を共有」と同じ形式（csvshelf://add?v=1&z=<0|1>&d=<base64url>）を作る。
// アプリ側の仕様は Sources/ShelfCore/WorkShare.swift。ここと食い違うと取り込めないので、
// extension/test/share.test.mjs が作った URL を Tests/ShelfCoreTests の固定値でも検証している。
(function (root) {
  const NOTE_MAX = 300;
  const MAX_URL_BYTES = 1700; // QR（誤り訂正 M）に余裕をもって収まる長さ

  const toBase64Url = (bytes) => {
    let bin = "";
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  };

  const fromBase64Url = (s) => {
    let b = s.replace(/-/g, "+").replace(/_/g, "/");
    while (b.length % 4) b += "=";
    return Uint8Array.from(atob(b), (c) => c.charCodeAt(0));
  };

  async function pipe(bytes, stream) {
    const out = new Blob([bytes]).stream().pipeThrough(stream);
    return new Uint8Array(await new Response(out).arrayBuffer());
  }

  // アプリの NSData.compressed(using: .zlib) は zlib ヘッダなしの raw deflate。
  const deflateRaw = (bytes) => pipe(bytes, new CompressionStream("deflate-raw"));
  const inflateRaw = (bytes) => pipe(bytes, new DecompressionStream("deflate-raw"));

  const clean = (s) => (s || "").trim();

  function payload(work, noteLimit) {
    const p = { t: clean(work.title) };
    if (clean(work.url)) p.u = clean(work.url);
    if (clean(work.thumbnailURL)) p.i = clean(work.thumbnailURL);
    const creators = (work.creators || []).map(clean).filter(Boolean);
    if (creators.length) p.c = creators;
    if (clean(work.category)) p.g = clean(work.category);
    // アプリは Swift の Character 単位で数えるので、サロゲートペアを壊さないよう Array.from で切る。
    const note = Array.from(clean(work.note)).slice(0, noteLimit).join("");
    if (note) p.n = note;
    return p;
  }

  /** @returns {Promise<{url: string, noteLength: number, truncated: boolean}>} */
  async function encode(work) {
    let limit = NOTE_MAX;
    for (;;) {
      const json = new TextEncoder().encode(JSON.stringify(payload(work, limit)));
      const packed = await deflateRaw(json);
      const useZ = packed.length < json.length;
      const url = `csvshelf://add?v=1&z=${useZ ? 1 : 0}&d=${toBase64Url(useZ ? packed : json)}`;
      const full = Array.from(clean(work.note)).length;
      if (url.length <= MAX_URL_BYTES || limit <= 0) {
        return { url, noteLength: Math.min(full, limit), truncated: full > limit, tooLong: url.length > MAX_URL_BYTES };
      }
      limit = Math.max(0, limit - 40); // 収まるまでメモを短くする
    }
  }

  /** テスト用: URL を作品に戻す（アプリ側の WorkShare.draft と同じ解釈）。 */
  async function decode(urlString) {
    const u = new URL(urlString);
    if (u.protocol !== "csvshelf:" || u.host !== "add" || u.searchParams.get("v") !== "1") return null;
    let data = fromBase64Url(u.searchParams.get("d") || "");
    if (u.searchParams.get("z") === "1") data = await inflateRaw(data);
    return JSON.parse(new TextDecoder().decode(data));
  }

  const api = { encode, decode, NOTE_MAX, MAX_URL_BYTES };
  if (typeof module !== "undefined") module.exports = api; else root.CSVShelfShare = api;
})(typeof self !== "undefined" ? self : globalThis);
