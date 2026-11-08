import { z } from "zod";
import { askJson } from "./claude.mjs";
import { findQuote } from "./quote.mjs";

export const STATUS = ["満たしている", "満たしていない", "判定できません", "本人が確かめる"];

const Verdict = z.object({
  id: z.string().describe("条件の id（R1 など）"),
  status: z.enum(STATUS),
  reason: z.string().describe("なぜそう判定したか。一、二文で"),
  evidence: z.array(z.object({
    source: z.enum(["提出書類", "README", "ファイル", "提出フォーム", "事実"]).describe("根拠をどこから取ったか"),
    file: z.string().nullable().describe("source が 提出書類 か ファイル のとき、その名前。それ以外は null"),
    text: z.string().describe("提出書類・README・ファイル・提出フォームなら、その文字列を一字一句そのまま。事実なら、使った事実の名前と値（例：repo.licenseName = null）"),
  })),
  fix: z.string().nullable().describe("満たしていない・判定できない場合に、応募者が何をすればよいか。満たしていれば null"),
});

const Judgement = z.object({ verdicts: z.array(Verdict) });

const SYSTEM = `あなたは、公募の要項から取り出した条件と、応募者の提出物を突き合わせる係です。最後に提出するかどうかを決めるのは応募者本人で、あなたの判定は本人が見直すための材料です。

判定の決まり：
- 満たしている：提出物の中に、条件を満たしていると言える根拠がある。
- 満たしていない：提出物の中に、条件に反する根拠がある、または、あるはずのものが無いことが事実から分かる（例：ファイル一覧に LICENSE が無い）。
- 判定できません：手元の材料からは、どちらとも言えない（例：動画の長さが分からない）。推測で「満たしている」にしてはいけません。
- 本人が確かめる：在籍・年齢・住所・他の大会への提出歴など、提出物を見ても分からず、本人しか知らないこと。

根拠の決まり：
- 提出書類・README・ファイル・提出フォームの文は、一字一句そのまま写します。表の数字は、書類に書かれている形のまま写します。
- 提出書類は、要項が求める書類がそろっているかも確かめます。求められているのに見当たらない書類は「満たしていない」とします。
- 金額・割合・日数は、自分で計算し直して確かめます。計算の式は reason に書きます。
- checkedAt は、この点検をした日時です。申請日が書類に書かれていればそれを使い、無ければ checkedAt を申請日とみなします。後でプログラムが照合し、一致しないものは「確かめられない」と表示されます。
- 「事実」は、渡された事実の JSON の中身だけを使います。JSON に無いことを事実として書いてはいけません。
- dateChecks は、プログラムが日時を比べた結果です。日時の条件は、これに従います。
- videoUrl は、ログインしていない状態で動画の URL を開いた結果です。審査員が見られるか（viewableWithoutLogin）、公開の状態（visibility）、長さ（seconds）の条件は、これに従います。動画で何を見せているか・何語で話しているかは分からないので、題名から推測せず「判定できません」とします。
- secrets は、プログラムが履歴まで調べて見つけた秘密の情報の場所です。一度コミットした鍵は、後で消しても履歴から読めるので、「満たしていない」とします。

すべての条件について、一つずつ判定を返します。`;

export async function judge({ requirements, facts, dates }) {
  const readme = facts.repo?.readme ?? null;
  const factsForModel = {
    ...facts,
    repo: facts.repo && { ...facts.repo, readme: undefined, contents: undefined },
    documents: facts.documents?.map(({ text, ...d }) => d),
    dateChecks: dates,
  };
  const { data, usage, model } = await askJson({
    system: SYSTEM,
    content: [
      { type: "text", text: `<条件>\n${JSON.stringify(requirements.map(({ id, summary, quote, checkBy, severity, deadline }) => ({ id, summary, quote, checkBy, severity, deadline })), null, 1)}\n</条件>` },
      { type: "text", text: `<事実>\n${JSON.stringify(factsForModel, null, 1)}\n</事実>` },
      ...(facts.documents ?? []).map((d) => ({ type: "text", text: `<提出書類 name="${d.name}">\n${d.text}\n</提出書類>` })),
      ...(facts.repo ? [{ type: "text", text: `<README>\n${readme ?? "（README がありません）"}\n</README>` }] : []),
      ...Object.entries(facts.repo?.contents ?? {}).map(([name, text]) => ({ type: "text", text: `<ファイル name="${name}">\n${text}\n</ファイル>` })),
      { type: "text", text: "条件ごとに判定してください。" },
    ],
    schema: Judgement,
  });

  const formText = Object.values(facts.form ?? {}).map((f) => f.text).join("\n");
  const verdicts = data.verdicts.map((v) => ({
    ...v,
    evidence: v.evidence.map((e) => ({
      ...e,
      verified:
        e.source === "提出書類" ? findQuote(facts.documents?.find((d) => d.name === e.file)?.text ?? "", e.text).found
        : e.source === "README" ? (readme ? findQuote(readme, e.text).found : false)
        : e.source === "ファイル" ? findQuote(facts.repo?.contents?.[e.file] ?? "", e.text).found
        : e.source === "提出フォーム" ? findQuote(formText, e.text).found
        : null, // 事実は Claude ではなくプログラムが出したもの。画面では事実の一覧と並べて見せる
    })),
  }));
  return { verdicts, usage, model };
}
