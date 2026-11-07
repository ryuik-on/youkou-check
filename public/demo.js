// デモ動画を録るための字幕。URL に ?demo を付けたときだけ読み込む。
// → で次の字幕、← で前の字幕、. で字幕を隠す／出す
const captions = await fetch("demo-captions.json").then((r) => r.json());
let i = 0;
const bar = document.createElement("div");
bar.className = "demo-caption";
document.body.append(bar);
const show = () => {
  bar.innerHTML = captions[i].replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/\n/g, "<br>");
  bar.hidden = !captions[i];
};
document.addEventListener("keydown", (ev) => {
  if (ev.target.closest("input, textarea")) return;
  if (ev.key === "ArrowRight") i = Math.min(i + 1, captions.length - 1);
  else if (ev.key === "ArrowLeft") i = Math.max(i - 1, 0);
  else if (ev.key === ".") { bar.classList.toggle("off"); return; }
  else return;
  ev.preventDefault();
  show();
});
show();
