import type * as React from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '../primitives/popover';
import {
  NotificationListItem,
  type NotificationListItemNotification,
} from './notification-list-item';

export interface NotificationPopoverProps {
  /** The element that triggers the popover (e.g. the bell button). */
  trigger: React.ReactNode;
  items: NotificationListItemNotification[];
  hasMore: boolean;
  unreadCount: number;
  onMarkAll: () => void;
  onLoadMore: () => void;
  onMarkRead: (id: string) => void;
  onDismiss: (id: string) => void;
  isLoadingMore?: boolean;
  renderItem?: (n: NotificationListItemNotification) => React.ReactNode;
}

export function NotificationPopover({
  trigger,
  items,
  hasMore,
  unreadCount,
  onMarkAll,
  onLoadMore,
  onMarkRead,
  onDismiss,
  isLoadingMore = false,
  renderItem,
}: NotificationPopoverProps): React.ReactElement {
  return (
    <Popover>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent align="end" sideOffset={8} className="w-[380px] max-w-[calc(100vw-16px)] p-0">
        <div className="flex items-center justify-between border-b border-hairline px-4 py-3">
          <span className="text-body-sm font-semibold text-ink">Notifications</span>
          <button
            type="button"
            disabled={unreadCount === 0}
            onClick={onMarkAll}
            className="text-caption text-ink-muted hover:text-ink disabled:cursor-not-allowed disabled:text-ink-subtle"
          >
            Mark all as read
          </button>
        </div>
        <div className="max-h-[min(480px,60vh)] overflow-y-auto">
          {items.length === 0 ? (
            <div className="flex items-center justify-center p-6 text-caption text-ink-muted">
              No notifications yet.
            </div>
          ) : (
            <>
              {items.map((n) => (
                <article key={n.id}>
                  {renderItem ? (
                    renderItem(n)
                  ) : (
                    <NotificationListItem
                      notification={n}
                      onMarkRead={onMarkRead}
                      onDismiss={onDismiss}
                    />
                  )}
                </article>
              ))}
              {hasMore && (
                <div className="flex justify-center p-3">
                  <button
                    type="button"
                    onClick={onLoadMore}
                    disabled={isLoadingMore}
                    className="text-caption text-ink-muted hover:text-ink disabled:text-ink-subtle"
                  >
                    {isLoadingMore ? 'Loading…' : 'Load more'}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
