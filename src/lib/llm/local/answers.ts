import { readProfile, AnswerQuestionsInput, type QuestionAnswer } from "../types";
import { classifyQuestion, localCompose } from "./compose";
import { FactView } from "./factview";
import { fieldKey, pickOption, resolveField } from "./forms";

/*
 * answerQuestions for the local engine. Short factual questions (email, school, "are you
 * authorised to work…") are answered like form fields, from facts. Open questions go
 * through the composer (kind "answer"), so every sentence cites facts and anything only the
 * person can say becomes a gap: the draft is returned with `needsUser: true` and the gap
 * question as the reason (keep / edit / rewrite, plan §8.4).
 */

const LONG_TYPES = new Set(["long", "textarea", "essay", "paragraph"]);

export function localAnswerQuestions(raw: AnswerQuestionsInput): QuestionAnswer[] {
  const input = AnswerQuestionsInput.parse(raw);
  const zh = input.language === "zh";
  const profile = readProfile(input.profile);
  const view = new FactView(profile, input.facts);
  return input.questions.map((q) => {
    const own = input.answers[q.id];
    if (own) return { questionId: q.id, answer: own, factIds: [`answer:${q.id}`], confidence: 1, needsUser: false, reason: null };
    const field = { name: q.id, label: q.text, type: q.type === "choice" ? "select" : q.type ?? "text", options: q.options, required: q.required, placeholder: null };
    const key = fieldKey(field);
    if (key?.user) {
      return { questionId: q.id, answer: null, factIds: [], confidence: 1, needsUser: true, reason: zh ? "这个问题只能由你本人回答（同意、签名或自愿填写的个人信息）。" : "Only you can answer this (consent, signature or voluntary self-identification)." };
    }
    const long = LONG_TYPES.has(q.type ?? "") || (q.maxWords ?? 0) > 40 || (!key && q.text.length > 60);
    if (key && !long) {
      const r = resolveField(key.key, field, view, input.answers, [], input.language);
      let value = r.value;
      if (value !== null && q.options?.length) value = pickOption(q.options, value);
      if (value !== null) return { questionId: q.id, answer: value, factIds: r.ids, confidence: r.confidence, needsUser: false, reason: null };
      if (!["why_this", "proud_project", "about_you", "traction", "problem", "use_of_funds", "research_interest"].includes(key.key)) {
        return { questionId: q.id, answer: null, factIds: [], confidence: 0, needsUser: true, reason: zh ? "档案里没有这项信息，请补充一次，之后不会再问。" : "Your profile doesn't have this yet; answer once and we'll remember it." };
      }
    }
    const questionKey = classifyQuestion(q.text);
    const doc = localCompose({
      kind: "answer",
      profile,
      facts: input.facts,
      opportunity: input.opportunity ?? null,
      answers: input.answers,
      language: input.language,
      question: q.text,
      questionKey,
      maxWords: q.maxWords,
    });
    const body = doc.blocks.filter((b) => b.role === "body");
    const text = body.map((b) => b.text).join(zh ? "" : "\n\n").trim();
    const gaps = doc.gaps;
    const blocking = gaps.filter((g) => g.key !== "proud_why");
    return {
      questionId: q.id,
      answer: text || null,
      factIds: doc.factIds,
      confidence: text ? (blocking.length ? 0.45 : 0.75) : 0,
      needsUser: !text || blocking.length > 0,
      reason: blocking.length ? blocking.map((g) => g.question).join(" ") : !text ? (zh ? "需要你本人回答。" : "Needs your own answer.") : null,
    };
  });
}
