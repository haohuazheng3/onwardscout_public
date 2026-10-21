import { Bot, Hand, MousePointerClick } from "lucide-react";
import { BOUNDARY, pick, type BoundaryTone } from "@/content/site-copy";
import { cx } from "@/components/ui";

/*
 * "What we automate vs what stays with you" (plan §12.1): a table on wide screens, one card per
 * row on phones. The tone of each row is shown with a coloured tag and an icon, never colour alone.
 */

const TONE: Record<BoundaryTone, { tag: string; Icon: typeof Bot }> = {
  auto: { tag: "tag-pine", Icon: Bot },
  tap: { tag: "tag-accent", Icon: MousePointerClick },
  you: { tag: "tag-ink", Icon: Hand },
};

function WhoTag({ tone, label }: { tone: BoundaryTone; label: string }) {
  const { tag, Icon } = TONE[tone];
  return (
    <span className={cx("tag w-fit gap-1.5 whitespace-nowrap", tag)}>
      <Icon size={13} strokeWidth={2.2} aria-hidden />
      {label}
    </span>
  );
}

export function BoundaryTable({ locale, labels }: { locale: string; labels: { step: string; who: string; how: string } }) {
  const rows = BOUNDARY.map((r) => ({ step: pick(r.step, locale), who: pick(r.who, locale), how: pick(r.how, locale), tone: r.tone }));
  return (
    <div className="pane overflow-hidden">
      {/* Phones and small tablets: cards. */}
      <ul className="divide-y divide-[var(--line)] md:hidden">
        {rows.map((r) => (
          <li key={r.step} className="px-5 py-4">
            <p className="text-[0.98rem] font-semibold leading-snug text-ink">{r.step}</p>
            <div className="mt-2">
              <WhoTag tone={r.tone} label={r.who} />
            </div>
            <p className="mt-2 text-[0.92rem] leading-relaxed text-ink-3">{r.how}</p>
          </li>
        ))}
      </ul>
      {/* Wide screens: a real table. */}
      <table className="hidden w-full border-collapse text-left md:table">
        <thead>
          <tr className="border-b border-line">
            <th scope="col" className="w-[36%] px-7 pb-3 pt-6 eyebrow">
              {labels.step}
            </th>
            <th scope="col" className="w-[24%] px-4 pb-3 pt-6 eyebrow">
              {labels.who}
            </th>
            <th scope="col" className="px-7 pb-3 pt-6 eyebrow">
              {labels.how}
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--line)]">
          {rows.map((r) => (
            <tr key={r.step}>
              <th scope="row" className="px-7 py-4 align-top text-[0.98rem] font-semibold leading-snug text-ink">
                {r.step}
              </th>
              <td className="px-4 py-4 align-top">
                <WhoTag tone={r.tone} label={r.who} />
              </td>
              <td className="px-7 py-4 align-top text-[0.94rem] leading-relaxed text-ink-3">{r.how}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
