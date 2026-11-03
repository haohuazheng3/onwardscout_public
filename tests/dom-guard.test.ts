import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/** Just enough of the DOM: the two methods throw like a browser when the node is not a child. */
class FakeNode {
  parentNode: FakeNode | null = null;
  childNodes: FakeNode[] = [];
  constructor(public name: string) {}
  appendChild<T extends FakeNode>(node: T): T {
    return this.insertBefore(node, null);
  }
  removeChild<T extends FakeNode>(child: T): T {
    const i = this.childNodes.indexOf(child);
    if (i < 0) throw new Error("The node to be removed is not a child of this node.");
    this.childNodes.splice(i, 1);
    child.parentNode = null;
    return child;
  }
  insertBefore<T extends FakeNode>(node: T, ref: FakeNode | null): T {
    if (ref && ref.parentNode !== this) throw new Error("The node before which the new node is to be inserted is not a child of this node.");
    if (node.parentNode) node.parentNode.removeChild(node);
    this.childNodes.splice(ref ? this.childNodes.indexOf(ref) : this.childNodes.length, 0, node);
    node.parentNode = this;
    return node;
  }
}

const names = (n: FakeNode) => n.childNodes.map((c) => c.name);

/** What Chrome's page translation does: the text node is swapped for a <font> holding the translation. */
function translate(text: FakeNode): FakeNode {
  const parent = text.parentNode!;
  const font = new FakeNode(`font(${text.name})`);
  parent.insertBefore(font, text);
  parent.removeChild(text);
  return font;
}

const realNode = (globalThis as { Node?: unknown }).Node;
let warn: ReturnType<typeof vi.spyOn>;

beforeAll(async () => {
  (globalThis as { Node?: unknown }).Node = FakeNode;
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterAll(() => {
  (globalThis as { Node?: unknown }).Node = realNode;
  warn.mockRestore();
});

describe("DOM guard against page translators", () => {
  it("without the guard, removing a translated text node throws (the production crash)", () => {
    const p = new FakeNode("p");
    const text = p.appendChild(new FakeNode("text"));
    translate(text);
    expect(() => p.removeChild(text)).toThrow(/not a child/);
  });

  it("with the guard, a node the translator took out is left alone", async () => {
    const { guardDomAgainstTranslators } = await import("@/lib/dom-guard");
    guardDomAgainstTranslators();
    guardDomAgainstTranslators(); // installing twice wraps once
    const p = new FakeNode("p");
    const text = p.appendChild(new FakeNode("text"));
    p.appendChild(new FakeNode("b"));
    translate(text);
    expect(p.removeChild(text)).toBe(text);
    expect(names(p)).toEqual(["font(text)", "b"]);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("a node moved into a wrapper is removed from where it is now", () => {
    const p = new FakeNode("p");
    const text = p.appendChild(new FakeNode("text"));
    const wrapper = p.appendChild(new FakeNode("span"));
    wrapper.appendChild(text);
    expect(p.removeChild(text)).toBe(text);
    expect(text.parentNode).toBeNull();
    expect(names(wrapper)).toEqual([]);
  });

  it("an insert next to a moved node lands before its ancestor still in place", () => {
    const p = new FakeNode("p");
    const text = p.appendChild(new FakeNode("text"));
    const wrapper = p.appendChild(new FakeNode("span"));
    p.appendChild(new FakeNode("tail"));
    wrapper.appendChild(text);
    p.insertBefore(new FakeNode("new"), text);
    expect(names(p)).toEqual(["new", "span", "tail"]);
  });

  it("an insert next to a node the translator took out goes to the end", () => {
    const p = new FakeNode("p");
    const text = p.appendChild(new FakeNode("text"));
    p.appendChild(new FakeNode("b"));
    translate(text);
    p.insertBefore(new FakeNode("new"), text);
    expect(names(p)).toEqual(["font(text)", "b", "new"]);
  });

  it("ordinary removals and inserts are unchanged and say nothing", () => {
    warn.mockClear();
    const p = new FakeNode("p");
    const a = p.appendChild(new FakeNode("a"));
    const c = p.appendChild(new FakeNode("c"));
    p.insertBefore(new FakeNode("b"), c);
    p.removeChild(a);
    expect(names(p)).toEqual(["b", "c"]);
    expect(() => p.insertBefore(new FakeNode("x"), null)).not.toThrow();
    expect(warn).not.toHaveBeenCalled();
  });
});
