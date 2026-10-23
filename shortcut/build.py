#!/usr/bin/env python3
"""iPhone の「ショートカット」ファイル（Hikidashi に保存）を作る。

共有シート（Safari の Web ページ）から呼び出され、開いているページの中で JavaScript（extract.js と同じ読み取り）を動かし、
Hikidashi の取り込み用 URL（csvshelf://add?…）を作って開く。アプリには、追加の確認画面が出る。

使い方:  python3 shortcut/build.py   →  shortcut/Hikidashi.unsigned.shortcut  を作り、macOS の `shortcuts sign` で署名する。
"""
import plistlib, subprocess, uuid, pathlib, sys

root = pathlib.Path(__file__).resolve().parent.parent
extract = (root / "extract.js").read_text()

# ページの中で動かす JavaScript。ショートカットは、結果を completion(...) で受け取る。
js = extract + r'''

(function () {
  try {
    var d = csvshelfExtract();
    var clean = function (s) { return (s || "").trim(); };
    var build = function (limit) {
      var p = { t: clean(d.title) };
      if (clean(d.url)) p.u = clean(d.url);
      if (clean(d.thumbnailURL)) p.i = clean(d.thumbnailURL);
      var creators = (d.creators || []).map(clean).filter(Boolean);
      if (creators.length) p.c = creators;
      if (clean(d.category)) p.g = clean(d.category);
      var note = Array.from(clean(d.note)).slice(0, limit).join("");
      if (note) p.n = note;
      return p;
    };
    var b64url = function (str) {
      var bytes = new TextEncoder().encode(str), bin = "";
      for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
      return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    };
    var limit = 300, url = "";
    for (;;) {
      url = "csvshelf://add?v=1&z=0&d=" + b64url(JSON.stringify(build(limit)));
      if (url.length <= 3500 || limit <= 0) break;
      limit = Math.max(0, limit - 40);     // 収まるまでメモを短くする
    }
    completion(url);
  } catch (e) {
    completion("csvshelf://add?v=1&z=0&d=" + btoa('{"t":"' + String(document.title || "ページ").replace(/[^\x20-\x7e]/g, "") + '","u":"' + location.href + '"}'));
  }
})();
'''

js_uuid = str(uuid.uuid4()).upper()
workflow = {
    "WFWorkflowClientVersion": "2900.0.1",
    "WFWorkflowClientRelease": "26.0",
    "WFWorkflowMinimumClientVersion": 900,
    "WFWorkflowMinimumClientVersionString": "900",
    "WFWorkflowIcon": {"WFWorkflowIconStartColor": 4282601983, "WFWorkflowIconGlyphNumber": 59511},
    "WFWorkflowImportQuestions": [],
    "WFWorkflowInputContentItemClasses": ["WFSafariWebPageContentItem", "WFURLContentItem"],
    "WFWorkflowTypes": ["ActionExtension"],
    "WFWorkflowActions": [
        {
            "WFWorkflowActionIdentifier": "is.workflow.actions.runjavascriptonwebpage",
            "WFWorkflowActionParameters": {"UUID": js_uuid, "WFJavaScript": js},
        },
        {
            "WFWorkflowActionIdentifier": "is.workflow.actions.openurl",
            "WFWorkflowActionParameters": {
                "WFInput": {
                    "Value": {"OutputUUID": js_uuid, "OutputName": "JavaScript の結果", "Type": "ActionOutput"},
                    "WFSerializationType": "WFTextTokenAttachment",
                }
            },
        },
    ],
}

out = pathlib.Path(__file__).resolve().parent
unsigned = out / "Hikidashi.unsigned.shortcut"
signed = out / "Hikidashi に保存.shortcut"
with open(unsigned, "wb") as f:
    plistlib.dump(workflow, f, fmt=plistlib.FMT_BINARY)
print("unsigned:", unsigned, unsigned.stat().st_size, "bytes")
r = subprocess.run(["shortcuts", "sign", "--mode", "anyone", "--input", str(unsigned), "--output", str(signed)], capture_output=True, text=True)
print(r.returncode, r.stdout.strip(), r.stderr.strip()[:400])
if r.returncode == 0:
    print("signed:", signed, signed.stat().st_size, "bytes")
