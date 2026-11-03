/*
 * Page translators (Chrome/Edge "Translate this page", translator extensions) swap the text
 * nodes React rendered for their own <font> elements. React still holds the old nodes, so the
 * next update that removes one, or inserts next to one, makes the DOM throw ("The node to be
 * removed is not a child of this node") and the page falls to the error screen although nothing
 * failed: the request behind the press carries on. These guards keep the page alive instead. A
 * node that is no longer where React left it is removed from where it is now (or left alone when
 * the translator already took it out); an insert next to such a node lands before its nearest
 * ancestor still in place, or at the end. Installed once, before hydration
 * (src/instrumentation-client.ts).
 */

let warned = false;

function noteRecovered(op: string): void {
  if (warned) return;
  warned = true;
  console.warn(`[dom] ${op}: a node React rendered was changed by a page translator or an extension; the page recovered`);
}

export function guardDomAgainstTranslators(): void {
  if (typeof Node !== "function") return;
  const proto = Node.prototype as Node & { __osDomGuard?: true };
  if (proto.__osDomGuard) return;
  proto.__osDomGuard = true;

  const removeChild = proto.removeChild;
  proto.removeChild = function <T extends Node>(this: Node, child: T): T {
    if (child.parentNode === this) return removeChild.call(this, child) as T;
    noteRecovered("removeChild");
    return child.parentNode ? (removeChild.call(child.parentNode, child) as T) : child;
  };

  const insertBefore = proto.insertBefore;
  proto.insertBefore = function <T extends Node>(this: Node, node: T, ref: Node | null): T {
    if (!ref || ref.parentNode === this) return insertBefore.call(this, node, ref) as T;
    noteRecovered("insertBefore");
    let anchor: Node | null = ref;
    while (anchor && anchor.parentNode !== this) anchor = anchor.parentNode;
    return insertBefore.call(this, node, anchor) as T;
  };
}
