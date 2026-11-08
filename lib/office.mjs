// Word（.docx）・Excel（.xlsx）の書類から文字を取り出す。引用の照合は、この文字に対して行う
// どちらも中身は zip にまとめた XML なので、zip を開いて、文字の入っている XML だけを読む
import { unzipSync, strFromU8 } from "fflate";

const MAX_BYTES = 50 * 1024 * 1024; // 展開すると極端に大きくなるファイルは読まない

function open(buffer, wanted) {
  let total = 0;
  const files = unzipSync(new Uint8Array(buffer), {
    filter: (f) => {
      if (!wanted(f.name)) return false;
      total += f.originalSize;
      if (total > MAX_BYTES) throw new Error("ファイルを展開すると大きすぎるため、読めませんでした。");
      return true;
    },
  });
  return Object.fromEntries(Object.entries(files).map(([name, data]) => [name, strFromU8(data)]));
}

const decode = (s) => s
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
const attr = (tag, name) => tag.match(new RegExp(`\\s${name}="([^"]*)"`))?.[1];

// ---- Word ----
// 段落は改行、表は「セルをタブ、行を改行」で並べる
function wordText(xml) {
  const out = [];
  let inText = false;
  let cell = 0;
  const re = /<(\/?)(w:p|w:tc|w:tr|w:t|w:tab|w:br|w:cr|w:noBreakHyphen)\b[^>]*?(\/?)>|([^<]+)|<[^>]*>/g;
  for (const m of xml.matchAll(re)) {
    const [, close, name, self, text] = m;
    if (text != null) { if (inText) out.push(decode(text)); continue; }
    if (!name) continue;
    if (name === "w:t") { inText = !close && !self; continue; }
    if (name === "w:tc") { if (close) { out.push("\t"); cell--; } else if (!self) cell++; continue; }
    if (name === "w:tr") { if (close) out.push("\n"); continue; }
    if (name === "w:p") { if (close || self) out.push(cell > 0 ? " " : "\n"); continue; }
    if (name === "w:tab") out.push("\t");
    else if (name === "w:br" || name === "w:cr") out.push(cell > 0 ? " " : "\n");
    else if (name === "w:noBreakHyphen") out.push("-");
  }
  return out.join("").replace(/ +\t/g, "\t").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

export function docxText(buffer) {
  const files = open(buffer, (n) => /^word\/(document|header\d*|footer\d*)\.xml$/.test(n));
  if (!files["word/document.xml"]) throw new Error("Word の書類として読めませんでした。");
  const parts = [wordText(files["word/document.xml"])];
  // 表題や日付が、ヘッダー・フッターに書かれていることがある
  const extra = Object.keys(files).filter((n) => n !== "word/document.xml").sort()
    .map((n) => wordText(files[n])).filter((t) => t && !parts.includes(t));
  if (extra.length) parts.push(`［ヘッダー・フッター］\n${[...new Set(extra)].join("\n")}`);
  return parts.join("\n\n");
}

// ---- Excel ----
// 見た目のとおりの文字にする（日付は 2026/6/12、金額は 120,000 のように）
const DATE_IDS = new Set([14, 15, 16, 17, 22, 27, 28, 29, 30, 31, 34, 35, 36, 50, 51, 52, 53, 54, 55, 56, 57, 58]);
// Excel にあらかじめ決まっている、数字の書式（番号で指定される）
const BUILTIN = { 1: "0", 2: "0.00", 3: "#,##0", 4: "#,##0.00", 9: "0%", 10: "0.00%", 37: "#,##0;(#,##0)", 38: "#,##0;(#,##0)", 39: "#,##0.00;(#,##0.00)", 40: "#,##0.00;(#,##0.00)" };
const isDateFormat = (code) => /[ymdegaｙｍｄ年月日]/i.test(code.replace(/"[^"]*"|\[[^\]]*\]|\\./g, "").replace(/General/gi, ""));

function serialToDate(n, code) {
  const d = new Date(Date.UTC(1899, 11, 30) + Math.round(n * 86400) * 1000);
  const [y, m, day] = [d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()];
  return /年/.test(code) ? `${y}年${m}月${day}日` : `${y}/${m}/${day}`;
}

function formatNumber(raw, fmt) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return raw;
  const v = Number(n.toPrecision(15)); // 0.1 + 0.2 のような小さな誤差を消す
  if (fmt.date) return serialToDate(v, fmt.code);
  const decimals = (fmt.code.match(/0\.(0+)/)?.[1].length) ?? null;
  if (/%/.test(fmt.code)) return `${(v * 100).toFixed(decimals ?? 0)}%`;
  // 書式の前後に書かれた文字（"¥"#,##0 の ¥、#,##0"円" の 円 など）も付ける
  const section = fmt.code.split(";")[0].replace(/\[\$([^\]-]*)[^\]]*\]/g, '"$1"').replace(/\[[^\]]*\]/g, "");
  const first = section.search(/[#0](?=(?:[^"]*"[^"]*")*[^"]*$)/);
  const literals = (part) => [...part.matchAll(/"([^"]*)"|\\(.)|([¥￥$円])/g)].map((m) => m[1] ?? m[2] ?? m[3]).join("");
  const [prefix, suffix] = first < 0 ? ["", ""] : [literals(section.slice(0, first)), literals(section.slice(section.lastIndexOf(section.match(/[#0](?=[^#0]*$)/)?.[0] ?? "0") + 1))];
  const grouped = /#,##0/.test(fmt.code);
  const body = grouped || decimals != null
    ? v.toLocaleString("ja-JP", { useGrouping: grouped, ...(decimals == null ? { maximumFractionDigits: 0 } : { minimumFractionDigits: decimals, maximumFractionDigits: decimals }) })
    : String(v);
  return `${prefix}${body}${suffix}`;
}

function sharedStrings(xml = "") {
  // 日本語のふりがな（rPh）は、セルに見えている文字ではないので外す
  return [...xml.matchAll(/<si>([\s\S]*?)<\/si>/g)].map(([, si]) =>
    [...si.replace(/<rPh\b[\s\S]*?<\/rPh>/g, "").matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map(([, t]) => decode(t)).join(""));
}

function cellFormats(xml = "") {
  const custom = Object.fromEntries([...xml.matchAll(/<numFmt\b[^>]*>/g)].map(([t]) => [attr(t, "numFmtId"), decode(attr(t, "formatCode") ?? "")]));
  const xfs = xml.match(/<cellXfs\b[\s\S]*?<\/cellXfs>/)?.[0] ?? "";
  return [...xfs.matchAll(/<xf\b[^>]*>/g)].map(([t]) => {
    const id = Number(attr(t, "numFmtId") ?? 0);
    const code = custom[id] ?? BUILTIN[id] ?? "General";
    return { code, date: custom[id] ? isDateFormat(code) : DATE_IDS.has(id) };
  });
}

const colIndex = (ref) => [...ref.replace(/\d+$/, "")].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0) - 1;

function sheetText(xml, strings, formats) {
  const rows = [];
  for (const [, rowXml] of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells = [];
    for (const [, open, body = ""] of rowXml.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const ref = attr(open, "r");
      const type = attr(open, "t");
      const fmt = formats[Number(attr(open, "s") ?? 0)] ?? { code: "General", date: false };
      const v = body.match(/<v>([\s\S]*?)<\/v>/)?.[1] || null;
      const formula = body.match(/<f\b[^>]*>([\s\S]*?)<\/f>/)?.[1];
      let text = "";
      if (type === "s") text = strings[Number(v)] ?? "";
      else if (type === "inlineStr") text = [...body.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map(([, t]) => decode(t)).join("");
      else if (type === "b") text = v === "1" ? "TRUE" : "FALSE";
      else if (type === "str" || type === "e") text = decode(v ?? "");
      else if (v != null) text = formatNumber(v, fmt);
      // 計算結果が保存されていない式（Excel 以外の道具で作ったファイルなど）は、式のまま見せる
      else if (formula) text = `（計算式 =${decode(formula)}、計算結果は保存されていません）`;
      if (text === "") continue;
      const i = ref ? colIndex(ref) : cells.length;
      cells[i] = text.replace(/\r?\n/g, " ");
    }
    if (cells.length) rows.push(Array.from(cells, (c) => c ?? "").join("\t").replace(/\t+$/, ""));
  }
  return rows.join("\n");
}

export function xlsxText(buffer) {
  const files = open(buffer, (n) => /^xl\/(workbook\.xml|_rels\/workbook\.xml\.rels|sharedStrings\.xml|styles\.xml|worksheets\/[^/]+\.xml)$/.test(n));
  if (!files["xl/workbook.xml"]) throw new Error("Excel の書類として読めませんでした。");
  const rels = Object.fromEntries([...(files["xl/_rels/workbook.xml.rels"] ?? "").matchAll(/<Relationship\b[^>]*>/g)]
    .map(([t]) => [attr(t, "Id"), attr(t, "Target")]));
  const strings = sharedStrings(files["xl/sharedStrings.xml"]);
  const formats = cellFormats(files["xl/styles.xml"]);
  const sheets = [...files["xl/workbook.xml"].matchAll(/<sheet\b[^>]*>/g)].map(([t]) => {
    const target = (rels[attr(t, "r:id")] ?? "").replace(/^\/?(xl\/)?/, "");
    const xml = files[`xl/${target}`];
    if (!xml) return null;
    const hidden = attr(t, "state") && attr(t, "state") !== "visible" ? "（非表示のシート）" : "";
    return `［シート：${decode(attr(t, "name") ?? "")}］${hidden}\n${sheetText(xml, strings, formats)}`;
  }).filter(Boolean);
  return sheets.join("\n\n");
}
