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
    // 表示中の投稿（URL の投稿 ID に一致するもの）の article を探す。スレッドや返信、引用があっても、別の投稿の画像を拾わない。
    const articles = [...document.querySelectorAll("article")];
    const article = articles.find((a) => a.querySelector(`a[href*="/status/${post[2]}"] time`))
      || document.querySelector('article[data-testid="tweet"]') || articles[0];
    const text = article?.querySelector('[data-testid="tweetText"]')?.innerText?.trim() || "";
    const name = article?.querySelector('[data-testid="User-Name"] span')?.textContent?.trim() || post[1];
    // 引用された投稿（article の中の別のカード）の画像は除く。
    const inQuote = (el) => !!el.closest('[role="link"][tabindex="0"]') && !el.closest('[data-testid="tweetPhoto"]');
    const candidates = article ? [
      ...article.querySelectorAll('[data-testid="tweetPhoto"] img'),
      ...article.querySelectorAll('img[src*="pbs.twimg.com/media/"]'),
      ...article.querySelectorAll('img[src*="pbs.twimg.com/ext_tw_video_thumb"], img[src*="pbs.twimg.com/amplify_video_thumb"], img[src*="pbs.twimg.com/tweet_video_thumb"]'),
      ...article.querySelectorAll('[data-testid="card.layoutLarge.media"] img, [data-testid="card.layoutSmall.media"] img'),
    ].filter((el) => el.src && !inQuote(el)) : [];
    const poster = article?.querySelector("video[poster]")?.getAttribute("poster") || "";
    const photo = candidates[0]?.src || poster || "";
    out.creators = [name];
    out.category = "X";
    out.note = selection || text;
    out.thumbnailURL = photo ? photo.replace(/name=\w+/, "name=large") : "";
    out.title = (name ? name + ": " : "") + (out.note.replace(/\s+/g, " ").slice(0, 60) || "投稿");
    return out;
  }

  // 一般のページ
  out.title = meta("og:title", "twitter:title") || document.title.trim();
  const images = collectImages();
  out.thumbnailURL = images[0] || "";
  out.imageCandidates = images;
  const author = meta("author", "article:author", "twitter:creator");
  if (author && !/^https?:/.test(author)) out.creators = [author.replace(/^@/, "")];
  const canonical = document.querySelector('link[rel="canonical"]')?.href;
  if (canonical && new URL(canonical).host === location.host) out.url = strip(canonical);
  out.note = selection || meta("og:description", "twitter:description", "description");

  // pixiv の作品ページ: カテゴリを pixiv にし、投稿者をクリエイターにする（詳しい取得は、popup が csvshelfPixivInfo で行う）。
  const pixiv = location.pathname.match(/^\/(?:[a-z]{2}(?:-[a-z]+)?\/)?artworks\/(\d+)/i);
  if (/(^|\.)pixiv\.net$/.test(host) && pixiv) {
    out.source = "pixiv";
    out.pixivId = pixiv[1];
    out.url = `https://www.pixiv.net/artworks/${pixiv[1]}`;
    out.category = "pixiv";
    // 「#タグ 作品名 - 投稿者のイラスト - pixiv」。画面遷移（SPA）でも更新される document.title を先に見る。
    for (const t of [document.title, meta("og:title")]) {
      const m = (t || "").match(/^(.*?)\s+-\s+(.+?)の(?:イラスト|マンガ|小説|うごイラ|作品)\s+-\s+pixiv$/s);
      if (m) { out.creators = [m[2].trim()]; if (m[1].trim()) out.title = m[1].trim(); break; }
    }
  }
  return out;

  // ---- 画像の候補集め（先頭が自動選択。popup で別の候補を選べる） ----

  function collectImages() {
    // 初期アイコン・ロゴ・アバター・絵文字・追跡用の画像と思われる URL は、候補から外す。
    const junkURL = /gravatar\.com|\/avatars?[\/._-]|[\/._-]avatars?[\/._-]|favicon|apple-touch-icon|\/logos?[\/._-]|[\/._-]logos?[\/._-]|sprite|placeholder|default[-_.]?(image|avatar|thumb|ogp|og)?\.|noimage|no[-_]image|no[-_]img|blank\.|spacer|pixel|1x1|emoji|emoticon|\/badge|[\/._-]icons?[\/._-]|dummy|transparent\.(gif|png)|loading\.(gif|svg|png)|s\.w\.org|pixiv_logo|s\.pximg\.net\/www\/images|banners?[\/._-]|[\/._-]bn[_-]|campaign|\/ads?\/|adserver|doubleclick/i;
    const bad = (u) => !u || /^(data|blob):/i.test(u) || /\.svg(\?|$)/i.test(u) || junkURL.test(u);
    const seen = new Set();
    const list = [];
    const add = (u) => {
      const url = abs(u);
      if (!/^https?:/.test(url) || bad(url) || seen.has(url)) return;
      seen.add(url);
      list.push(url.startsWith("http:") ? "https:" + url.slice(5) : url);
    };

    // 1. 明示的に指定された画像（SNS 共有用のメタタグ）。サイトの初期アイコンなら外れる。
    for (const n of ["og:image:secure_url", "og:image", "twitter:image", "twitter:image:src"]) add(meta(n));
    // 2. その他のメタ情報
    add(document.querySelector('link[rel="image_src"]')?.getAttribute("href"));
    add(meta("thumbnail", "image"));
    // 3. JSON-LD の記事・商品などの画像。author / publisher / logo の中は見ない（人やサイトのアイコンになるため）。
    for (const u of jsonLdImages()) add(u);
    // 4. 動画の poster（表示されている大きい動画。背景用の無音・自動再生・ループの動画は除く）
    for (const u of videoPosters()) add(u);
    // 5. 本文中の大きな画像（面積と位置で点数づけ）
    for (const u of bodyImages()) add(u);
    // 6. CSS の背景画像として貼られた大きな要素（カード、ヒーロー画像）
    for (const u of backgroundImages()) add(u);
    return list.slice(0, 8);
  }

  function jsonLdImages() {
    const urls = [];
    const skip = new Set(["author", "creator", "publisher", "logo", "brand", "provider", "sourceOrganization", "copyrightHolder", "mainEntityOfPage", "isPartOf", "breadcrumb", "potentialAction", "review", "comment"]);
    const imageOf = (v) => {
      if (!v) return;
      if (typeof v === "string") urls.push(v);
      else if (Array.isArray(v)) v.forEach(imageOf);
      else if (typeof v === "object") imageOf(v.url || v.contentUrl);
    };
    const walk = (node, depth) => {
      if (!node || typeof node !== "object" || depth > 4) return;
      if (Array.isArray(node)) { node.forEach((n) => walk(n, depth + 1)); return; }
      const type = [].concat(node["@type"] || []).join(",");
      if (/Article|Posting|Product|Recipe|VideoObject|Book|Movie|CreativeWork|WebPage|Event|ImageObject/i.test(type) && !/Person|Organization/i.test(type)) {
        imageOf(node.image); imageOf(node.thumbnailUrl); imageOf(node.thumbnail);
      }
      for (const [k, v] of Object.entries(node)) if (!skip.has(k) && typeof v === "object") walk(v, depth + 1);
    };
    for (const el of document.querySelectorAll('script[type="application/ld+json"]')) {
      try { walk(JSON.parse(el.textContent), 0); } catch { /* 壊れた JSON は無視 */ }
    }
    return urls;
  }

  function videoPosters() {
    const scored = [];
    for (const v of document.querySelectorAll("video")) {
      const poster = v.getAttribute("poster") || "";
      if (!poster || v.closest('aside, [class*="advert" i], [class*="banner" i], [id*="ad-" i]')) continue;
      if (v.autoplay && v.muted && v.loop) continue;                       // 装飾用の背景動画
      const rect = v.getBoundingClientRect();
      if (rect.width < 200 || rect.height < 120) continue;                 // 見えない、または小さすぎる
      scored.push([rect.width * rect.height, poster]);
    }
    return scored.sort((a, b) => b[0] - a[0]).map(([, u]) => u);
  }

  function backgroundImages() {
    const scored = [];
    const skipBox = 'header, footer, nav, aside, [class*="avatar" i], [class*="comment" i], [class*="sidebar" i], [class*="advert" i], [class*="profile" i], [class*="author" i]';
    // 全要素を調べると重いので、表示領域の大きい要素だけを、数を絞って見る。
    const nodes = document.querySelectorAll("main *, article *, section *, div, a, figure, li");
    let checked = 0;
    for (const el of nodes) {
      if (++checked > 1500) break;
      const rect = el.getBoundingClientRect();
      if (rect.width < 200 || rect.height < 120) continue;
      const bg = getComputedStyle(el).backgroundImage;
      if (!bg || bg === "none") continue;
      const m = bg.match(/url\(["']?([^"')]+)["']?\)/);
      if (!m || el.closest(skipBox)) continue;
      const ratio = rect.width / rect.height;
      if (ratio > 3.5 || ratio < 0.28) continue;
      const top = rect.top + (window.scrollY || 0);
      scored.push([Math.min(rect.width * rect.height, 1.2e6) * (1 + 1 / (1 + Math.max(0, top) / 800)), m[1]]);
    }
    return scored.sort((a, b) => b[0] - a[0]).map(([, u]) => u);
  }

  function bodyImages() {
    const skipBox = 'header, footer, nav, aside, [role="banner"], [role="navigation"], [role="complementary"], [class*="avatar" i], [class*="comment" i], [id*="comment" i], [class*="sidebar" i], [class*="related" i], [class*="widget" i], [class*="advert" i], [class*="banner" i], [class*="profile" i], [class*="author" i]';
    const mainEl = document.querySelector("article, main, [role='main']");
    const scored = [];
    for (const img of document.images) {
      let src = img.currentSrc || img.src || img.getAttribute("data-src") || img.getAttribute("data-original") || img.getAttribute("data-lazy-src") || "";
      const srcset = img.getAttribute("srcset") || img.getAttribute("data-srcset");
      if (srcset) {
        // srcset の中で一番大きいものを使う
        const best = srcset.split(",").map((p) => p.trim().split(/\s+/)).map(([u, d]) => [u, parseFloat(d) || 1]).sort((a, b) => b[1] - a[1])[0];
        if (best && best[0] && !src) src = best[0];
      }
      if (!src || img.closest(skipBox)) continue;
      const rect = img.getBoundingClientRect();
      const w = Math.max(img.naturalWidth || 0, rect.width, +img.getAttribute("width") || 0);
      const h = Math.max(img.naturalHeight || 0, rect.height, +img.getAttribute("height") || 0);
      if (Math.min(w, h) < 150 || Math.max(w, h) < 200) continue;   // アイコンや 1px 画像
      const ratio = w / h;
      if (ratio > 3.5 || ratio < 0.28) continue;                      // 帯状のバナー、細い装飾
      const radius = parseFloat(getComputedStyle(img).borderTopLeftRadius) || 0;
      if (radius >= Math.min(rect.width, rect.height) * 0.4 && rect.width > 0) continue;   // 丸いアバター
      const inMain = mainEl && mainEl.contains(img);
      const top = rect.top + (window.scrollY || 0);
      const score = Math.min(w * h, 1.2e6) * (inMain ? 2 : 1) * (1 + 1 / (1 + Math.max(0, top) / 800));
      scored.push([score, src]);
    }
    return scored.sort((a, b) => b[0] - a[0]).map(([, u]) => u);
  }
}

// pixiv の作品情報（作品名・投稿者名）を、ログイン中のページから、公開の JSON で取る。R-18 など、ログインが必要な作品も、取れる。
// popup が、csvshelfExtract のあとに、同じタブで、もう一度、実行する。
async function csvshelfPixivInfo(id) {
  try {
    const res = await fetch(`/ajax/illust/${id}`, { credentials: "include", headers: { Accept: "application/json" } });
    if (!res.ok) return { debug: `作品情報 HTTP ${res.status}` };
    const j = await res.json();
    if (j.error || !j.body || !j.body.userName) return { debug: `作品情報 error=${!!j.error} ${String(j.message || "").slice(0, 40)}` };
    // 画像の URL は、ログイン中は R-18 の作品でも入っている（ログインしていない、または R-18 表示がオフだと null）。
    // i.pximg.net は、参照元（Referer）が pixiv でないと拒否される。
    const u = j.body.urls || {};
    const image = u.regular || u.small || u.thumb || "";
    return {
      title: j.body.illustTitle || j.body.title || "", userName: j.body.userName, image,
      debug: `作品情報 HTTP 200 / 画像URL=${image ? "あり" : "なし"} / xRestrict=${j.body.xRestrict}`,
    };
  } catch (e) { return { debug: `作品情報 例外 ${String(e).slice(0, 60)}` }; }
}
