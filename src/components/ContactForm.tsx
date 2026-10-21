"use client";

import { ArrowRight, CircleCheck } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Button, Field, Input, Select, Textarea, fieldDescribedBy } from "@/components/ui";
import { toast } from "@/components/ui-client";
import { CONTACT_LIMITS, isContactTopic, precheckContact, type ContactErrorCode, type ContactTopic } from "@/content/contact";

/*
 * The contact form. Every press answers at once: invalid input is caught before any network
 * call, the button flips to "Sending…" on submit, success replaces the form with a confirmation,
 * and a failure keeps everything typed, explains what happened and offers the email address.
 * Strings arrive as props (public pages give client components the `common` namespace only).
 * A `?topic=<value>` in the URL preselects the topic (e.g. links from billing or privacy pages).
 */

export interface ContactFormCopy {
  name: string;
  optional: string;
  namePlaceholder: string;
  email: string;
  emailPlaceholder: string;
  topic: string;
  message: string;
  messagePlaceholder: string;
  send: string;
  sending: string;
  sentTag: string;
  sentTitle: string;
  /** Contains `{email}`, replaced with the address the reply goes to. */
  sentBody: string;
  sendAnother: string;
  failedTitle: string;
  errors: Record<ContactErrorCode | "network", string>;
}

type State =
  | { status: "idle" }
  | { status: "sending" }
  | { status: "sent"; email: string }
  | { status: "error"; code: ContactErrorCode | "network" };

type FieldName = "email" | "message";

function fieldOf(code: ContactErrorCode | "network"): FieldName | null {
  if (code === "invalid_email") return "email";
  if (code === "message_short" || code === "message_long") return "message";
  return null;
}

export function ContactForm({
  copy,
  topics,
  locale,
  privacyNote,
  defaultTopic = "other",
}: {
  copy: ContactFormCopy;
  topics: { value: ContactTopic; label: string }[];
  locale: "en" | "zh";
  privacyNote: ReactNode;
  defaultTopic?: ContactTopic;
}) {
  const [state, setState] = useState<State>({ status: "idle" });
  const formRef = useRef<HTMLFormElement>(null);
  const topicRef = useRef<HTMLSelectElement>(null);
  const sentRef = useRef<HTMLHeadingElement>(null);

  // ?topic=billing preselects a topic. The select is uncontrolled, so this touches the DOM only.
  useEffect(() => {
    const wanted = new URLSearchParams(window.location.search).get("topic");
    if (isContactTopic(wanted) && topicRef.current) topicRef.current.value = wanted;
  }, []);

  useEffect(() => {
    if (state.status === "sent") sentRef.current?.focus();
  }, [state.status]);

  const errorCode = state.status === "error" ? state.code : null;
  const errorField = errorCode ? fieldOf(errorCode) : null;
  const errorText = errorCode ? copy.errors[errorCode] : null;

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (state.status === "sending") return;
    const form = e.currentTarget;
    const data = Object.fromEntries(new FormData(form).entries()) as Record<string, string>;

    const local = precheckContact({ email: data.email ?? "", message: data.message ?? "" });
    if (local) {
      setState({ status: "error", code: local });
      const field = fieldOf(local);
      if (field) (form.elements.namedItem(field) as HTMLElement | null)?.focus();
      return;
    }

    setState({ status: "sending" }); // instant: before the network
    try {
      const res = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...data, locale }),
      });
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean; code?: ContactErrorCode };
      if (!res.ok || !body.ok) {
        const code: ContactErrorCode = body.code ?? (res.status === 429 ? "rate_limited" : res.status >= 500 ? "server" : "invalid");
        setState({ status: "error", code });
        if (!fieldOf(code)) toast.error(copy.failedTitle, { body: copy.errors[code] });
        return;
      }
      setState({ status: "sent", email: (data.email ?? "").trim() });
      form.reset();
    } catch {
      setState({ status: "error", code: "network" });
      toast.error(copy.failedTitle, { body: copy.errors.network });
    }
  }

  if (state.status === "sent") {
    return (
      <div className="pane animate-rise p-6 sm:p-9" role="status">
        <p className="tag tag-ok gap-1.5">
          <CircleCheck size={14} aria-hidden />
          {copy.sentTag}
        </p>
        <h2 ref={sentRef} tabIndex={-1} className="headline mt-4 text-[1.7rem] text-ink outline-none">
          {copy.sentTitle}
        </h2>
        <p className="mt-2 text-[1rem] leading-relaxed text-ink-3">{copy.sentBody.replace("{email}", state.email)}</p>
        <Button variant="ghost" size="sm" className="mt-6" onClick={() => setState({ status: "idle" })}>
          {copy.sendAnother}
        </Button>
      </div>
    );
  }

  const sending = state.status === "sending";
  const emailError = errorField === "email" ? errorText : undefined;
  const messageError = errorField === "message" ? errorText : undefined;
  const formError = errorCode && !errorField ? errorText : null;

  return (
    <form ref={formRef} onSubmit={onSubmit} noValidate className="pane relative p-5 sm:p-8" aria-busy={sending || undefined}>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field id="c-name" label={copy.name} optional={`(${copy.optional})`}>
          <Input id="c-name" name="name" autoComplete="name" maxLength={CONTACT_LIMITS.name} placeholder={copy.namePlaceholder} />
        </Field>
        <Field id="c-email" label={copy.email} error={emailError ?? undefined}>
          <Input
            id="c-email"
            name="email"
            type="email"
            inputMode="email"
            required
            autoComplete="email"
            maxLength={CONTACT_LIMITS.email}
            placeholder={copy.emailPlaceholder}
            invalid={Boolean(emailError)}
            aria-describedby={fieldDescribedBy("c-email", { error: emailError })}
            onInput={() => errorField === "email" && setState({ status: "idle" })}
          />
        </Field>
      </div>
      <Field id="c-topic" label={copy.topic} className="mt-5">
        <Select id="c-topic" name="topic" ref={topicRef} defaultValue={defaultTopic}>
          {topics.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </Select>
      </Field>
      <Field id="c-message" label={copy.message} error={messageError ?? undefined} className="mt-5">
        <Textarea
          id="c-message"
          name="message"
          required
          rows={6}
          minLength={CONTACT_LIMITS.messageMin}
          maxLength={CONTACT_LIMITS.messageMax}
          placeholder={copy.messagePlaceholder}
          invalid={Boolean(messageError)}
          aria-describedby={fieldDescribedBy("c-message", { error: messageError })}
          onInput={() => errorField === "message" && setState({ status: "idle" })}
        />
      </Field>

      {/* Honeypot: hidden from people and assistive technology; bots fill it. */}
      <div aria-hidden="true" className="absolute -left-[9999px] top-0 h-0 w-0 overflow-hidden">
        <label htmlFor="c-website">Website</label>
        <input id="c-website" name="website" tabIndex={-1} autoComplete="off" />
      </div>

      {formError ? (
        <p role="alert" className="mt-5 rounded-[var(--radius-field)] bg-bad-soft px-4 py-3 text-[0.95rem] leading-relaxed text-ink">
          {formError}
        </p>
      ) : null}

      <div className="mt-6 flex flex-col-reverse gap-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-[0.85rem] leading-snug text-ink-4">{privacyNote}</p>
        <Button type="submit" size="lg" loading={sending} iconRight={<ArrowRight size={18} aria-hidden />} className="shrink-0">
          {sending ? copy.sending : copy.send}
        </Button>
      </div>
    </form>
  );
}
