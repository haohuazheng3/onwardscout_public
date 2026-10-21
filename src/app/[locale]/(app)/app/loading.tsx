import { AppPageSkeleton } from "@/components/Skeletons";

/** Default skeleton for every /app page that has no loading.tsx of its own (renders inside the shell). */
export default function AppLoading() {
  return <AppPageSkeleton />;
}
