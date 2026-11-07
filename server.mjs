// 手元だけで動くサーバー。127.0.0.1 でしか待ち受けない。
import http from "node:http";
import { readFile, writeFile, mkdir, mkdtemp, rm, access } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { check } from "./lib/check.mjs";
import { documentFromFile } from "./lib/pdf.mjs";

const run = promisify(execFile);
const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 3939);
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8" };

if (!process.env.ANTHROPIC_API_KEY) {
  console.error("ANTHROPIC_API_KEY がありません。.env.example を .env に写して、API キーを書いてください。");
  process.exit(1);
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > 40 * 1024 * 1024) throw new Error("送られてきた内容が大きすぎます（全部で 30MB ほどまで）。");
    chunks.push(c);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

// 見本の提出リポジトリを、一時フォルダに作る
async function sampleRepo() {
  const dir = path.join(os.tmpdir(), "youkou-check-sample-submission");
  await run("sh", [path.join(ROOT, "examples/make-sample-repo.sh"), dir]);
  return dir;
}

// GitHub の URL だけが渡されたときは、一時フォルダに複製して調べる
async function cloneIfNeeded(submission) {
  if (submission.repoPath || !submission.githubUrl) return null;
  if (!/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/?$/.test(submission.githubUrl.trim())) {
    throw new Error("GitHub の URL は https://github.com/持ち主/リポジトリ名 の形で入れてください。");
  }
  const dir = await mkdtemp(path.join(os.tmpdir(), "youkou-check-"));
  await run("git", ["clone", "--quiet", submission.githubUrl.trim().replace(/\/$/, ""), dir], {
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    timeout: 120_000,
  });
  submission.repoPath = dir;
  return dir;
}

const server = http.createServer(async (req, res) => {
  try {
    // 手元の画面からの依頼だけを受け付ける（よそのサイトから、名前を付け替えて送られてくる依頼を断る）
    if (![`127.0.0.1:${PORT}`, `localhost:${PORT}`].includes(req.headers.host ?? "")) {
      res.writeHead(403).end();
      return;
    }
    if (req.method === "POST" && !(req.headers["content-type"] ?? "").startsWith("application/json")) {
      res.writeHead(415).end();
      return;
    }
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (req.method === "GET" && url.pathname === "/api/example" && url.searchParams.get("name") === "hojokin") {
      const dir = path.join(ROOT, "examples/hojokin/pdf");
      const load = async (f) => documentFromFile(f, await readFile(path.join(dir, f)));
      const names = ["shinsei.pdf", "keikaku.pdf", "keihi.pdf", "mitsumori.pdf", "kakutei.pdf"];
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ rulesText: (await load("youryou.pdf")).text, documents: await Promise.all(names.map(load)) }));
      return;
    }

    // 選んだファイル（PDF・テキスト）を文字にして返す。画面で中身を確かめられるように、ここで一度返す
    if (req.method === "POST" && url.pathname === "/api/document") {
      const body = await readBody(req);
      if (typeof body.name !== "string" || typeof body.data !== "string") throw new Error("ファイルが読めませんでした。");
      if (!/\.(pdf|txt|md|csv)$/i.test(body.name)) throw new Error("読めるのは PDF・テキスト（.txt .md .csv）のファイルです。");
      const doc = await documentFromFile(path.basename(body.name), Buffer.from(body.data, "base64"));
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify(doc));
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/example") {
      const rulesText = await readFile(path.join(ROOT, "examples/yanbaru-hackathon-2026.md"), "utf8");
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({
        rulesText,
        repoPath: await sampleRepo(),
        form: { overview: "やんばる地域のバスの、次の便が分かるアプリです。バスの本数が少ない地域で、待ち時間を短くするために作りました。", email: "" },
        videoSecondsInput: 150,
      }));
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/last") {
      const data = await readFile(path.join(ROOT, "results/last.json")).catch(() => null);
      res.writeHead(data ? 200 : 404, { "Content-Type": "application/json; charset=utf-8" });
      res.end(data ?? JSON.stringify({ error: "まだ結果がありません。" }));
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/check") {
      const body = await readBody(req);
      if (!body.rulesText?.trim()) throw new Error("要項の文章を入れてください。");
      const submission = body.submission ?? {};
      submission.documents = (Array.isArray(submission.documents) ? submission.documents : [])
        .filter((d) => typeof d?.name === "string" && typeof d?.text === "string")
        .map((d) => ({ name: d.name, pages: Number.isInteger(d.pages) ? d.pages : null, text: d.text }));
      if (submission.repoPath) await access(submission.repoPath).catch(() => { throw new Error(`フォルダが見つかりません：${submission.repoPath}`); });

      // 途中経過を1行ずつ送り、最後に結果を送る
      res.writeHead(200, { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" });
      const send = (o) => res.write(JSON.stringify(o) + "\n");
      let cloned = null;
      try {
        if (submission.githubUrl && !submission.repoPath) send({ progress: "GitHub からリポジトリを複製しています" });
        cloned = await cloneIfNeeded(submission);
        const result = await check({ rulesText: body.rulesText, submission }, (m) => send({ progress: m }));
        send({ result });
        // 直前の結果を手元に残す（results/ は公開リポジトリに入らない）
        await mkdir(path.join(ROOT, "results"), { recursive: true });
        await writeFile(path.join(ROOT, "results/last.json"), JSON.stringify(result));
      } catch (e) {
        send({ error: e.message });
      } finally {
        if (cloned) await rm(cloned, { recursive: true, force: true });
        res.end();
      }
      return;
    }

    if (req.method === "GET") {
      const file = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
      if (!/^[\w.-]+$/.test(file)) { res.writeHead(404).end(); return; }
      const data = await readFile(path.join(ROOT, "public", file)).catch(() => null);
      if (!data) { res.writeHead(404).end(); return; }
      res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] ?? "application/octet-stream" });
      res.end(data);
      return;
    }

    res.writeHead(405).end();
  } catch (e) {
    if (!res.headersSent) res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: e.message }));
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`youkou-check を開きました：http://127.0.0.1:${PORT}`);
});
