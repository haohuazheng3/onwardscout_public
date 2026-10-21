import { ArrowUpRight, CalendarClock, MapPin } from "lucide-react";
import { Tag, cx, type TagTone } from "@/components/ui";
import { Link } from "@/i18n/navigation";
import { getOpportunityType } from "@/lib/core/opportunity-types";
import { benefitLine, opportunityPath, placeLine, shorten, timingOf, type PublicListing, type TimingTone } from "@/lib/programmatic";

export const TIMING_TONE: Record<TimingTone, TagTone> = {
  soon: "accent",
  open: "pine",
  rolling: "ok",
  cycle: "default",
  unknown: "default",
  closed: "bad",
};

/**
 * One listing in a grid: what it is, who runs it, when to apply and what it gives, linking to
 * its page. The whole pane is the link (lifts on hover, presses on tap).
 */
export function ListingCard({ listing, now, showType = false, className }: { listing: PublicListing; now: number; showType?: boolean; className?: string }) {
  const timing = timingOf(listing, now);
  const place = placeLine(listing.geo);
  const benefit = benefitLine(listing.benefits);
  return (
    <Link
      href={opportunityPath(listing.type, listing.slug)}
      locale="en"
      className={cx("pane pane-hover flex min-w-0 flex-col p-5 sm:p-6", className)}
    >
      <span className="flex flex-wrap items-center gap-2">
        {showType ? <Tag>{getOpportunityType(listing.type).label.en}</Tag> : null}
        <Tag tone={TIMING_TONE[timing.tone]} dot>
          {timing.tone === "rolling" ? "Rolling" : timing.tone === "unknown" ? "Dates on official page" : timing.tone === "cycle" ? "See cycle" : timing.label}
        </Tag>
      </span>
      <span className="title mt-3 block text-[1.12rem] leading-snug text-ink">{listing.name}</span>
      {listing.orgName ? <span className="mt-1 block truncate text-[0.9rem] text-ink-3">{listing.orgName}</span> : null}
      {listing.summary ? <span className="mt-3 block text-[0.94rem] leading-relaxed text-ink-2">{shorten(listing.summary, 170)}</span> : null}
      <span className="mt-auto flex flex-col gap-1.5 pt-4 text-[0.84rem] text-ink-3">
        {benefit ? <span className="font-medium text-ink-2">{benefit}</span> : null}
        {place ? (
          <span className="flex min-w-0 items-center gap-1.5">
            <MapPin size={14} aria-hidden className="shrink-0 text-ink-4" />
            <span className="truncate">{place}</span>
          </span>
        ) : null}
        {timing.tone === "cycle" && listing.cycle ? (
          <span className="flex min-w-0 items-start gap-1.5">
            <CalendarClock size={14} aria-hidden className="mt-[2px] shrink-0 text-ink-4" />
            <span className="line-clamp-2">{listing.cycle}</span>
          </span>
        ) : null}
        <span className="mt-1 inline-flex items-center gap-1 font-semibold text-ink">
          Details and how to apply <ArrowUpRight size={14} aria-hidden />
        </span>
      </span>
    </Link>
  );
}

/** A compact row for side lists (similar listings, more from this organization). */
export function ListingRow({ listing, now }: { listing: PublicListing; now: number }) {
  const timing = timingOf(listing, now);
  return (
    <li>
      <Link
        href={opportunityPath(listing.type, listing.slug)}
        locale="en"
        className="flex min-w-0 flex-col gap-1 rounded-[18px] px-3 py-3 transition-colors hover:bg-pane-2 active:bg-pane-3"
      >
        <span className="text-[0.98rem] font-semibold leading-snug text-ink">{listing.name}</span>
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[0.82rem] text-ink-3">
          {listing.orgName ? <span className="truncate">{listing.orgName}</span> : null}
          <span className={cx(timing.tone === "soon" && "font-semibold text-accent-text")}>{timing.tone === "rolling" ? "Rolling" : timing.label}</span>
        </span>
      </Link>
    </li>
  );
}
