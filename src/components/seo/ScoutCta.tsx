import { ArrowRight } from "lucide-react";
import { ButtonLink, Pane } from "@/components/ui";
import { LogoMark } from "@/components/Logo";

/**
 * The call to action at the end of every SEO page: an always-dark pane that says what Onward
 * Scout does in one breath and starts the free onboarding (no sign-in needed to begin).
 */
export function ScoutCta({
  title = "Let your scout prepare the next one",
  body = "Drop in the résumé, deck or portfolio you already have. Onward Scout builds a sourced profile, finds opportunities you can win and prepares each application for you to approve with a tap.",
  secondary,
}: {
  title?: string;
  body?: string;
  /** Optional second action (e.g. open this listing in the Scout board). */
  secondary?: { href: string; label: string };
}) {
  return (
    <Pane ink pad="lg" className="relative overflow-hidden">
      <LogoMark size={36} tone="light" />
      <h2 className="headline mt-5 max-w-2xl text-[1.7rem] sm:text-[2.1rem]">{title}</h2>
      <p className="mt-3 max-w-2xl text-[1rem] leading-relaxed opacity-80">{body}</p>
      <div className="mt-7 flex flex-wrap gap-3">
        <ButtonLink href="/app/start" prefetch={false} iconRight={<ArrowRight size={18} aria-hidden />}>
          Start free with what you have
        </ButtonLink>
        {secondary ? (
          <ButtonLink href={secondary.href} prefetch={false} variant="ghost">
            {secondary.label}
          </ButtonLink>
        ) : (
          <ButtonLink href="/how-it-works" variant="ghost">
            How it works
          </ButtonLink>
        )}
      </div>
      <p className="mt-5 text-[0.84rem] opacity-60">Nothing is submitted without your tap. Logins, CAPTCHAs, payments and interviews stay with you.</p>
    </Pane>
  );
}
