"use client";

import { useEffect, useRef, type ComponentProps } from "react";
import { ProfileCard } from "@/components/onboarding/ProfileCard";
import { useRouter } from "@/i18n/navigation";

/**
 * The profile page's editable card. A saved change refreshes the server-rendered parts of the
 * page (the record below, completeness), debounced so a burst of taps refreshes once, after the
 * last save has landed.
 */
export function LiveProfileCard(props: Omit<ComponentProps<typeof ProfileCard>, "onChange">) {
  const router = useRouter();
  const timer = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (timer.current) window.clearTimeout(timer.current);
    },
    [],
  );
  return (
    <ProfileCard
      {...props}
      onChange={(_profile, res) => {
        if (timer.current) window.clearTimeout(timer.current);
        // Only a confirmed save (res present) triggers the refresh; optimistic and rolled-back states don't.
        if (res) timer.current = window.setTimeout(() => router.refresh(), 900);
      }}
    />
  );
}
