import { CardGridSkeleton, DetailSkeleton, PaneSkeleton } from "@/components/Skeletons";
import { Container, Skeleton } from "@/components/ui";

/*
 * Loading states for the public SEO pages, in the shape of what is coming. They show the moment a
 * link is pressed (a page that is not cached yet renders on its first visit) and are built only
 * from the shared skeleton primitives.
 */

function HeaderBars({ wide = false }: { wide?: boolean }) {
  return (
    <div className="max-w-3xl" aria-hidden>
      <Skeleton className="block h-3.5 w-48 rounded-full" />
      <Skeleton className="mt-7 block h-3 w-28 rounded-full" />
      <Skeleton className={`mt-4 block h-10 rounded-[14px] ${wide ? "w-11/12" : "w-3/4"}`} />
      <Skeleton className="mt-5 block h-4 w-full rounded-full" />
      <Skeleton className="mt-2.5 block h-4 w-5/6 rounded-full" />
    </div>
  );
}

/** Hubs and lists: breadcrumb, title, a chip row, a grid of cards. */
export function HubSkeleton({ label = "Loading" }: { label?: string }) {
  return (
    <Container className="pt-8 sm:pt-12">
      <div role="status" aria-label={label} aria-busy="true">
        <HeaderBars />
        <div className="mt-7 flex gap-2 overflow-hidden" aria-hidden>
          {[96, 120, 88, 132].map((w) => (
            <Skeleton key={w} className="block h-11 shrink-0 rounded-full" width={w} />
          ))}
        </div>
        <CardGridSkeleton cards={6} className="mt-8" />
      </div>
    </Container>
  );
}

/** Listing, career, organization and guide pages: header, main column, side column. */
export function DetailPageSkeleton({ label = "Loading" }: { label?: string }) {
  return (
    <Container className="pt-8 sm:pt-12">
      <Skeleton className="block h-3.5 w-56 rounded-full" />
      <DetailSkeleton label={label} className="mt-7" />
    </Container>
  );
}

/** Blog articles: title block and one long reading pane. */
export function ArticleSkeleton({ label = "Loading" }: { label?: string }) {
  return (
    <Container className="pt-8 sm:pt-12">
      <div role="status" aria-label={label} aria-busy="true">
        <HeaderBars wide />
        <div className="mt-8 grid gap-10 lg:grid-cols-[minmax(0,1fr)_280px]">
          <PaneSkeleton lines={6} tall />
          <div className="hidden lg:block">
            <PaneSkeleton lines={4} />
          </div>
        </div>
      </div>
    </Container>
  );
}
