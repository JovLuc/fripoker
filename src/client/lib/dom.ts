/** Elements where text selection must stay possible despite the global block. */
export function isEditable(el: Node | null): boolean {
  if (!el) return false;
  const target = el as HTMLElement;
  const tag = (target.tagName || "").toLowerCase();
  if (tag === "input" || tag === "textarea" || tag === "select") return true;
  return target.isContentEditable === true;
}
