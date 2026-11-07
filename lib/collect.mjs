// 提出物から、プログラムで確かめられる事実を集める。Claude は使わない。
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { stat } from "node:fs/promises";

const run = promisify(execFile);
// 調べるリポジトリは他人のものかもしれない。リポジトリの設定から外部のコマンドが動かないようにする
const SAFE = ["-c", "core.fsmonitor=false", "-c", "core.hooksPath=/dev/null", "-c", "diff.external=", "-c", "core.pager=cat"];
const git = (repo, ...args) => run("git", [...SAFE, "-C", repo, ...args], { maxBuffer: 64 * 1024 * 1024, env: { ...process.env, GIT_PAGER: "cat", GIT_EXTERNAL_DIFF: "" } }).then((r) => r.stdout);
// ファイルは作業フォルダではなく Git の記録から読む（リンクの先を読まないため）
const show = (repo, f) => git(repo, "show", `HEAD:${f}`).catch(() => null);

// 秘密の情報によくある形。見つけた場所だけを返し、値そのものは返さない。
const SECRET_PATTERNS = [
  ["Anthropic の API キー", /sk-ant-[A-Za-z0-9_-]{20,}/],
  ["OpenAI の API キー", /sk-(?:proj-)?[A-Za-z0-9]{20,}/],
  ["GitHub のトークン", /gh[pousr]_[A-Za-z0-9]{30,}/],
  ["AWS のアクセスキー", /AKIA[0-9A-Z]{16}/],
  ["Google の API キー", /AIza[0-9A-Za-z_-]{35}/],
  ["秘密鍵", /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
];
// Claude に送る前に、鍵らしい文字列を伏せる
const redact = (text) => SECRET_PATTERNS.reduce((t, [kind, re]) => t.replace(new RegExp(re.source, "g"), `［${kind}を伏せました］`), text);
const TEXT_FILE = /\.(m?[jt]sx?|py|rb|go|rs|java|kt|swift|c|cc|cpp|h|cs|php|html?|css|vue|svelte|md|txt|json|ya?ml|toml|sh|sql)$/i;
const SECRET_FILES = /(^|\/)(\.env(\.(?!(example|sample|template)$).+)?|id_rsa|id_ed25519|.*\.pem|credentials\.json)$/;

async function collectRepo(repo) {
  // ls-files -s の 120000 はリンク、160000 は別のリポジトリ。どちらも中身を読まない
  const staged = (await git(repo, "ls-files", "-s")).split("\n").filter(Boolean).map((l) => {
    const [meta, name] = l.split("\t");
    return { mode: meta.split(" ")[0], name };
  });
  const files = staged.map((e) => e.name);
  const readable = new Set(staged.filter((e) => e.mode === "100644" || e.mode === "100755").map((e) => e.name));
  const log = (await git(repo, "log", "--format=%H%x09%aI%x09%cI%x09%s")).split("\n").filter(Boolean);
  const commits = log.map((l) => {
    const [hash, authored, committed, subject] = l.split("\t");
    return { hash: hash.slice(0, 7), authored, committed, subject };
  }).reverse();

  const readmeName = files.find((f) => /^readme(\.md)?$/i.test(f));
  const readme = readmeName && readable.has(readmeName) ? redact((await show(repo, readmeName)) ?? "") : null;
  const licenseName = files.find((f) => /^(license|licence|copying)(\.(md|txt))?$/i.test(f));

  // 今のファイルだけでなく、履歴の全部を調べる（一度入れた鍵は、消しても履歴から読める）
  const secrets = [];
  for (const f of files.filter((f) => SECRET_FILES.test(f))) secrets.push({ kind: "鍵のファイル", where: f, inHistoryOnly: false });
  const history = await git(repo, "log", "-p", "--all", "--no-ext-diff", "--no-textconv", "--format=@@commit %h");
  let current = null;
  for (const line of history.split("\n")) {
    if (line.startsWith("@@commit ")) { current = line.slice(9); continue; }
    if (!line.startsWith("+") || line.startsWith("+++")) continue;
    for (const [kind, re] of SECRET_PATTERNS) {
      if (re.test(line) && !secrets.some((s) => s.kind === kind && s.where === `コミット ${current}`)) {
        secrets.push({ kind, where: `コミット ${current}` });
      }
    }
  }
  const deletedSecretFiles = (await git(repo, "log", "--all", "--diff-filter=D", "--name-only", "--format=")).split("\n").filter((f) => f && SECRET_FILES.test(f));
  for (const f of new Set(deletedSecretFiles)) secrets.push({ kind: "鍵のファイル（削除済み、履歴に残っている）", where: f });

  // 中身を読む文字のファイル（大きすぎるもの・鍵のファイルは読まない）
  const contents = {};
  let budget = 200_000;
  for (const f of files) {
    if (f === readmeName || !readable.has(f) || SECRET_FILES.test(f) || !TEXT_FILE.test(f)) continue;
    const text = await show(repo, f);
    if (text == null || text.length > budget) continue;
    contents[f] = redact(text);
    budget -= text.length;
  }

  return { files, commits, readmeName, readme, licenseName, secrets, contents };
}

async function collectGitHub(url) {
  const m = url?.match(/github\.com\/([^/]+)\/([^/#?]+?)(?:\.git)?(?:[/#?]|$)/);
  if (!m) return null;
  const res = await fetch(`https://api.github.com/repos/${m[1]}/${m[2]}`, { headers: { "User-Agent": "youkou-check" } });
  if (res.status === 404) return { url, reachable: false, note: "ログインしていない人からは見えません（非公開か、URL の誤り）" };
  if (!res.ok) return { url, reachable: null, note: `GitHub から状態を読めませんでした（${res.status}）` };
  const j = await res.json();
  return { url, reachable: true, visibility: j.visibility, createdAt: j.created_at, pushedAt: j.pushed_at, defaultBranch: j.default_branch };
}

// macOS の Spotlight から動画の長さを読む
async function videoSeconds(file) {
  try {
    await stat(file);
    const { stdout } = await run("mdls", ["-raw", "-name", "kMDItemDurationSeconds", file]);
    const n = Number(stdout.trim());
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

export async function collect({ repoPath, githubUrl, videoFile, videoSecondsInput, form, documents }) {
  // 「申請日の前3か月以内」のような条件のために、調べた日時を事実として渡す
  const facts = { checkedAt: new Date().toLocaleString("sv-SE", { timeZone: "Asia/Tokyo" }).replace(" ", "T") + "+09:00" };
  if (documents?.length) {
    facts.documents = documents.map((d) => ({ name: d.name, pages: d.pages ?? null, chars: [...d.text.replace(/\s/g, "")].length, text: redact(d.text) }));
  }
  if (repoPath) facts.repo = await collectRepo(repoPath);
  if (githubUrl) facts.github = await collectGitHub(githubUrl);
  const secs = videoFile ? await videoSeconds(videoFile) : videoSecondsInput ?? null;
  if (secs != null) facts.video = { seconds: Math.round(secs), source: videoFile ? "動画ファイルから読んだ長さ" : "入力された長さ" };
  if (form) {
    facts.form = Object.fromEntries(
      Object.entries(form).filter(([, v]) => v?.trim()).map(([k, v]) => [k, { text: v, chars: [...v.replace(/\s/g, "")].length }]),
    );
  }
  return facts;
}

// 日時の条件は、Claude に任せずプログラムで比べる
export function dateChecks(facts, { developmentStart, submissionDeadline }) {
  const out = {};
  const commits = facts.repo?.commits ?? [];
  if (developmentStart && commits.length) {
    const start = new Date(developmentStart);
    out.commitsBeforeStart = commits.filter((c) => new Date(c.authored) < start);
  }
  if (submissionDeadline && commits.length) {
    const end = new Date(submissionDeadline);
    out.commitsAfterDeadline = commits.filter((c) => new Date(c.committed) > end);
  }
  return out;
}
