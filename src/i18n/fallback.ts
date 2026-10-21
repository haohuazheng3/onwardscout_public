/**
 * What a user sees if a key is missing in every language: the last key segment, humanised
 * ("startFree" → "Start free"), instead of "common.nav.startFree" or a crash.
 */
export function messageFallback({ namespace, key }: { namespace?: string; key: string }): string {
  const last = key.split(".").pop() ?? key;
  const words = last
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[-_]+/g, " ")
    .trim()
    .toLowerCase();
  if (!words) return namespace ? `${namespace}.${key}` : key;
  return words.charAt(0).toUpperCase() + words.slice(1);
}
