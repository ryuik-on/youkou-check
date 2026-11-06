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
} else if (cmd === "check" && file) {
  // node --env-file=.env cli.mjs check <要項> <リポジトリの場所> [GitHub の URL]
  const { check } = await import("./lib/check.mjs");
  const [, , repoPath, githubUrl] = process.argv.slice(2);
  const text = await readFile(file, "utf8");
  const started = Date.now();
  const r = await check({ rulesText: text, submission: { repoPath, githubUrl } }, (m) => console.error(`… ${m}`));
  console.log(`# ${r.title}（${((Date.now() - started) / 1000).toFixed(0)} 秒、約 $${r.cost.usd.toFixed(3)}）\n`);
  for (const it of r.items) {
    const v = it.verdict;
    console.log(`- ${it.id} 【${v.status}】${it.summary}\n    理由：${v.reason}${v.fix ? `\n    直し方：${v.fix}` : ""}`);
    for (const e of v.evidence) console.log(`    根拠（${e.source}${e.verified === false ? "・⚠照合できず" : ""}）：${e.text}`);
  }
} else {
  console.error("使い方：node --env-file=.env cli.mjs extract <要項のファイル>");
  process.exit(1);
}
