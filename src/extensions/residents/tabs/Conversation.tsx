import type { TabProps } from "@/extensions/tabs";
import { ThreadPane } from "../inbox/ThreadPane";

// The conversation on the generic record page: the same pane the inbox shows.
export async function Conversation({ id, actor }: TabProps) {
  return <ThreadPane id={id} actor={actor} />;
}
