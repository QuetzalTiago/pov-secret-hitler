/** True when a scroll box is at (or within `slack` px of) its bottom, so new lines should keep it pinned. */
export function nearBottom(scrollTop: number, clientHeight: number, scrollHeight: number, slack = 24): boolean {
  return scrollHeight - scrollTop - clientHeight <= slack;
}
