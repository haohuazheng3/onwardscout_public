import type { IdentityCode, Profile } from "@/lib/core/types";
import { buildProfile } from "../build";
import { ExtractProfileInput, type ExtractProfileOutput, type IdentityGuess } from "../types";
import { inferIdentities, rolesFromGuesses } from "./identity";
import { documentsToIR } from "./ir";

/*
 * The local engine's extractProfile: parsers → IR → Profile + facts → identities → gaps.
 * Gaps are choice-first questions in the person's language, only for what matters for the
 * identities found (plan §8.4): a founder is asked about the round, a student about the
 * graduation date, a job seeker about the next role and where.
 */

type Lang = "en" | "zh";

export function profileGaps(profile: Profile, identities: IdentityGuess[], lang: Lang): string[] {
  const zh = lang === "zh";
  const codes = new Set<IdentityCode>(identities.filter((g) => g.confidence >= 0.5).map((g) => g.code));
  const has = (prefix: string) => [...codes].some((c) => c.startsWith(prefix));
  const gaps: string[] = [];
  const q = (en: string, cn: string) => gaps.push(zh ? cn : en);

  if (!profile.identity.name) q("What's your full name as it should appear on applications?", "申请材料上应写的姓名是？");
  if (!profile.identity.email) q("Which email should organisations reply to?", "希望对方回复到哪个邮箱？");
  if (!profile.identity.location) q("Which city are you based in?", "你目前在哪个城市？");
  if (!profile.experience.length && !profile.education.length && !profile.packs.founder?.ventures.length) {
    q("We couldn't find your experience or education. Upload a résumé, CV or LinkedIn PDF, or tell us your latest role.", "没有读到工作或教育经历。请上传简历、CV 或领英导出的 PDF，或告诉我们你最近的职位。");
  }
  if (has("S")) {
    const st = profile.education.find((e) => e.current);
    if (st && !st.endDate) q(`When do you expect to graduate from ${st.institution}?`, `你预计何时从${st.institution}毕业？`);
    if (!profile.packs.student?.internshipMonths && !codes.has("S1")) q("How many months could you do an internship, and from when?", "你可以实习多长时间？最早何时开始？");
    if (codes.has("S1") && !profile.identity.guardianEmail) q("Because you're under 18, we need a parent or guardian's email to confirm.", "你未满 18 岁，需要填写监护人的邮箱以便确认。");
  }
  if (has("E") || has("T") || (profile.experience.length && !has("F") && !has("R"))) {
    if (!profile.packs.jobSeeker?.targetOccupations.length) q("What kind of role do you want next?", "你下一份工作想做什么职位？");
    if (!profile.packs.jobSeeker?.locations.length) q("Where do you want to work: your city, other cities, or remote?", "你希望在哪里工作：本地、其他城市，还是远程？");
    if (profile.packs.jobSeeker?.remote == null) q("Are you open to remote, hybrid or on-site roles?", "你接受远程、混合还是到岗办公？");
    if (profile.packs.jobSeeker?.availableFrom == null) q("When could you start a new role?", "你最早什么时候可以到岗？");
  }
  if (has("F")) {
    const v = profile.packs.founder?.ventures[0];
    if (!v) q("What's your company called, and what does it do in one sentence?", "你的公司叫什么？一句话介绍它做什么。");
    else {
      if (!v.stage) q(`What stage is ${v.company} at (idea, MVP, pre-seed, seed, Series A…)?`, `${v.company} 目前处于什么阶段（想法、MVP、种子轮、A 轮……）？`);
      if (!v.currentRound) q(`Are you raising for ${v.company}? If so, how much and what kind of round?`, `${v.company} 是否在融资？如果是，本轮金额和轮次是？`);
      if (!v.teamSize) q(`How many people work on ${v.company}?`, `${v.company} 团队有多少人？`);
      if (!v.traction.revenue && !v.traction.users) q(`What traction can we cite for ${v.company} (users, customers, revenue)?`, `${v.company} 有哪些可以引用的数据（用户、客户、收入）？`);
    }
  }
  if (has("R")) {
    if (!profile.packs.researcher?.fields.length) q("What are your main research areas?", "你的主要研究方向是什么？");
    if (!profile.publications.length) q("Upload your CV or add your ORCID iD so we can list your publications.", "请上传 CV 或填写 ORCID iD，以便导入你的论文。");
  }
  if (has("C")) {
    if (!profile.identity.links.some((l) => ["portfolio", "behance", "dribbble", "website", "youtube", "bilibili", "instagram"].includes(l.kind))) {
      q("Where can people see your work? Add a portfolio or channel link.", "在哪里可以看到你的作品？请添加作品集或频道链接。");
    }
    if (!profile.packs.creator?.rates) q("What's your usual rate or price range?", "你的常规报价或价格区间是？");
  }
  if (has("P") && !profile.packs.professional?.licenses.length) q("Which license do you hold, and where are you licensed to practise?", "你持有哪种执业资格？在哪里执业？");
  return gaps.slice(0, 8);
}

export function localExtractProfile(raw: ExtractProfileInput): ExtractProfileOutput {
  const input = ExtractProfileInput.parse(raw);
  const now = input.now ? new Date(input.now) : new Date();
  const ir = documentsToIR(input.documents);
  const { profile, facts } = buildProfile(ir, { locale: input.locale, documents: input.documents, links: input.links, now });
  const identities = inferIdentities(
    profile,
    input.documents.map((d) => d.text),
    { now, locale: input.locale },
  );
  profile.roles = rolesFromGuesses(identities);
  const unreadable = input.documents.filter((d) => !d.text.trim());
  const gaps = [
    // Scans and photos need visual reading, which the local engine doesn't do.
    ...unreadable.map((d) =>
      input.locale === "zh"
        ? `暂时无法读取「${d.filename}」（看起来是扫描件或图片）。请上传可复制文字的 PDF 或 Word 文件。`
        : `We couldn't read "${d.filename}" (it looks like a scan or a photo). Upload a PDF with selectable text or a Word file instead.`,
    ),
    ...profileGaps(profile, identities, input.locale),
  ].slice(0, 8);
  return { profile, facts, identities, gaps };
}
