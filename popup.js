const $ = (id) => document.getElementById(id);
const fields = ["title", "category", "creators", "note"];
let current = { url: "", thumbnailURL: "" };
let seq = 0;

function currentWork() {
  return {
    title: $("title").value,
    url: current.url,
    thumbnailURL: current.thumbnailURL,
    category: $("category").value,
    creators: $("creators").value.split(/[|｜]/),
    note: $("note").value,
  };
}

function drawQR(text) {
  // 誤り訂正 M・型番は自動。メモ入力のたびに作り直す。
  const qr = qrcode(0, "M");
  qr.addData(text, "Byte");
  qr.make();
  const n = qr.getModuleCount(), quiet = 4, scale = Math.max(2, Math.floor(512 / (n + quiet * 2)));
  const size = (n + quiet * 2) * scale;
  const canvas = $("qr");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = "#000";
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++)
    if (qr.isDark(r, c)) ctx.fillRect((c + quiet) * scale, (r + quiet) * scale, scale, scale);
}

async function render() {
  const my = ++seq;
  const work = currentWork();
  if (!work.title.trim()) { $("warn").hidden = false; $("warn").textContent = "タイトルを入力してください。"; return; }
  const result = await CSVShelfShare.encode(work);
  if (my !== seq) return;
  try {
    drawQR(result.url);
    $("warn").hidden = !result.truncated && !result.tooLong;
    $("warn").textContent = result.tooLong
      ? "内容が長すぎて QR に収まりません。タイトルやクリエイターを短くしてください。"
      : result.truncated ? `メモは先頭 ${result.noteLength} 文字だけを QR に入れました。` : "";
  } catch (e) {
    $("warn").hidden = false; $("warn").textContent = "QR を作れませんでした: " + e.message;
  }
}

async function load() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !/^https?:/.test(tab.url || "")) {
    $("status").textContent = "このページは保存できません（http / https のページで使ってください）。";
    $("qrBox").hidden = $("hint").hidden = true;
    return;
  }
  let data;
  try {
    const [res] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: csvshelfExtract });
    data = res.result;
  } catch (e) {
    // chrome:// や Chrome ウェブストアなどは注入できない。URL とタイトルだけで続ける。
    data = { url: tab.url, title: tab.title || "", thumbnailURL: "", creators: [], category: "", note: "" };
  }
  current = { url: data.url, thumbnailURL: data.thumbnailURL };
  $("title").value = data.title || tab.title || "";
  $("category").value = data.category || "";
  $("creators").value = (data.creators || []).join(" | ");
  $("note").value = data.note || "";
  $("url").textContent = data.url;

  if (data.thumbnailURL) {
    const img = $("thumb");
    img.onload = () => {
      // YouTube の maxresdefault がない動画は 120x90 の代替画像が返るので、hqdefault に切り替える。
      if (data.fallbackThumbnailURL && img.naturalWidth <= 120) {
        current.thumbnailURL = data.fallbackThumbnailURL; img.src = data.fallbackThumbnailURL; render();
      } else img.hidden = false;
    };
    img.onerror = () => { if (data.fallbackThumbnailURL && img.src !== data.fallbackThumbnailURL) { current.thumbnailURL = data.fallbackThumbnailURL; img.src = data.fallbackThumbnailURL; render(); } };
    img.referrerPolicy = "no-referrer";
    img.src = data.thumbnailURL;
  }
  await render();
}

fields.forEach((id) => $(id).addEventListener("input", render));
load();
