import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { captureError } from "@/lib/errors";
import { notify, recordEvent } from "@/lib/notifications";

/*
 * Deadline reminders: a fixed deadline is the one thing a person on a career break or a
 * founder in a busy week cannot afford to miss. For every programme someone started an
 * application to (not yet submitted) or marked "interested", one reminder 7 days before and
 * one 2 days before it closes: in the app for everyone, by email for people whose plan or
 * season pass includes it. Run from the hourly follow-ups cron (no extra wake-up of the
 * database); each (person, programme, window) is reminded once (an `reminder.deadline` event).
 */

export const REMINDER_WINDOWS = [7, 2] as const;
export type ReminderWindow = (typeof REMINDER_WINDOWS)[number];

/** The window a deadline is in (2 days, else 7 days), or null when it is further away or past. */
export function reminderWindow(deadline: Date, now: Date): ReminderWindow | null {
  const days = (deadline.getTime() - now.getTime()) / 86_400_000;
  if (days <= 0) return null;
  if (days <= 2) return 2;
  if (days <= 7) return 7;
  return null;
}

/** Whole days left, rounded up ("closes in 2 days" on the morning of the day before). */
export function daysLeft(deadline: Date, now: Date): number {
  return Math.max(1, Math.ceil((deadline.getTime() - now.getTime()) / 86_400_000));
}

export interface ReminderCopyInput {
  name: string;
  days: number;
  started: boolean;
  questions: number;
}

export function reminderCopy(input: ReminderCopyInput, lang: "en" | "zh"): { title: string; body: string } {
  const { name, days, started, questions } = input;
  if (lang === "zh") {
    return {
      title: `${name} 还有 ${days} 天截止`,
      body: started
        ? questions > 0
          ? `你的申请材料已经写好，还差 ${questions} 个只有你能回答的小问题。点几下就能提交。`
          : "你的申请材料已经写好，等你看一眼并确认提交。"
        : "你标记了感兴趣。让 Onward Scout 先把申请材料写好，你只需要看一眼。",
    };
  }
  return {
    title: `${name} closes in ${days} ${days === 1 ? "day" : "days"}`,
    body: started
      ? questions > 0
        ? `Your materials are drafted; ${questions === 1 ? "one quick question" : `${questions} quick questions`} only you can answer and it is ready for your tap.`
        : "Your materials are drafted and waiting for your look and your tap."
      : "You marked it as interesting. Let Onward Scout draft the application now; you only look and tap.",
  };
}

interface Due {
  userId: string;
  opportunityId: string;
  name: string;
  deadline: Date;
  applicationId: string | null;
  questions: number;
  locale: string | null;
  email: boolean;
}

/** Programmes closing within 7 days that someone started or saved, not yet reminded for their window. */
async function dueReminders(limit: number): Promise<Due[]> {
  const result = await db.execute(sql`
    with targets as (
      select a.user_id, a.opportunity_id, a.id as application_id, coalesce(jsonb_array_length(a.questions), 0) as questions
        from applications a
       where not a.practice and a.submitted_at is null
         and a.status in ('draft', 'needs_info', 'preparing', 'ready', 'needs_you')
      union all
      select m.user_id, m.opportunity_id, null, 0
        from matches m
       where m.feedback = 'interested'
         and not exists (select 1 from applications x where x.user_id = m.user_id and x.opportunity_id = m.opportunity_id and not x.practice)
    )
    select t.user_id, t.opportunity_id, t.application_id, t.questions, o.name, o.deadline, u.locale,
           (exists (select 1 from subscriptions s where s.user_id = t.user_id and s.status in ('active', 'trialing', 'past_due'))
            or exists (select 1 from credit_lots l where l.user_id = t.user_id and l.status = 'active' and cardinality(l.scope) > 0
                        and l.remaining > 0 and (l.expires_at is null or l.expires_at > now()))) as email
      from targets t
      join opportunities o on o.id = t.opportunity_id
      join users u on u.id = t.user_id
     where o.status = 'active' and not o.rolling and o.deadline > now() and o.deadline <= now() + interval '7 days'
       and not exists (
         select 1 from events e
          where e.user_id = t.user_id and e.kind = 'reminder.deadline' and e.opportunity_id = t.opportunity_id
            and e.data->>'window' = (case when o.deadline <= now() + interval '2 days' then '2' else '7' end)
       )
     limit ${limit}
  `);
  const rows = (result as unknown as { rows: Array<Record<string, unknown>> }).rows ?? [];
  return rows.map((r) => ({
    userId: String(r.user_id),
    opportunityId: String(r.opportunity_id),
    name: String(r.name),
    deadline: new Date(String(r.deadline)),
    applicationId: r.application_id ? String(r.application_id) : null,
    questions: Number(r.questions ?? 0),
    locale: r.locale ? String(r.locale) : null,
    email: r.email === true || r.email === "t",
  }));
}

/** Sends the reminders that are due. Never throws; returns what it did. */
export async function sendDeadlineReminders(now: Date = new Date(), limit = 300): Promise<{ due: number; sent: number; failed: number }> {
  let due: Due[] = [];
  try {
    due = await dueReminders(limit);
  } catch (err) {
    await captureError(err, { route: "reminders.due", source: "cron" });
    return { due: 0, sent: 0, failed: 1 };
  }
  let sent = 0;
  let failed = 0;
  for (const d of due) {
    const window = reminderWindow(d.deadline, now);
    if (!window) continue;
    try {
      const lang = d.locale === "zh" ? "zh" : "en";
      const copy = reminderCopy({ name: d.name, days: daysLeft(d.deadline, now), started: Boolean(d.applicationId), questions: d.questions }, lang);
      // The event first: a crash after it means one missed reminder, never a duplicate.
      await recordEvent({ userId: d.userId, kind: "reminder.deadline", opportunityId: d.opportunityId, ...(d.applicationId ? { applicationId: d.applicationId } : {}), data: { window: String(window) } });
      await notify({
        userId: d.userId,
        kind: "deadline",
        title: copy.title,
        body: copy.body,
        href: d.applicationId ? `/app/applications/${d.applicationId}` : `/app/scout/${d.opportunityId}`,
        email: d.email,
      });
      sent++;
    } catch (err) {
      failed++;
      if (failed <= 3) await captureError(err, { route: "reminders.send", source: "cron", context: { opportunityId: d.opportunityId } });
    }
  }
  return { due: due.length, sent, failed };
}
