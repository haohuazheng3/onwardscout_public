import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it, vi } from "vitest";
import common from "../messages/en/common.json";
import onboarding from "../messages/en/onboarding.json";
import { emptyProfile, type Profile } from "@/lib/core/types";

let query = "";
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(query) }));
vi.mock("@/i18n/navigation", () => ({ useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }) }));
vi.mock("@/components/Consent", () => ({ track: () => {} }));
vi.mock("next/link", () => ({ default: () => null }));

const { OnboardingFlow } = await import("@/components/onboarding/OnboardingFlow");

/* The files only pre-select answers: tagged "From your résumé" when they came from the files,
 * untagged when the person gave them; every question is still asked. */

const STATUS = { phase: "idle", documents: [], profile: null } as never;

function render(q: string, profile: Profile, confirmedPaths: string[] = []): string {
  query = q;
  return renderToStaticMarkup(
    createElement(
      NextIntlClientProvider,
      { locale: "en", timeZone: "UTC", messages: { common, onboarding } } as unknown as ComponentProps<typeof NextIntlClientProvider>,
      createElement(OnboardingFlow, { mode: "draft", signedIn: false, locale: "en", claim: false, status: STATUS, profile, activeGoals: [], confirmedPaths }),
    ),
  );
}

const pressed = (html: string) => [...html.matchAll(/aria-pressed="true"[^>]*>(.*?)<\/button>/g)].map((m) => m[1]!.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/\s+/g, " ").trim());

function withRoles(inferred: boolean): Profile {
  const p = emptyProfile();
  return { ...p, roles: [{ code: "S3", stage: "first_year", since: null, inferred }] };
}

describe("onboarding presets", () => {
  it("asks what you do now with the files' answer pre-selected and tagged", () => {
    const html = render("q=situation", withRoles(true));
    expect(html).toContain("What do you do right now?");
    expect(pressed(html)).toEqual(["I'm a student From your résumé"]);
  });

  it("pre-selects the person's own earlier answer without the tag", () => {
    const html = render("q=situation", withRoles(false));
    expect(pressed(html)).toEqual(["I'm a student"]);
    expect(html).not.toContain("From your résumé");
  });

  it("asks one detail of the situation, pre-selected from the files", () => {
    const html = render("q=detail&g=S", withRoles(true));
    expect(html).toContain("What are you studying for?");
    expect(pressed(html)).toEqual(["Master's student From your résumé"]);
  });

  it("always asks the city, pre-filled from the files unless the person gave it", () => {
    const p = { ...emptyProfile(), identity: { ...emptyProfile().identity, location: "Shanghai, China" } };
    expect(pressed(render("q=where", p))).toEqual(["Shanghai, China From your résumé"]);
    expect(pressed(render("q=where", p, ["/identity/location"]))).toEqual(["Shanghai, China"]);
    const none = render("q=where", emptyProfile());
    expect(none).toContain("Where are you based?");
    expect(pressed(none)).toEqual([]);
  });

  it("asks without a preset when the files said nothing", () => {
    const html = render("q=situation", emptyProfile());
    expect(pressed(html)).toEqual([]);
    expect(html).not.toContain("From your résumé");
  });
});
