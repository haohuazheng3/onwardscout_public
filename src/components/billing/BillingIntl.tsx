import type { ReactNode } from "react";
import { IntlProvider } from "@/i18n/IntlProvider";
import { loadMessages } from "@/i18n/messages";
import type { Namespace } from "@/i18n/namespaces";
import { TIME_ZONE } from "@/i18n/request";
import type { Locale } from "@/i18n/routing";

/**
 * Server component for (site) pages (the pricing page): client components there only get the
 * `common` namespace, so wrap the buy buttons, <ResumePurchase /> and <CheckoutNotice /> in this
 * to give them the full `billing` wording. A nested provider replaces the outer one, so pass any
 * other namespace the wrapped client components read in `also` (e.g. ["site"]).
 */
export async function BillingIntl({ locale, children, also = [] }: { locale: Locale; children: ReactNode; also?: Namespace[] }) {
  const messages = await loadMessages(locale, ["common", "billing", ...also.filter((n) => n !== "common" && n !== "billing")]);
  return (
    <IntlProvider locale={locale} messages={messages} timeZone={TIME_ZONE}>
      {children}
    </IntlProvider>
  );
}
