import { z } from "zod";
import { askJson } from "./claude.mjs";
import { findQuote } from "./quote.mjs";

export const CHECK_BY = ["リポジトリ", "README", "動画", "提出フォーム", "日時", "本人"];

const Requirement = z.object({
  id: z.string().describe("R1, R2, … の通し番号"),
  category: z.enum(["期限", "参加資格", "作品の条件", "提出物", "形式", "禁止事項", "その他"]),
  summary: z.string().describe("条件を一文で。応募者が何をすればよいかが分かる言い方で"),
  quote: z.string().describe("根拠になる要項の文。要項の文字列を一字一句そのまま、短く抜き出す"),
  checkBy: z.enum(CHECK_BY).describe("何を見れば確かめられるか"),
  severity: z.enum(["失格・対象外", "減点・不利", "お願い"]).describe("満たさないとどうなると要項に書いてあるか。書いていなければ お願い"),
  deadline: z.string().nullable().describe("日時の条件なら ISO 8601（タイムゾーンつき）。それ以外は null"),
});

const Extraction = z.object({
  title: z.string().describe("公募の名前"),
  developmentStart: z.string().nullable().describe("開発期間・作品を作り始めてよい日時の始まり（ISO 8601、タイムゾーンつき）。書かれていなければ null"),
  submissionDeadline: z.string().nullable().describe("提出締切（ISO 8601、タイムゾーンつき）。書かれていなければ null"),
  requirements: z.array(Requirement),
  ambiguities: z.array(z.string()).describe("要項の書き方があいまいで、主催者に確かめた方がよい点"),
});

const SYSTEM = `あなたは、公募（ハッカソン・奨学金・補助金・コンテスト）の要項を読み、応募者が守るべき条件を漏れなく取り出す係です。

- 応募者が守らないといけないこと、出さないといけないもの、期限、資格、禁止されていることを、一つずつ別の条件として取り出します。「Aと B を出す」なら A と B は別の条件にします。
- 審査の配点や開催の案内のように、応募者の行動を求めていない文は条件にしません。
- quote には、要項の文字列を一字一句そのまま写します。言い換え・要約・補足をしてはいけません。後でプログラムが原文と照合し、一致しない引用は「確かめられない」と表示されます。
- 要項に書かれていない条件を、常識や推測で足してはいけません。
- 書き方があいまいな点（例：「2分以内」が提出物全体か動画だけか）は ambiguities に書きます。`;

export async function extractRequirements(rulesText) {
  const { data, usage, model } = await askJson({
    system: SYSTEM,
    content: [
      { type: "text", text: `<要項>\n${rulesText}\n</要項>`, cache_control: { type: "ephemeral" } },
      { type: "text", text: "この要項から、応募者が守るべき条件をすべて取り出してください。" },
    ],
    schema: Extraction,
  });
  const requirements = data.requirements.map((r) => ({
    ...r,
    quoteFound: findQuote(rulesText, r.quote).found,
  }));
  return { ...data, requirements, usage, model };
}
