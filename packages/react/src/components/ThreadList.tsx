import { ThreadListPrimitive, ThreadListItemPrimitive } from "@assistant-ui/react";

function ThreadListItem() {
  return (
    <ThreadListItemPrimitive.Root className="aui-thread-list-item">
      <ThreadListItemPrimitive.Trigger className="aui-thread-list-item-trigger">
        <ThreadListItemPrimitive.Title fallback="New Thread" />
      </ThreadListItemPrimitive.Trigger>
      <ThreadListItemPrimitive.Delete className="aui-thread-list-item-delete">
        Delete
      </ThreadListItemPrimitive.Delete>
    </ThreadListItemPrimitive.Root>
  );
}

export function ThreadList() {
  return (
    <ThreadListPrimitive.Root className="aui-thread-list">
      <ThreadListPrimitive.New className="aui-thread-list-new">New Thread</ThreadListPrimitive.New>
      <ThreadListPrimitive.Items components={{ ThreadListItem }} />
    </ThreadListPrimitive.Root>
  );
}
