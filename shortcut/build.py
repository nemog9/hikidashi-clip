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
url_uuid = str(uuid.uuid4()).upper()

def attachment(uuid_, name):
    """アクションの出力（マジック変数）だけを入れた、テキストの値。"""
    return {
        "Value": {"string": "\ufffc", "attachmentsByRange": {"{0, 1}": {"OutputUUID": uuid_, "OutputName": name, "Type": "ActionOutput"}}},
        "WFSerializationType": "WFTextTokenString",
    }

# 入力は、明示的に「ショートカットの入力」（共有シートで渡された Safari の Web ページ）にする。
shortcut_input = {"Value": {"Type": "ExtensionInput"}, "WFSerializationType": "WFTextTokenAttachment"}

def run_js_action(code):
    return {
        "WFWorkflowActionIdentifier": "is.workflow.actions.runjavascriptonwebpage",
        "WFWorkflowActionParameters": {"UUID": js_uuid, "WFInput": shortcut_input, "WFJavaScript": code},
    }

run_js = run_js_action(js)
# 診断用の、最小の JavaScript（動いているか、ページの題名と URL が取れるかだけを見る）
min_js = 'completion("OK: " + document.title + " | " + location.href);'

def workflow(actions):
    return {
        "WFWorkflowClientVersion": "2900.0.1",
        "WFWorkflowClientRelease": "26.0",
        "WFWorkflowMinimumClientVersion": 900,
        "WFWorkflowMinimumClientVersionString": "900",
        "WFWorkflowIcon": {"WFWorkflowIconStartColor": 4271458815, "WFWorkflowIconGlyphNumber": 59511},
        "WFWorkflowImportQuestions": [],
        "WFWorkflowInputContentItemClasses": ["WFSafariWebPageContentItem", "WFURLContentItem"],
        "WFWorkflowTypes": ["ActionExtension"],
        "WFWorkflowActions": actions,
    }

variants = {
    # 本番: JavaScript の結果 →「URL」→「URL を開く」
    "Hikidashi に保存": [
        run_js,
        {"WFWorkflowActionIdentifier": "is.workflow.actions.url",
         "WFWorkflowActionParameters": {"UUID": url_uuid, "WFURLActionURL": attachment(js_uuid, "JavaScript の結果")}},
        {"WFWorkflowActionIdentifier": "is.workflow.actions.openurl",
         "WFWorkflowActionParameters": {"WFInput": {"Value": {"OutputUUID": url_uuid, "OutputName": "URL", "Type": "ActionOutput"}, "WFSerializationType": "WFTextTokenAttachment"}}},
    ],
    # 診断用 1: 最小の JavaScript の結果を画面に出す（ショートカットの JavaScript 実行そのものが動くか）
    "Hikidashi 診断（最小）": [
        run_js_action(min_js),
        {"WFWorkflowActionIdentifier": "is.workflow.actions.showresult",
         "WFWorkflowActionParameters": {"Text": attachment(js_uuid, "JavaScript の結果")}},
    ],
    # 診断用 2: 本番と同じ JavaScript の結果を、そのまま画面に出す
    "Hikidashi 診断": [
        run_js,
        {"WFWorkflowActionIdentifier": "is.workflow.actions.showresult",
         "WFWorkflowActionParameters": {"Text": attachment(js_uuid, "JavaScript の結果")}},
    ],
}

out = pathlib.Path(__file__).resolve().parent
for name, actions in variants.items():
    unsigned = out / f"{name}.unsigned.shortcut"
    signed = out / f"{name}.shortcut"
    with open(unsigned, "wb") as f:
        plistlib.dump(workflow(actions), f, fmt=plistlib.FMT_BINARY)
    r = subprocess.run(["shortcuts", "sign", "--mode", "anyone", "--input", str(unsigned), "--output", str(signed)], capture_output=True, text=True)
    print(name, "→", "署名 OK" if r.returncode == 0 else f"署名 失敗: {r.stderr.strip()[:200]}", signed.stat().st_size if signed.exists() else "")
    unsigned.unlink()
