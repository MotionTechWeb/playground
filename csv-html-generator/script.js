// --- CSV parser with heuristic for unclosed quotes -------------------------------
function parseCSV(text) {
  // Normalize line endings
  text = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const rows = [];
  let i = 0, field = "", row = [], inQuotes = false;

  while (i < text.length) {
    const c = text[i];
    if (c === '"') {
      if (inQuotes && text[i + 1] === '"') {
        field += '"'; i++; // escaped quote
      } else {
        inQuotes = !inQuotes;
      }
    } else if (c === ',' && !inQuotes) {
      row.push(field); field = "";
    } else if (c === '\n') {
      if (inQuotes) {
        // Heuristic: auto-close a field at EOL if quotes were not closed
        inQuotes = false;
      }
      row.push(field); field = "";
      rows.push(row);
      row = [];
    } else {
      field += c;
    }
    i++;
  }
  row.push(field);
  rows.push(row);
  return rows;
}

// --- Helpers --------------------------------------------------------------------
const FULLWIDTH_SPACE = /\u3000/g;
function normalizeKey(s) {
  if (typeof s !== "string") return "";
  return s.replace(FULLWIDTH_SPACE, " ").trim();
}
function isBlankRow(arr) {
  return arr.every(cell => String(cell || "").trim() === "");
}
function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, s => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[s]));
}
function safeJSON(text, fallback) {
  try { return JSON.parse(text); } catch { return fallback; }
}

// --- Core: CSV → Sections --------------------------------------------------------
function csvToSections(rows, mapping) {
  const sections = [];
  let current = null;

  const titleKeysExact   = mapping.title_keys_exact?.map(k => k.trim()) ?? ["テストタイトル"];
  const imageKeysContains = mapping.image_keys_contains ?? ["画像パス"];
  const textKeysContains  = mapping.text_keys_contains  ?? ["テキスト", "本文"];
  const templatesByHeader = mapping.templates_by_header || {}; // e.g., { "テストタイトルテストタイトル": "typeA" }
  const defaultTemplate   = mapping.default_template || "standard";

  const eq = (a, b) => a === b;
  const containsAny = (key, arr) => arr.some(x => key.includes(x));

  for (const row of rows) {
    const keyRaw = normalizeKey(row[1] ?? "");
    const valRaw = String(row[2] ?? "").trim();

    if (isBlankRow(row)) {
      if (current && (current.title || current.img || current.text)) {
        sections.push(current);
      } else if (current && current.header) {
        // header-only block: still push an empty block so template can render its own layout
        sections.push(current);
      }
      current = null;
      continue;
    }

    // Section header detection:
    // - B列に値があり、C列が空、かつ既知キーに該当しない → これはブロック種別の見出しとみなす
    const looksLikeHeader = keyRaw && !valRaw &&
      !titleKeysExact.includes(keyRaw) &&
      !containsAny(keyRaw, imageKeysContains) &&
      !containsAny(keyRaw, textKeysContains);

    if (looksLikeHeader) {
      // flush previous block if it has any data
      if (current && (current.title || current.img || current.text || current.header)) {
        sections.push(current);
      }
      current = {
        title: "",
        img: "",
        text: "",
        header: keyRaw,
        template: templatesByHeader[keyRaw] || defaultTemplate
      };
      continue;
    }

    if (!current) current = { title: "", img: "", text: "", header: "", template: defaultTemplate };
    if (!current.template) current.template = defaultTemplate;

    // Map fields by key
    if (titleKeysExact.some(k => eq(keyRaw, k))) {
      current.title = valRaw;
      continue;
    }
    if (containsAny(keyRaw, imageKeysContains)) {
      current.img = valRaw;
      continue;
    }
    if (containsAny(keyRaw, textKeysContains)) {
      current.text = current.text ? (current.text + "\n" + valRaw) : valRaw;
      continue;
    }
    // unknown keys are ignored
  }

  if (current && (current.title || current.img || current.text || current.header)) {
    sections.push(current);
  }
  return sections;
}

// --- Templates ------------------------------------------------------------------
function renderBlock(sec) {
  const h = s => escapeHtml(s || "");
  const textHtml = sec.text ? h(sec.text).replace(/\n/g, "<br>") : "";

  switch (sec.template) {
    case "standard":
      return [`<div class="block">`,
              sec.title ? `  <h2>${h(sec.title)}</h2>` : "",
              sec.img   ? `  <img src="${sec.img}" alt="">` : "",
              sec.text  ? `  <p>${textHtml}</p>` : "",
              `</div>`].filter(Boolean).join("\n");

    case "hero": // 例: 大きい画像＋太字タイトル
      return [`<section class="block hero">`,
              sec.img   ? `  <figure><img src="${sec.img}" alt=""></figure>` : "",
              sec.title ? `  <h2 class="hero-title">${h(sec.title)}</h2>` : "",
              sec.text  ? `  <p class="hero-text">${textHtml}</p>` : "",
              `</section>`].filter(Boolean).join("\n");

    case "text-only": // 例: 画像なし
      return [`<section class="block text-only">`,
              sec.header ? `  <div class="label">${h(sec.header)}</div>` : "",
              sec.title  ? `  <h3>${h(sec.title)}</h3>` : "",
              sec.text   ? `  <p>${textHtml}</p>` : "",
              `</section>`].filter(Boolean).join("\n");

    default:
      // fallback to standard
      return [`<div class="block">`,
              sec.title ? `  <h2>${h(sec.title)}</h2>` : "",
              sec.img   ? `  <img src="${sec.img}" alt="">` : "",
              sec.text  ? `  <p>${textHtml}</p>` : "",
              `</div>`].filter(Boolean).join("\n");
  }
}

// --- Sections → HTML ------------------------------------------------------------
function sectionsToHtml(sections, { wrapFull = true } = {}) {
  const blocks = sections.map(renderBlock).join("\n");

  if (!wrapFull) return blocks;

  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Generated</title>
  <style>
    body { font-family: "Noto Sans JP", system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial; line-height:1.7; margin: 20px; }
    .block { border: 1px solid #ddd; padding: 12px; border-radius: 10px; margin: 12px 0; }
    .block.hero { text-align:center; }
    .block.hero img { max-width:100%; border-radius:12px; }
    .block.hero .hero-title { font-size:1.5rem; margin: 10px 0 0; }
    .block.text-only .label { color:#666; font-size:12px; text-transform:uppercase; letter-spacing:.08em; }
    img { max-width: 100%; display:block; border-radius: 8px; }
    h2, h3 { margin: 0 0 8px; }
    p { margin: 8px 0 0; white-space: normal; }
  </style>
</head>
<body>
${blocks}
</body>
</html>`;
}

// --- UI Wiring (unchanged API) --------------------------------------------------
const $ = s => document.querySelector(s);
function setOutput(html) {
  const out = $("#html-output");
  out.value = html;
  const preview = $("#preview");
  preview.innerHTML = "";
  const inner = html.includes("<!DOCTYPE html>")
    ? html.split("<body>")[1]?.split("</body>")[0] ?? html
    : html;
  const wrapper = document.createElement("div");
  wrapper.innerHTML = inner;
  preview.appendChild(wrapper);
}

async function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = reject;
    r.readAsText(file, "utf-8");
  });
}

function generate() {
  const csvText = document.querySelector("#csv-input").value;
  const mapping = safeJSON(document.querySelector("#mapping-json").value, {});
  const wrapFull = document.querySelector("#wrap-full").checked;

  if (!csvText.trim()) { setOutput(""); return; }

  const rows = parseCSV(csvText);
  const sections = csvToSections(rows, mapping);
  const html = sectionsToHtml(sections, { wrapFull });
  setOutput(html);
}

function copyOutput() {
  const out = document.querySelector("#html-output");
  out.select(); document.execCommand("copy");
}
function downloadHTML() {
  const blob = new Blob([document.querySelector("#html-output").value], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = "generated.html"; a.click();
  URL.revokeObjectURL(url);
}

const SAMPLE = `,,,,,,,,,,,,,,,,,,,,,,,,,,,
,テストタイトルテストタイトル,,,,,,,,,,,,,,,,,,,,,,,,,,
,テストタイトル,タイトルタイトルタイトルタイトル
,コンテンツ1　画像パス,/hoge/test1.jpg,"※img-2の画像（右側の画像）を挿入したいです
,テキスト,テキストテキストテキストテキスト
,,,,,,,,,,,,,,,,,,,,,,,,,,,
,テストタイトルテストタイトル,,,,,,,,,,,,,,,,,,,,,,,,,,
,テストタイトル,タイトルタイトルタイトルタイトル2
,コンテンツ1　画像パス,/hoge/test2.jpg,"※img-2の画像（右側の画像）を挿入したいです
,本文,テキストテキストテキストテキスト2`;

window.addEventListener("DOMContentLoaded", () => {
  document.querySelector("#csv-file").addEventListener("change", async (e) => {
    const f = e.target.files?.[0]; if (!f) return;
    document.querySelector("#csv-input").value = await readFileAsText(f);
  });
  document.querySelector("#load-sample").addEventListener("click", () => {
    document.querySelector("#csv-input").value = SAMPLE;
  });
  document.querySelector("#generate").addEventListener("click", generate);
  document.querySelector("#copy").addEventListener("click", copyOutput);
  document.querySelector("#download").addEventListener("click", downloadHTML);
  document.querySelector("#csv-input").addEventListener("input", () => { clearTimeout(window.__deb); window.__deb = setTimeout(generate, 200); });
  document.querySelector("#mapping-json").addEventListener("input", () => { clearTimeout(window.__deb2); window.__deb2 = setTimeout(generate, 200); });
  document.querySelector("#wrap-full").addEventListener("change", generate);
  generate();
});
