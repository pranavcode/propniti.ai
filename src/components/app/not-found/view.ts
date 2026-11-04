// /app's not-found page: a path one segment under a list route is a record (link back to the list);
// anything else is a page that doesn't exist or isn't part of the role.
export function notFoundView(pathname: string, lists: readonly string[]): { record: boolean; list: string | null } {
  const parent = pathname.replace(/\/+$/, "").split("/").slice(0, -1).join("/");
  return lists.includes(parent) ? { record: true, list: parent } : { record: false, list: null };
}
