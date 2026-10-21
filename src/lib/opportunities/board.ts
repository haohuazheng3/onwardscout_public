import "server-only";
import { filtersToQuery, hasNarrowingFilters, type BoardFilters } from "./filters";
import type { BoardGroup } from "./groups";
import { ensurePracticeOpportunity } from "./practice";
import { boardGroupCounts, cardFromRow, hasAnyApplication, listBoard, newThisWeek } from "./queries";
import type { BoardPage } from "./types";

export interface BoardResponse extends BoardPage {
  counts: Record<BoardGroup, number> | null;
  /** Picks added in the last seven days for the selected goal (with counts only). */
  newThisWeek: number | null;
}

/**
 * One page of the board as the page and /api/opportunities serve it. The practice run is shown
 * first on the plain board for anyone who hasn't applied to anything yet — even before their
 * first refresh has produced a match row for it, so a brand-new person always has one tap.
 */
export async function loadBoardPage(userId: string, filters: BoardFilters, paging: { offset: number; limit: number }, opts: { counts?: boolean } = {}): Promise<BoardResponse> {
  const [page, counts, fresh] = await Promise.all([
    listBoard({ userId, filters, offset: paging.offset, limit: paging.limit }),
    opts.counts ? boardGroupCounts(userId, filtersToQuery(filters)) : Promise.resolve(null),
    opts.counts ? newThisWeek(userId, filters.goal) : Promise.resolve(null),
  ]);
  if (paging.offset === 0 && filters.view === "picks" && !filters.goal && !hasNarrowingFilters(filters) && !page.items.some((i) => i.opportunity.type === "practice")) {
    if (!(await hasAnyApplication(userId))) {
      const practice = await ensurePracticeOpportunity();
      page.items.unshift({ opportunity: cardFromRow(practice, userId), match: null, application: null });
    }
  }
  return { ...page, counts, newThisWeek: fresh };
}
