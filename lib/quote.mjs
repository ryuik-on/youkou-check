// Claude が返した引用が、元の文章にそのまま含まれているかを確かめる。
// 空白・改行・全角半角のゆれだけは同じものとして扱い、言い換えは認めない。

function normalize(s) {
  return s
    .normalize("NFKC")
    .replace(/[\s　\u0000-\u001F]+/g, "")
    .replace(/[*_`#>|]/g, ""); // Markdown の記号は引用の邪魔になるので外す
}

export function findQuote(source, quote) {
  if (!quote || !quote.trim()) return { found: false };
  const src = normalize(source);
  const q = normalize(quote);
  if (q.length === 0) return { found: false };
  return { found: src.includes(q) };
}
