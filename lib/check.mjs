// 要項と提出物を受け取り、条件の取り出し → 事実の収集 → 突き合わせ を順に行う
import { extractRequirements } from "./extract.mjs";
import { collect, dateChecks } from "./collect.mjs";
import { judge } from "./judge.mjs";
import { costUsd } from "./claude.mjs";

export async function check({ rulesText, submission }, onProgress = () => {}) {
  onProgress("要項から条件を取り出しています（Claude）");
  const [extraction, facts] = await Promise.all([
    extractRequirements(rulesText),
    collect(submission),
  ]);
  const dates = dateChecks(facts, extraction);

  onProgress(`${extraction.requirements.length} 件の条件を、提出物と突き合わせています（Claude）`);
  const judgement = await judge({ requirements: extraction.requirements, facts, dates });

  const byId = new Map(judgement.verdicts.map((v) => [v.id, v]));
  const items = extraction.requirements.map((r) => ({
    ...r,
    verdict: byId.get(r.id) ?? { status: "判定できません", reason: "Claude がこの条件の判定を返しませんでした。", evidence: [], fix: null },
  }));

  return {
    title: extraction.title,
    developmentStart: extraction.developmentStart,
    submissionDeadline: extraction.submissionDeadline,
    ambiguities: extraction.ambiguities,
    items,
    facts: { ...facts, repo: facts.repo && { ...facts.repo, readme: undefined, contents: undefined } },
    dates,
    cost: { usd: costUsd(extraction.usage) + costUsd(judgement.usage), model: judgement.model },
  };
}
