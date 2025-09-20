// 画像圧縮ツール - 比較モーダル（ホバー/タッチで原画に切り替え）版
// - カード画像クリック/「比較」ボタンでモーダル表示
// - 通常は「圧縮後」を表示、画像の上にマウスオーバー or タッチしている間だけ「元画像」に切り替え
// - D&D, 一括ZIP, 品質UI(rAF同期), 段階縮小など既存機能は維持

// ===== DOM参照 =====
const els = {
  fileInput: document.getElementById("fileInput"),
  dropzone: document.getElementById("dropzone"),
  preview: document.getElementById("preview"),
  progress: document.getElementById("progress"),
  maxEdge: document.getElementById("maxEdge"),
  format: document.getElementById("format"),
  quality: document.getElementById("quality"),
  qualityVal: document.getElementById("qualityVal"),
  qualityNote: document.getElementById("qualityNote"),
  bgColor: document.getElementById("bgColor"),
  downloadAllBtn: document.getElementById("downloadAllBtn"),
  clearBtn: document.getElementById("clearBtn"),
  reencodeAllBtn: document.getElementById("reencodeAllBtn"),
};

// ===== 状態 =====
const state = {
  items: /** @type {ProcessedItem[]} */ ([]),
  settings: {
    maxEdge: parseInt(els.maxEdge.value, 10) || 1920,
    format: els.format.value,
    quality: asQuality(els.quality?.value),
    bgColor: els.bgColor.value,
  },
};

// ===== 型定義（参考用） =====
/**
 * @typedef {Object} ProcessedItem
 * @property {File} file
 * @property {HTMLImageElement|ImageBitmap} bitmap
 * @property {number} srcWidth
 * @property {number} srcHeight
 * @property {Blob|null} blob
 * @property {string|null} url
 * @property {string} outName
 * @property {number} outWidth
 * @property {number} outHeight
 * @property {string|null|undefined} origUrl
 */

// ===== 品質UI（一本化+rAF監視） =====
const qualityLive = { raf: 0, last: null, tracking: false };
function asQuality(v) {
  let q = parseFloat(v);
  if (!Number.isFinite(q)) q = 0.8;
  return Math.min(1, Math.max(0.1, q));
}
function supportsQualityFmt(fmt) {
  return fmt === "image/webp" || fmt === "image/jpeg";
}
function renderQualityUI() {
  const fmt = els.format.value;
  const supports = supportsQualityFmt(fmt);
  if (els.quality) els.quality.disabled = !supports;

  const q = asQuality(els.quality?.value);
  if (els.quality) els.quality.value = String(q);
  if (els.qualityVal) els.qualityVal.textContent = q.toFixed(2);
  state.settings.quality = q;

  if (els.qualityNote) {
    els.qualityNote.textContent = supports
      ? "※WebP/JPEGのみ有効"
      : "※この形式では品質スライダーは無効";
  }
}
function startQualityTracking() {
  if (qualityLive.tracking) return;
  qualityLive.tracking = true;
  const tick = () => {
    if (!qualityLive.tracking) return;
    const cur = els.quality ? els.quality.value : null;
    if (cur !== qualityLive.last) {
      qualityLive.last = cur;
      renderQualityUI();
    }
    qualityLive.raf = requestAnimationFrame(tick);
  };
  qualityLive.raf = requestAnimationFrame(tick);
}
function stopQualityTracking() {
  qualityLive.tracking = false;
  if (qualityLive.raf) cancelAnimationFrame(qualityLive.raf);
  qualityLive.raf = 0;
  renderQualityUI();
}
renderQualityUI();

// ===== UIイベント =====
els.fileInput.addEventListener("change", (e) => {
  const files = /** @type {FileList} */ (e.target.files);
  if (!files?.length) return;
  addFiles(Array.from(files));
  els.fileInput.value = "";
});
["dragenter", "dragover"].forEach((evt) =>
  els.dropzone.addEventListener(evt, (e) => {
    e.preventDefault();
    e.stopPropagation();
    els.dropzone.classList.add("dragover");
  })
);
["dragleave", "drop"].forEach((evt) =>
  els.dropzone.addEventListener(evt, (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (evt === "drop") {
      const dt = /** @type {DragEvent} */ (e).dataTransfer;
      const files = dt?.files ? Array.from(dt.files) : [];
      if (files.length) addFiles(files);
    }
    els.dropzone.classList.remove("dragover");
  })
);
els.dropzone.addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === " ") els.fileInput.click();
});

els.maxEdge.addEventListener("change", () => {
  state.settings.maxEdge = clamp(
    parseInt(els.maxEdge.value, 10) || 1920,
    64,
    12000
  );
  els.maxEdge.value = String(state.settings.maxEdge);
});
els.format.addEventListener("change", () => {
  state.settings.format = els.format.value;
  renderQualityUI();
});
["input", "change"].forEach((evt) =>
  els.quality.addEventListener(evt, renderQualityUI)
);
["pointerdown", "touchstart", "focus"].forEach((evt) =>
  els.quality.addEventListener(evt, startQualityTracking)
);
["pointerup", "touchend", "touchcancel", "blur"].forEach((evt) =>
  els.quality.addEventListener(evt, stopQualityTracking)
);
els.bgColor.addEventListener("change", () => {
  state.settings.bgColor = els.bgColor.value;
});

els.clearBtn.addEventListener("click", clearAll);
els.reencodeAllBtn.addEventListener("click", async () => {
  if (!state.items.length) return;
  setProgress(`再エンコード中... 0/${state.items.length}`);
  let done = 0;
  for (const item of state.items) {
    await encodeItem(item, state.settings);
    done++;
    setProgress(`再エンコード中... ${done}/${state.items.length}`);
  }
  render();
  setProgress("");
});
els.downloadAllBtn.addEventListener("click", async () => {
  if (!state.items.length) return;

  const zip = new JSZip();
  let added = 0;
  for (const item of state.items) {
    if (!item.blob) continue;
    zip.file(item.outName, item.blob);
    added++;
  }
  if (!added) return;

  setProgress("ZIP を作成中...");
  const blob = await zip.generateAsync({
    type: "blob",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });
  setProgress("");

  const filename = `compressed_${formatDateTime()}.zip`;

  try {
    // ✅ 既定：ブラウザのダウンロードマネージャに乗る方法
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename; // ここが“ダウンロード扱い”の肝
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    a.remove();
    // revokeは少し遅らせる（Safari対策）
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  } catch (err) {
    // フォールバック：File System Access API（HTTPS or localhost）
    if (window.showSaveFilePicker) {
      try {
        const handle = await window.showSaveFilePicker({
          suggestedName: filename,
          types: [
            {
              description: "ZIP Archive",
              accept: { "application/zip": [".zip"] },
            },
          ],
          excludeAcceptAllOption: false,
        });
        const writable = await handle.createWritable();
        await writable.write(blob);
        await writable.close();
      } catch (e) {
        // ユーザーキャンセル等は無視
      }
    } else {
      // 最終フォールバック
      downloadBlob(blob, filename);
    }
  }
});

// ===== メイン処理 =====
async function addFiles(files) {
  const valid = files.filter((f) => /^image\//.test(f.type));
  if (!valid.length) return;

  let processed = 0;
  setProgress(`読み込み中... 0/${valid.length}`);
  for (const file of valid) {
    try {
      const item = await createItemFromFile(file);
      await encodeItem(item, state.settings);
      state.items.push(item);
      processed++;
      setProgress(`処理中... ${processed}/${valid.length}`);
      appendCard(item);
    } catch (err) {
      console.error("failed:", file.name, err);
      setProgress(
        `エラー: ${file.name} は処理できませんでした（${processed}/${valid.length}）`
      );
    }
  }
  setProgress("");
}

function clearAll() {
  for (const item of state.items) {
    if (item.url) URL.revokeObjectURL(item.url);
    if (item.origUrl) URL.revokeObjectURL(item.origUrl);
    if ("close" in item.bitmap && typeof item.bitmap.close === "function") {
      try {
        item.bitmap.close();
      } catch {}
    }
  }
  state.items = [];
  els.preview.innerHTML = "";
  setProgress("");
}

async function createItemFromFile(file) {
  const buf = await file.arrayBuffer();
  const orientation = getExifOrientation(new DataView(buf));

  let bitmap = null;
  try {
    bitmap = await createImageBitmap(new Blob([buf], { type: file.type }), {
      imageOrientation: "from-image",
    });
  } catch {
    const img = await loadHTMLImage(URL.createObjectURL(file));
    bitmap = await imageToBitmap(img);
  }

  const item = /** @type {ProcessedItem} */ ({
    file,
    bitmap,
    srcWidth: bitmap.width,
    srcHeight: bitmap.height,
    blob: null,
    url: null,
    outName: makeOutName(file.name, guessExtFromMime(state.settings.format)),
    outWidth: bitmap.width,
    outHeight: bitmap.height,
    origUrl: null,
  });

  if (orientation !== 1 && !supportsImageOrientationFromImage()) {
    const rotated = drawWithOrientation(bitmap, orientation);
    if ("close" in bitmap && typeof bitmap.close === "function") {
      try {
        bitmap.close();
      } catch {}
    }
    item.bitmap = rotated.bitmap;
    item.srcWidth = rotated.width;
    item.srcHeight = rotated.height;
  }
  return item;
}

async function encodeItem(item, settings) {
  const { width: tw, height: th } = fitWithin(
    item.bitmap.width,
    item.bitmap.height,
    settings.maxEdge
  );
  item.outWidth = tw;
  item.outHeight = th;

  const canvas = await resampleToCanvas(item.bitmap, tw, th);

  const needsOpaque =
    settings.format === "image/jpeg" || settings.format === "image/gif";
  if (needsOpaque) flattenAlpha(canvas, settings.bgColor);

  let blob = null;
  if (settings.format === "image/webp")
    blob = await canvasToBlob(canvas, "image/webp", state.settings.quality);
  else if (settings.format === "image/jpeg")
    blob = await canvasToBlob(canvas, "image/jpeg", state.settings.quality);
  else if (settings.format === "image/png")
    blob = await canvasToBlob(canvas, "image/png");
  else if (settings.format === "image/gif")
    blob = await canvasToGifBlob(canvas);
  else blob = await canvasToBlob(canvas, "image/webp", state.settings.quality);

  if (item.url) URL.revokeObjectURL(item.url);
  item.blob = blob;
  item.url = blob ? URL.createObjectURL(blob) : null;
  item.outName = makeOutName(item.file.name, guessExtFromMime(settings.format));
}

// ===== 比較モーダル（ホバー/タッチ切替） =====
function getOriginalUrl(item) {
  if (item.origUrl) return item.origUrl;
  item.origUrl = URL.createObjectURL(item.file);
  return item.origUrl;
}
function injectCompareStyles() {
  if (document.getElementById("cmpStyles")) return;
  const css = `
  .cmp-overlay{position:fixed;inset:0;background:rgba(0,0,0,.75);display:flex;align-items:center;justify-content:center;z-index:9999}
  .cmp-dialog{width:min(92vw,1400px);max-height:90vh;background:#0e1117;border:1px solid #2a2f3a;border-radius:12px;box-shadow:0 20px 80px rgba(0,0,0,.5);display:flex;flex-direction:column;gap:10px;padding:12px}
  .cmp-topbar{display:flex;align-items:center;justify-content:space-between;gap:8px}
  .cmp-title{font-weight:700;color:#e8eaed}
  .cmp-close,.cmp-fs{appearance:none;border:1px solid #394150;background:#121826;color:#e8eaed;border-radius:8px;padding:6px 10px;cursor:pointer}
  .cmp-stage{position:relative;flex:1;min-height:300px;max-height:70vh;background:#0b0c0f;border-radius:10px;overflow:hidden;border:1px solid #2a2f3a;display:flex;align-items:center;justify-content:center}
  .cmp-img{position:absolute;max-width:100%;max-height:100%;object-fit:contain;user-select:none}
  .cmp-after{opacity:1;transition:opacity .12s ease}
  .cmp-before{opacity:0;transition:opacity .12s ease}
  .cmp-stage.hovering .cmp-after{opacity:0}
  .cmp-stage.hovering .cmp-before{opacity:1}
  .cmp-legend{display:flex;justify-content:space-between;color:#9aa0a6;font-size:12px}
  .cmp-badge{background:#121826;border:1px solid #2a2f3a;color:#e8eaed;border-radius:999px;padding:4px 8px}
  .cmp-hint{color:#9aa0a6;font-size:12px;text-align:center;margin-top:2px}
  .card img{cursor:zoom-in}
  .cmp-corner-label{position:absolute;top:8px;right:8px;background:rgba(18,24,38,.85);color:#e8eaed;border:1px solid #2a2f3a;border-radius:999px;padding:4px 8px;font-size:12px;pointer-events:none}

  /* === ページ内で擬似フルスクリーン（最大化） === */
  .cmp-overlay.fullpad { padding: 0 } /* 余白を無くす（必要なら） */
  .cmp-dialog.is-maximized{width:100vw;height:100vh;max-height:100vh;border-radius:0}
  .cmp-dialog.is-maximized .cmp-stage{max-height:calc(100vh - 96px)} /* タイトル・余白分 */
  `;

  const style = document.createElement("style");
  style.id = "cmpStyles";
  style.textContent = css;
  document.head.appendChild(style);
}
let cmp =
  /** @type {null | {overlay:HTMLElement, dialog:HTMLElement, stage:HTMLElement, before:HTMLImageElement, after:HTMLImageElement, label:HTMLDivElement, fsBtn:HTMLButtonElement, closeBtn:HTMLButtonElement}} */ (
    null
  );

function ensureCompareOverlay() {
  injectCompareStyles();
  if (cmp) return cmp;

  const overlay = document.createElement("div");
  overlay.className = "cmp-overlay";
  overlay.id = "cmpOverlay";
  overlay.innerHTML = `
    <div class="cmp-dialog" role="dialog" aria-modal="true" aria-label="比較ビュー">
      <div class="cmp-topbar">
        <div class="cmp-title">ホバー/タッチで原画プレビュー</div>
        <div style="display:flex; gap:8px;">
          <button class="cmp-fs"   aria-label="拡大">⤢ 拡大</button>
          <button class="cmp-close" aria-label="閉じる">×</button>
        </div>
      </div>
      <div class="cmp-stage" id="cmpStage">
        <img class="cmp-img cmp-after" id="cmpAfter" alt="圧縮後" />
        <img class="cmp-img cmp-before" id="cmpBefore" alt="元画像（ホバー/タッチで表示）" />
        <div class="cmp-corner-label" id="cmpLabel" aria-live="polite">圧縮後</div>
      </div>
      <div class="cmp-legend"><span class="cmp-badge">通常＝圧縮後</span><span class="cmp-badge">ホバー/タッチ中＝元画像</span></div>
      <div class="cmp-hint">ヒント: マウスクリック/指で押さえている間だけ原画になります。Esc で閉じる。</div>
    </div>
  `;
  document.body.appendChild(overlay);

  const dialog = overlay.querySelector(".cmp-dialog");
  const stage = overlay.querySelector("#cmpStage");
  const before = overlay.querySelector("#cmpBefore");
  const after = overlay.querySelector("#cmpAfter");
  const label = overlay.querySelector("#cmpLabel");
  const fsBtn = overlay.querySelector(".cmp-fs");
  const closeBtn = overlay.querySelector(".cmp-close");

  // 閉じる
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) closeCompare();
  });
  closeBtn.addEventListener("click", closeCompare);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeCompare();
  });

  // ホバー/タッチで切替＋ラベル更新
  const showOrig = () => {
    stage.classList.add("hovering");
    label.textContent = "元画像";
  };
  const showComp = () => {
    stage.classList.remove("hovering");
    label.textContent = "圧縮後";
  };

  // 画面いっぱい（擬似フルスクリーン）切替
  fsBtn.addEventListener("click", toggleMaximize);
  document.addEventListener("keydown", (e) => {
    if (
      cmp?.overlay.style.display === "flex" &&
      (e.key === "f" || e.key === "F")
    ) {
      toggleMaximize();
    }
  });

  function toggleMaximize() {
    const maximized = dialog.classList.toggle("is-maximized");
    // 余白も除去したい場合は overlay にもクラス
    overlay.classList.toggle("fullpad", maximized);
    fsBtn.textContent = maximized ? "⤡ 縮小" : "⤢ 画面いっぱい";
  }

  // フルスクリーン終了時のボタン表示を戻す
  document.addEventListener("fullscreenchange", () => {
    if (!document.fullscreenElement && fsBtn) {
      fsBtn.textContent = "⤢ フルスクリーン";
    }
  });

  stage.addEventListener("pointerenter", showOrig);
  stage.addEventListener("pointerleave", showComp);
  stage.addEventListener("pointerdown", showOrig);
  stage.addEventListener("pointerup", showComp);
  stage.addEventListener("touchstart", showOrig, { passive: true });
  stage.addEventListener("touchend", showComp);

  cmp = { overlay, dialog, stage, before, after, label, fsBtn, closeBtn };
  return cmp;
}
function openCompare(item) {
  const ui = ensureCompareOverlay();
  ui.after.src = item.url || ""; // 通常時＝圧縮後を表示
  ui.before.src = getOriginalUrl(item); // ホバー/タッチ中＝原画を表示
  ui.stage.classList.remove("hovering");
  ui.label && (ui.label.textContent = "圧縮後");
  document.body.style.overflow = "hidden";
  ui.overlay.style.display = "flex";
  ui.dialog.classList.remove("is-maximized");
  ui.overlay.classList.remove("fullpad");
  ui.fsBtn && (ui.fsBtn.textContent = "⤢ 画面いっぱい");
  ui.closeBtn.focus?.();
}
function closeCompare() {
  if (!cmp) return;
  // 念のため：ブラウザFSが残っていたら解除（他処理に影響なし）
  try {
    document.fullscreenElement && document.exitFullscreen?.();
  } catch {}
  // 擬似フルスクリーンを解除
  cmp.dialog.classList.remove("is-maximized");
  cmp.overlay.classList.remove("fullpad");
  // モーダルを閉じる & スクロール戻す
  cmp.overlay.style.display = "none";
  document.body.style.overflow = ""; // 必ずスクロール復帰
}

// ===== 画像ユーティリティ =====
function supportsImageOrientationFromImage() {
  return "createImageBitmap" in window;
}
function getExifOrientation(view) {
  if (view.byteLength < 4 || view.getUint16(0) !== 0xffd8) return 1;
  let offset = 2;
  while (offset < view.byteLength) {
    const marker = view.getUint16(offset);
    offset += 2;
    if (marker === 0xffe1) {
      const size = view.getUint16(offset);
      offset += 2;
      if (
        view.getUint32(offset) === 0x45786966 &&
        view.getUint16(offset + 4) === 0x0000
      ) {
        let tiffOffset = offset + 6;
        const little = view.getUint16(tiffOffset) === 0x4949;
        const get16 = (o) => view.getUint16(o, little);
        const get32 = (o) => view.getUint32(o, little);
        if (get16(tiffOffset + 2) !== 0x002a) return 1;
        const ifd0 = tiffOffset + get32(tiffOffset + 4);
        const entries = get16(ifd0);
        for (let i = 0; i < entries; i++) {
          const entry = ifd0 + 2 + i * 12;
          const tag = get16(entry);
          if (tag === 0x0112) {
            const val = get16(entry + 8);
            return val || 1;
          }
        }
      }
      break;
    } else if ((marker & 0xff00) !== 0xff00) {
      break;
    } else {
      const size = view.getUint16(offset);
      offset += size;
    }
  }
  return 1;
}
function loadHTMLImage(url) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = rej;
    img.src = url;
  });
}
async function imageToBitmap(img) {
  if ("createImageBitmap" in window) return await createImageBitmap(img);
  const c = document.createElement("canvas");
  c.width = img.naturalWidth;
  c.height = img.naturalHeight;
  const g = c.getContext("2d");
  g.drawImage(img, 0, 0);
  return await createImageBitmap(c);
}
function drawWithOrientation(bitmap, orientation) {
  const w = bitmap.width,
    h = bitmap.height;
  const c = document.createElement("canvas");
  const g = c.getContext("2d");
  if ([5, 6, 7, 8].includes(orientation)) {
    c.width = h;
    c.height = w;
  } else {
    c.width = w;
    c.height = h;
  }
  switch (orientation) {
    case 2:
      g.translate(w, 0);
      g.scale(-1, 1);
      break;
    case 3:
      g.translate(w, h);
      g.rotate(Math.PI);
      break;
    case 4:
      g.translate(0, h);
      g.scale(1, -1);
      break;
    case 5:
      g.rotate(0.5 * Math.PI);
      g.scale(1, -1);
      break;
    case 6:
      g.rotate(0.5 * Math.PI);
      g.translate(0, -h);
      break;
    case 7:
      g.rotate(1.5 * Math.PI);
      g.scale(1, -1);
      g.translate(-w, 0);
      break;
    case 8:
      g.rotate(1.5 * Math.PI);
      g.translate(-w, 0);
      break;
  }
  g.drawImage(bitmap, 0, 0);
  const outBitmap =
    typeof createImageBitmap === "function" ? awaitMaybeBitmap(c) : bitmap;
  return { bitmap: outBitmap ?? bitmap, width: c.width, height: c.height };
}
async function awaitMaybeBitmap(canvas) {
  try {
    return await createImageBitmap(canvas);
  } catch {
    return null;
  }
}
function fitWithin(w, h, maxEdge) {
  // maxEdgeを幅として扱う
  if (w <= maxEdge) return { width: w, height: h };
  const ratio = maxEdge / w;
  return { width: Math.round(w * ratio), height: Math.round(h * ratio) };
}
async function resampleToCanvas(bitmap, tw, th) {
  let cw = bitmap.width,
    ch = bitmap.height;
  let source = bitmap;
  const stepDown = () => {
    const nw = Math.max(tw, Math.floor(cw / 2));
    const nh = Math.max(th, Math.floor(ch / 2));
    const c = document.createElement("canvas");
    c.width = nw;
    c.height = nh;
    const g = c.getContext("2d");
    g.imageSmoothingQuality = "high";
    g.drawImage(source, 0, 0, cw, ch, 0, 0, nw, nh);
    cw = nw;
    ch = nh;
    return c;
  };
  let canvas = null;
  while (cw / 2 > tw && ch / 2 > th) {
    canvas = stepDown();
    source = canvas;
  }
  const final = document.createElement("canvas");
  final.width = tw;
  final.height = th;
  final.getContext("2d").imageSmoothingQuality = "high";
  final.getContext("2d").drawImage(source, 0, 0, cw, ch, 0, 0, tw, th);
  return final;
}
function flattenAlpha(canvas, color) {
  const { width, height } = canvas;
  const g = canvas.getContext("2d");
  const prev = g.globalCompositeOperation;
  g.globalCompositeOperation = "destination-over";
  g.fillStyle = color || "#ffffff";
  g.fillRect(0, 0, width, height);
  g.globalCompositeOperation = prev;
}
function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) return reject(new Error("toBlob failed"));
        resolve(blob);
      },
      type,
      quality
    );
  });
}
function canvasToGifBlob(canvas) {
  return new Promise((resolve, reject) => {
    try {
      const gif = new window.GIF({
        workers: 1,
        quality: 10,
        width: canvas.width,
        height: canvas.height,
        workerScript:
          "https://cdn.jsdelivr.net/gh/jnordberg/gif.js/dist/gif.worker.js",
      });
      gif.addFrame(canvas, { delay: 0, copy: true });
      gif.on("finished", (blob) => resolve(blob));
      gif.on("abort", () => reject(new Error("GIF encode aborted")));
      gif.render();
    } catch (e) {
      reject(e);
    }
  });
}

// ===== カード描画 =====
function appendCard(item) {
  const el = document.createElement("article");
  el.className = "card";
  const origKB = (item.file.size / 1024).toFixed(1);
  const outKB = item.blob ? (item.blob.size / 1024).toFixed(1) : "-";
  el.innerHTML = `
    <div class="meta">
      <span class="name" title="${escapeHTML(item.file.name)}">${escapeHTML(
    item.file.name
  )}</span>
      <span class="mono">${item.srcWidth}×${item.srcHeight}</span>
    </div>
    <div class="body">
      <img src="${item.url ?? ""}" alt="${escapeHTML(
    item.file.name
  )}（圧縮後プレビュー）" style="cursor:zoom-in" />
      <div class="stats">
        <div>元サイズ: ${origKB} KB</div>
        <div>圧縮後: ${outKB} KB</div>
        <div>出力: ${item.outWidth}×${item.outHeight}</div>
        <div>形式: ${guessExtFromMime(
          state.settings.format
        ).toUpperCase()}</div>
      </div>
    </div>
    <div class="actions">
      <a class="btn" href="${item.url ?? "#"}" download="${
    item.outName
  }">保存</a>
      <button class="btn btn-secondary compare">比較</button>
      <button class="btn btn-secondary reencode">個別に再エンコード</button>
      <button class="btn btn-secondary remove">削除</button>
    </div>
  `;
  // 比較
  el.querySelector("img").addEventListener("click", () => openCompare(item));
  el.querySelector(".compare").addEventListener("click", () =>
    openCompare(item)
  );

  // 再エンコード
  el.querySelector(".reencode").addEventListener("click", async () => {
    setProgress(`再エンコード中... ${item.file.name}`);
    await encodeItem(item, state.settings);
    el.querySelector("img").src = item.url ?? "";
    el.querySelector(".stats").innerHTML = `
      <div>元サイズ: ${origKB} KB</div>
      <div>圧縮後: ${
        item.blob ? (item.blob.size / 1024).toFixed(1) : "-"
      } KB</div>
      <div>出力: ${item.outWidth}×${item.outHeight}</div>
      <div>形式: ${guessExtFromMime(state.settings.format).toUpperCase()}</div>
    `;
    setProgress("");
  });

  // 削除
  el.querySelector(".remove").addEventListener("click", () => {
    if (item.url) URL.revokeObjectURL(item.url);
    if (item.origUrl) URL.revokeObjectURL(item.origUrl);
    state.items = state.items.filter((x) => x !== item);
    el.remove();
  });

  els.preview.appendChild(el);
}
function render() {
  els.preview.innerHTML = "";
  for (const item of state.items) appendCard(item);
}
function setProgress(msg) {
  els.progress.textContent = msg || "";
}

// ===== 小物 =====
function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}
function makeOutName(name, ext) {
  const base = name.replace(/\.[^.]+$/, "");
  return `${base}.${ext}`;
}
function guessExtFromMime(mime) {
  switch (mime) {
    case "image/webp":
      return "webp";
    case "image/png":
      return "png";
    case "image/jpeg":
      return "jpg";
    case "image/gif":
      return "gif";
    default:
      return "webp";
  }
}
function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function formatDateTime() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(
    d.getHours()
  )}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}
function escapeHTML(s) {
  return s.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[
        c
      ])
  );
}
