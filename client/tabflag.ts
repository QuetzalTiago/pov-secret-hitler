const FLAG_ICON =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect x='1' y='1' width='30' height='30' rx='6' fill='%23231F20' stroke='%23231F20' stroke-width='2'/%3E%3Ccircle cx='16' cy='16' r='8' fill='%23C9A24A'/%3E%3C/svg%3E";

let saved: { title: string; icon: string | null } | null = null;

const iconLink = () => document.querySelector<HTMLLinkElement>('link[rel="icon"]');

/** Marks the browser tab (title and favicon) as waiting on the player. */
export function flagTab() {
  if (saved) return;
  const link = iconLink();
  saved = { title: document.title, icon: link ? link.href : null };
  document.title = `● Your move · ${saved.title}`;
  if (link) link.href = FLAG_ICON;
}

/** Restores the tab title and favicon. */
export function unflagTab() {
  if (!saved) return;
  document.title = saved.title;
  const link = iconLink();
  if (link && saved.icon !== null) link.href = saved.icon;
  saved = null;
}

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) unflagTab();
});
