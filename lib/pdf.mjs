// PDF から文字を取り出す。引用の照合は、この文字に対して行う
import { extractText, getDocumentProxy } from "unpdf";

// PDF によっては「月」が部首の「⽉」のような、見た目が同じ別の文字で入っている。普通の漢字に戻す
const RADICALS = /[⺀-⻿⼀-⿟]/g;
// 部首の補助ブロック（U+2E80〜）は NFKC で戻らないものが多いので、日本語の書類によく出るものを表で戻す
const SUPPLEMENT = { "⻑": "長", "⻘": "青", "⻄": "西", "⻝": "食", "⻩": "黄", "⻤": "鬼", "⻲": "亀", "⻭": "歯", "⻯": "竜", "⻨": "麦", "⻆": "角" };
export const fixRadicals = (s) => s.replace(RADICALS, (c) => SUPPLEMENT[c] ?? c.normalize("NFKC"));
// Chrome などで作った PDF は、空白が制御文字（U+0001 など）で入っていることがある
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g;

export async function pdfText(buffer) {
  const pdf = await getDocumentProxy(new Uint8Array(buffer));
  const { totalPages, text } = await extractText(pdf, { mergePages: false });
  const joined = text.map((t, i) => `［${i + 1}ページ］\n${t}`).join("\n\n");
  return { pages: totalPages, text: fixRadicals(joined).replace(CONTROL, " ") };
}

// ファイルを、Claude に渡す文字にする。PDF 以外は文字のファイルとして読む
export async function documentFromFile(name, buffer) {
  if (/\.pdf$/i.test(name)) return { name, ...(await pdfText(buffer)) };
  return { name, pages: null, text: buffer.toString("utf8") };
}
