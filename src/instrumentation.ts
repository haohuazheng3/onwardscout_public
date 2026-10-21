import type { Instrumentation } from "next";

export async function register() {
  // Nothing to initialise eagerly: error capture is lazy and per request.
}

/** Every server-side render, route-handler, server-action and proxy error lands in the error inbox. */
export const onRequestError: Instrumentation.onRequestError = async (err, request, context) => {
  if (process.env.NEXT_RUNTIME !== "nodejs") {
    console.error("[onRequestError:edge]", err);
    return;
  }
  const { captureError } = await import("./lib/errors");
  const digest = typeof err === "object" && err !== null && "digest" in err ? String((err as { digest: unknown }).digest) : undefined;
  await captureError(err, {
    route: context.routePath ?? request.path,
    source: context.routeType === "proxy" ? "edge" : "server",
    context: {
      method: request.method,
      path: request.path.split("?")[0],
      routeType: context.routeType,
      renderSource: context.renderSource,
      digest,
    },
  });
};
