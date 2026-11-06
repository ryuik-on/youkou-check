// 手元で試すためのコマンド。使い方：node --env-file=.env cli.mjs extract <要項のファイル>
import { readFile } from "node:fs/promises";
import { extractRequirements } from "./lib/extract.mjs";
import { costUsd } from "./lib/claude.mjs";

const [cmd, file] = process.argv.slice(2);

if (cmd === "extract" && file) {
  const text = await readFile(file, "utf8");
  const started = Date.now();
  const r = await extractRequirements(text);
  console.log(`# ${r.title}（${r.requirements.length} 件、${((Date.now() - started) / 1000).toFixed(0)} 秒、約 $${costUsd(r.usage).toFixed(3)}、${r.model}）\n`);
  for (const q of r.requirements) {
    const mark = q.quoteFound ? "" : " ⚠引用が原文に見つかりません";
    console.log(`- ${q.id} [${q.category}/${q.severity}/${q.checkBy}] ${q.summary}${q.deadline ? `（${q.deadline}）` : ""}\n    「${q.quote}」${mark}`);
  }
  if (r.ambiguities.length) console.log(`\n## あいまいな点\n${r.ambiguities.map((a) => `- ${a}`).join("\n")}`);
} else {
  console.error("使い方：node --env-file=.env cli.mjs extract <要項のファイル>");
  process.exit(1);
}
