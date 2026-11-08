// 手元で試すためのコマンド
//   node --env-file=.env cli.mjs extract <要項>
//   node --env-file=.env cli.mjs check <要項> [提出物 …]
// 要項は PDF・テキストのどちらでもよい。提出物には、フォルダ（Git のリポジトリ）、GitHub の URL、YouTube の URL、書類（PDF・Word・Excel・テキスト）を並べられる
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { extractRequirements } from "./lib/extract.mjs";
import { costUsd } from "./lib/claude.mjs";
import { documentFromFile } from "./lib/pdf.mjs";

const [cmd, file, ...rest] = process.argv.slice(2);
const readRules = async (f) => (await documentFromFile(f, await readFile(f))).text;

if (cmd === "extract" && file) {
  const text = await readRules(file);
  const started = Date.now();
  const r = await extractRequirements(text);
  console.log(`# ${r.title}（${r.requirements.length} 件、${((Date.now() - started) / 1000).toFixed(0)} 秒、約 $${costUsd(r.usage).toFixed(3)}、${r.model}）\n`);
  for (const q of r.requirements) {
    const mark = q.quoteFound ? "" : " ⚠引用が原文に見つかりません";
    console.log(`- ${q.id} [${q.category}/${q.severity}/${q.checkBy}] ${q.summary}${q.deadline ? `（${q.deadline}）` : ""}\n    「${q.quote}」${mark}`);
  }
  if (r.ambiguities.length) console.log(`\n## あいまいな点\n${r.ambiguities.map((a) => `- ${a}`).join("\n")}`);
} else if (cmd === "check" && file) {
  const { check } = await import("./lib/check.mjs");
  const submission = { documents: [] };
  for (const a of rest) {
    if (/^https:\/\/github\.com\//.test(a)) submission.githubUrl = a;
    else if (/^https:\/\/(www\.|m\.)?(youtube\.com|youtu\.be)\//.test(a)) submission.videoUrl = a;
    else if ((await stat(a)).isDirectory()) submission.repoPath = a;
    else submission.documents.push(await documentFromFile(path.basename(a), await readFile(a)));
  }
  const text = await readRules(file);
  const started = Date.now();
  const r = await check({ rulesText: text, submission }, (m) => console.error(`… ${m}`));
  console.log(`# ${r.title}（${((Date.now() - started) / 1000).toFixed(0)} 秒、約 $${r.cost.usd.toFixed(3)}）\n`);
  for (const it of r.items) {
    const v = it.verdict;
    console.log(`- ${it.id} 【${v.status}】${it.summary}${it.quoteFound ? "" : " ⚠要項の引用を照合できず"}\n    理由：${v.reason}${v.fix ? `\n    直し方：${v.fix}` : ""}`);
    for (const e of v.evidence) console.log(`    根拠（${e.source}${e.file ? ` ${e.file}` : ""}${e.verified === false ? "・⚠照合できず" : ""}）：${e.text}`);
  }
  if (r.ambiguities.length) console.log(`\n## あいまいな点\n${r.ambiguities.map((a) => `- ${a}`).join("\n")}`);
} else {
  console.error("使い方：node --env-file=.env cli.mjs extract <要項>\n　　　　node --env-file=.env cli.mjs check <要項> [フォルダ・GitHub の URL・YouTube の URL・書類 …]");
  process.exit(1);
}
