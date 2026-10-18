// 表示中のページから、タイトル・画像・作者・本文などを取り出す。
// chrome.scripting.executeScript でページ内に注入され、戻り値が popup に渡る（関数単体で完結させること）。
function csvshelfExtract() {
  const meta = (...names) => {
    for (const n of names) {
      const el = document.querySelector(`meta[property="${n}"], meta[name="${n}"], meta[itemprop="${n}"]`);
      const v = el && el.getAttribute("content");
      if (v && v.trim()) return v.trim();
    }
    return "";
  };
  const abs = (u) => { try { return u ? new URL(u, location.href).href : ""; } catch { return ""; } };
  const strip = (href) => {
    try {
      const u = new URL(href);
      for (const k of [...u.searchParams.keys()]) {
        const n = k.toLowerCase();
        if (n.startsWith("utm_") || ["fbclid", "gclid", "si", "igshid", "s", "t", "ref_src"].includes(n) && /(^|\.)(x|twitter)\.com$/.test(u.hostname)) u.searchParams.delete(k);
        else if (n.startsWith("utm_") || ["fbclid", "gclid", "si", "igshid"].includes(n)) u.searchParams.delete(k);
      }
      u.hash = u.hash.startsWith("#:~:") ? "" : u.hash;
      return u.href;
    } catch { return href; }
  };

  const host = location.hostname.replace(/^www\./, "");
  const selection = (window.getSelection ? String(window.getSelection()) : "").trim();
  const out = {
    url: strip(location.href), title: "", thumbnailURL: "", creators: [], category: "", note: "", source: "page",
  };

  // YouTube
  const yt = (() => {
    const u = new URL(location.href);
    if (host === "youtu.be") return u.pathname.slice(1, 12);
    if (/(^|\.)youtube\.com$/.test(host)) {
      if (u.pathname === "/watch") return u.searchParams.get("v");
      const m = u.pathname.match(/^\/(shorts|live|embed)\/([\w-]{11})/);
      if (m) return m[2];
    }
    return null;
  })();
  if (yt && /^[\w-]{11}$/.test(yt)) {
    out.source = "youtube";
    out.url = `https://www.youtube.com/watch?v=${yt}`;
    out.thumbnailURL = `https://i.ytimg.com/vi/${yt}/maxresdefault.jpg`;
    out.fallbackThumbnailURL = `https://i.ytimg.com/vi/${yt}/hqdefault.jpg`;
    out.title = meta("og:title") || document.title.replace(/ - YouTube$/, "");
    const channel = document.querySelector('link[itemprop="name"]')?.getAttribute("content")
      || document.querySelector("ytd-channel-name a, #owner #channel-name a")?.textContent?.trim() || "";
    if (channel) out.creators = [channel];
    out.category = "YouTube";
    out.note = selection;
    return out;
  }

  // X（旧 Twitter）の投稿
  const post = location.pathname.match(/^\/([^/]+)\/status\/(\d+)/);
  if (/^(x|twitter)\.com$/.test(host) && post) {
    out.source = "x";
    out.url = `https://x.com/${post[1]}/status/${post[2]}`;
    const article = document.querySelector('article[data-testid="tweet"]') || document.querySelector("article");
    const text = article?.querySelector('[data-testid="tweetText"]')?.innerText?.trim() || "";
    const name = article?.querySelector('[data-testid="User-Name"] span')?.textContent?.trim() || post[1];
    const photo = article?.querySelector('[data-testid="tweetPhoto"] img')?.src || "";
    out.creators = [name];
    out.category = "X";
    out.note = selection || text;
    out.thumbnailURL = photo ? photo.replace(/name=\w+/, "name=large") : "";
    out.title = (name ? name + ": " : "") + (out.note.replace(/\s+/g, " ").slice(0, 60) || "投稿");
    return out;
  }

  // 一般のページ
  out.title = meta("og:title", "twitter:title") || document.title.trim();
  out.thumbnailURL = abs(meta("og:image:secure_url", "og:image", "twitter:image", "twitter:image:src"));
  if (out.thumbnailURL.startsWith("http:")) out.thumbnailURL = "https:" + out.thumbnailURL.slice(5);
  const author = meta("author", "article:author", "twitter:creator");
  if (author && !/^https?:/.test(author)) out.creators = [author.replace(/^@/, "")];
  const canonical = document.querySelector('link[rel="canonical"]')?.href;
  if (canonical && new URL(canonical).host === location.host) out.url = strip(canonical);
  out.note = selection || meta("og:description", "twitter:description", "description");
  return out;
}
