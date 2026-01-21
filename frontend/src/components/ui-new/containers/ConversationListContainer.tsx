import { Virtuoso, VirtuosoHandle } from 'react-virtuoso';
import { useEffect, useMemo, useRef, useState } from 'react';

import { cn } from '@/lib/utils';
import NewDisplayConversationEntry from './NewDisplayConversationEntry';
import { ApprovalFormProvider } from '@/contexts/ApprovalFormContext';
import { useEntries } from '@/contexts/EntriesContext';
import {
  AddEntryType,
  PatchTypeWithKey,
  useConversationHistory,
} from '@/hooks/useConversationHistory';
import type { TaskWithAttemptStatus } from 'shared/types';
import type { WorkspaceWithSession } from '@/types/attempt';

interface ConversationListProps {
  attempt: WorkspaceWithSession;
  task?: TaskWithAttemptStatus;
}

export function ConversationList({ attempt, task }: ConversationListProps) {
  const [entries, setEntriesState] = useState<PatchTypeWithKey[]>([]);
  const [loading, setLoading] = useState(true);
  const { setEntries, reset } = useEntries();
  const pendingUpdateRef = useRef<{
    entries: PatchTypeWithKey[];
    addType: AddEntryType;
    loading: boolean;
  } | null>(null);
  const debounceTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const virtuosoRef = useRef<VirtuosoHandle>(null);
  const [atBottom, setAtBottom] = useState(true);
  const lastAddTypeRef = useRef<AddEntryType>('initial');

  useEffect(() => {
    setLoading(true);
    setEntriesState([]);
    reset();
  }, [attempt.id, reset]);

  useEffect(() => {
    return () => {
      if (debounceTimeoutRef.current) {
        clearTimeout(debounceTimeoutRef.current);
      }
    };
  }, []);

  const onEntriesUpdated = (
    newEntries: PatchTypeWithKey[],
    addType: AddEntryType,
    newLoading: boolean
  ) => {
    pendingUpdateRef.current = {
      entries: newEntries,
      addType,
      loading: newLoading,
    };

    if (debounceTimeoutRef.current) {
      clearTimeout(debounceTimeoutRef.current);
    }

    debounceTimeoutRef.current = setTimeout(() => {
      const pending = pendingUpdateRef.current;
      if (!pending) return;

      lastAddTypeRef.current = pending.addType;
      setEntriesState(pending.entries);
      setEntries(pending.entries);

      // Handle scrolling based on add type
      if (pending.addType === 'plan' && !loading) {
        // Scroll to top of last item for plan mode
        if (pending.entries.length > 0) {
          virtuosoRef.current?.scrollToIndex({
            index: pending.entries.length - 1,
            align: 'start',
            behavior: 'smooth',
          });
        }
      } else if (pending.addType === 'running' && !loading && atBottom) {
        // Auto-scroll to bottom when running and already at bottom
        if (pending.entries.length > 0) {
          virtuosoRef.current?.scrollToIndex({
            index: pending.entries.length - 1,
            align: 'end',
            behavior: 'smooth',
          });
        }
      } else if (pending.addType === 'initial' && pending.entries.length > 0) {
        // Initial load - scroll to bottom
        virtuosoRef.current?.scrollToIndex({
          index: pending.entries.length - 1,
          align: 'end',
          behavior: 'auto',
        });
      }

      if (loading) {
        setLoading(pending.loading);
      }
    }, 100);
  };

  useConversationHistory({ attempt, onEntriesUpdated });

  const messageListContext = useMemo(
    () => ({ attempt, task }),
    [attempt, task]
  );

  // Determine if content is ready to show (has data or finished loading)
  const hasContent = !loading || entries.length > 0;

  return (
    <ApprovalFormProvider>
      <div
        className={cn(
          'h-full transition-opacity duration-300',
          hasContent ? 'opacity-100' : 'opacity-0'
        )}
      >
        <Virtuoso
          ref={virtuosoRef}
          className="h-full scrollbar-none"
          data={entries}
          atBottomStateChange={setAtBottom}
          followOutput={lastAddTypeRef.current === 'running' ? 'smooth' : false}
          initialTopMostItemIndex={entries.length > 0 ? entries.length - 1 : 0}
          computeItemKey={(_index, item) => `conv-${item.patchKey}`}
          components={{
            Header: () => <div className="h-2" />,
            Footer: () => <div className="h-2" />,
          }}
          itemContent={(_index, data) => {
            if (data.type === 'STDOUT') {
              return <p>{data.content}</p>;
            }
            if (data.type === 'STDERR') {
              return <p>{data.content}</p>;
            }
            if (data.type === 'NORMALIZED_ENTRY') {
              return (
                <NewDisplayConversationEntry
                  expansionKey={data.patchKey}
                  entry={data.content}
                  executionProcessId={data.executionProcessId}
                  taskAttempt={messageListContext.attempt}
                  task={messageListContext.task}
                />
              );
            }
            return null;
          }}
        />
      </div>
    </ApprovalFormProvider>
  );
}

export default ConversationList;
