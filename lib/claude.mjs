import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";

export const MODEL = "claude-opus-5-5";

const client = new Anthropic();

// 構造化出力で JSON を返させる。安全上の理由で断られた場合は、
// 同じ依頼を別のモデルで続けてもらう（fallbacks: "default"）。
export async function askJson({ system, content, schema, effort = "high" }) {
  const stream = client.beta.messages.stream({
    model: MODEL,
    max_tokens: 64000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    thinking: { type: "adaptive" },
    output_config: { effort, format: zodOutputFormat(schema) },
    system,
    messages: [{ role: "user", content }],
  });
  const message = await stream.finalMessage();
  if (message.stop_reason === "refusal") {
    throw new Error("Claude がこの依頼を断りました。要項の文章を確かめてください。");
  }
  if (message.stop_reason === "max_tokens") {
    throw new Error("返答が長すぎて途中で切れました。");
  }
  const text = message.content.filter((b) => b.type === "text").map((b) => b.text).join("");
  const parsed = schema.parse(JSON.parse(text));
  return { data: parsed, usage: message.usage, model: message.model };
}

// 100万トークンあたりの料金（ドル）。Opus 5.5：入力 $4、出力 $20、キャッシュ読み取り $0.20
export function costUsd(usage) {
  const input = (usage.input_tokens ?? 0) * 4;
  const cacheRead = (usage.cache_read_input_tokens ?? 0) * 0.2;
  const cacheWrite = (usage.cache_creation_input_tokens ?? 0) * 5;
  const output = (usage.output_tokens ?? 0) * 20;
  return (input + cacheRead + cacheWrite + output) / 1e6;
}
