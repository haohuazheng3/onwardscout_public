"use client";

import { IntlErrorCode, NextIntlClientProvider, type AbstractIntlMessages } from "next-intl";
import type { ReactNode } from "react";
import { messageFallback } from "./fallback";

/*
 * Client-side message provider. Functions cannot cross the server → client boundary, so
 * the error handler and the fallback live here: a missing key on the client renders a
 * humanised key and logs once in development; it never throws.
 */

const isProd = process.env.NODE_ENV === "production";

export function IntlProvider({
  locale,
  messages,
  timeZone,
  children,
}: {
  locale: string;
  messages: Record<string, AbstractIntlMessages>;
  timeZone: string;
  children: ReactNode;
}) {
  return (
    <NextIntlClientProvider
      locale={locale}
      messages={messages}
      timeZone={timeZone}
      onError={(error) => {
        if (error.code === IntlErrorCode.MISSING_MESSAGE) {
          if (!isProd) console.warn(`[i18n] ${error.message}`);
          return;
        }
        console.error(`[i18n] ${error.code}: ${error.message}`);
      }}
      getMessageFallback={({ namespace, key }) => messageFallback({ namespace, key })}
    >
      {children}
    </NextIntlClientProvider>
  );
}
