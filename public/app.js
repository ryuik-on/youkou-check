const $ = (id) => document.getElementById(id);
const ORDER = ["満たしていない", "判定できません", "本人が確かめる", "満たしている"];
let current = null;
let filter = null;

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

$("example").addEventListener("click", async () => {
  const r = await fetch("/api/example").then((r) => r.json());
  $("rules").value = r.rulesText;
  $("repoPath").value = r.repoPath;
  $("github").value = "";
  $("overview").value = r.form.overview;
  $("email").value = r.form.email;
  $("video").value = r.videoSecondsInput;
});

$("form").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const status = $("status");
  status.hidden = false;
  status.className = "status";
  $("result").hidden = true;
  $("go").disabled = true;
  const started = Date.now();
  const tick = setInterval(() => {
    status.dataset.elapsed = `${Math.round((Date.now() - started) / 1000)} 秒`;
    status.querySelector(".elapsed") && (status.querySelector(".elapsed").textContent = status.dataset.elapsed);
  }, 1000);
  status.innerHTML = `準備しています… <span class="elapsed"></span>`;

  const body = {
    rulesText: $("rules").value,
    submission: {
      githubUrl: $("github").value.trim() || undefined,
      repoPath: $("repoPath").value.trim() || undefined,
      videoSecondsInput: $("video").value ? Number($("video").value) : undefined,
      form: { 作品の概要: $("overview").value, 連絡先: $("email").value },
    },
  };

  try {
    const res = await fetch("/api/check", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let nl;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const msg = JSON.parse(buf.slice(0, nl));
        buf = buf.slice(nl + 1);
        if (msg.progress) status.innerHTML = `${esc(msg.progress)}… <span class="elapsed">${status.dataset.elapsed ?? ""}</span>`;
        if (msg.error) throw new Error(msg.error);
        if (msg.result) {
          current = msg.result;
          current.elapsed = Math.round((Date.now() - started) / 1000);
          filter = null;
          render();
          status.hidden = true;
        }
      }
    }
  } catch (e) {
    status.className = "status error";
    status.textContent = `うまくいきませんでした：${e.message}`;
  } finally {
    clearInterval(tick);
    $("go").disabled = false;
  }
});

function quoteBlock(text, verified, label) {
  const mark = verified === true ? `<div class="verify ok">✓ ${label}にそのまま含まれていることを確かめました</div>`
    : verified === false ? `<div class="verify bad">⚠ ${label}の中に見つかりません。言い換えの可能性があるので、原文を確かめてください</div>` : "";
  return `<blockquote>${esc(text)}</blockquote>${mark}`;
}

function evidenceList(evs) {
  if (!evs.length) return `<p class="src">根拠になるものは見つかりませんでした。</p>`;
  return `<ul class="evidence">${evs.map((e) => {
    const where = e.source === "ファイル" ? `ファイル ${esc(e.file)}` : e.source === "事実" ? "プログラムで調べた事実" : esc(e.source);
    const mark = e.verified === true ? `<span class="verify ok">✓ 照合済み</span>` : e.verified === false ? `<span class="verify bad">⚠ 原文に見つかりません</span>` : "";
    return `<li><span class="src">${where}</span> ${mark}<br>${e.source === "事実" ? `<code>${esc(e.text)}</code>` : `「${esc(e.text)}」`}</li>`;
  }).join("")}</ul>`;
}

function render() {
  const r = current;
  const counts = Object.fromEntries(ORDER.map((s) => [s, r.items.filter((i) => i.verdict.status === s).length]));
  const items = [...r.items]
    .sort((a, b) => ORDER.indexOf(a.verdict.status) - ORDER.indexOf(b.verdict.status))
    .filter((i) => !filter || i.verdict.status === filter);

  $("result").hidden = false;
  $("result").innerHTML = `
    <h2>${esc(r.title)}：${r.items.length} 件の条件</h2>
    <div class="summary">${ORDER.map((s) => `<button class="count ${filter === s ? "active" : ""}" data-filter="${s}"><b>${counts[s]}</b>${s}</button>`).join("")}</div>
    <p class="meta">${r.cost.model} ／ ${current.elapsed} 秒 ／ API の料金の目安 $${r.cost.usd.toFixed(2)}${r.submissionDeadline ? ` ／ 締切 ${new Date(r.submissionDeadline).toLocaleString("ja-JP")}` : ""}</p>
    <div class="reminder">これは見直しのための材料です。Claude の判定は間違えることがあります。それぞれの条件を自分の目で確かめたら、「確かめた」に印を付けてください。</div>
    ${items.map((it, n) => `
      <article class="item" data-status="${it.verdict.status}" id="item-${it.id}">
        <div class="item-head">
          <span class="badge ${it.verdict.status}">${it.verdict.status}</span>
          <span class="sev ${it.severity === "失格・対象外" ? "失格" : ""}">守らないと：${esc(it.severity)}</span>
          <span class="sev">${esc(it.category)}</span>
          <h3>${esc(it.id)}　${esc(it.summary)}</h3>
        </div>
        <div class="cols">
          <div><p class="col-title">要項には</p>${quoteBlock(it.quote, it.quoteFound, "要項")}</div>
          <div><p class="col-title">提出物では</p>${evidenceList(it.verdict.evidence)}</div>
        </div>
        <p class="reason">${esc(it.verdict.reason)}</p>
        ${it.verdict.fix ? `<p class="fix"><b>すること：</b>${esc(it.verdict.fix)}</p>` : ""}
        <label class="confirm"><input type="checkbox" data-confirm="${it.id}" ${it.confirmed ? "checked" : ""}> 自分で確かめた</label>
      </article>`).join("")}
    ${r.ambiguities.length ? `<h2>主催者に聞いた方がよいこと</h2><p class="meta">要項の書き方があいまいで、どちらとも読めるところです。</p><ul class="ambiguities">${r.ambiguities.map((a) => `<li>${esc(a)}</li>`).join("")}</ul>` : ""}
    <div class="actions">
      <button class="ghost" id="copy">確かめることの一覧をコピー（Markdown）</button>
    </div>`;

  document.querySelectorAll("[data-filter]").forEach((b) => b.addEventListener("click", () => {
    filter = filter === b.dataset.filter ? null : b.dataset.filter;
    render();
  }));
  document.querySelectorAll("[data-confirm]").forEach((c) => c.addEventListener("change", () => {
    const it = current.items.find((i) => i.id === c.dataset.confirm);
    it.confirmed = c.checked;
    c.closest(".item").classList.toggle("done", c.checked);
  }));
  document.querySelectorAll(".item").forEach((el) => {
    const it = current.items.find((i) => `item-${i.id}` === el.id);
    el.classList.toggle("done", !!it.confirmed);
  });
  $("copy").addEventListener("click", async () => {
    await navigator.clipboard.writeText(toMarkdown());
    $("copy").textContent = "コピーしました";
  });
}

function toMarkdown() {
  const r = current;
  const lines = [`# ${r.title}：提出前に確かめること`, ""];
  for (const s of ORDER.slice(0, 3)) {
    const its = r.items.filter((i) => i.verdict.status === s);
    if (!its.length) continue;
    lines.push(`## ${s}`, "");
    for (const it of its) lines.push(`- [${it.confirmed ? "x" : " "}] ${it.id} ${it.summary}${it.verdict.fix ? `\n  - ${it.verdict.fix}` : ""}\n  - 要項：「${it.quote}」`);
    lines.push("");
  }
  return lines.join("\n");
}
