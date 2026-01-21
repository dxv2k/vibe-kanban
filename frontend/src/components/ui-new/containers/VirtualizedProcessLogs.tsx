import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Virtuoso, VirtuosoHandle } from 'react-virtuoso';
import { WarningCircleIcon } from '@phosphor-icons/react/dist/ssr';
import RawLogText from '@/components/common/RawLogText';
import type { PatchType } from 'shared/types';

export type LogEntry = Extract<
  PatchType,
  { type: 'STDOUT' } | { type: 'STDERR' }
>;

export interface VirtualizedProcessLogsProps {
  logs: LogEntry[];
  error: string | null;
  searchQuery?: string;
  matchIndices?: number[];
  currentMatchIndex?: number;
}

type LogEntryWithKey = LogEntry & { key: string; originalIndex: number };

export function VirtualizedProcessLogs({
  logs,
  error,
  searchQuery,
  matchIndices,
  currentMatchIndex,
}: VirtualizedProcessLogsProps) {
  const { t } = useTranslation('tasks');
  const virtuosoRef = useRef<VirtuosoHandle>(null);
  const [logsWithKeys, setLogsWithKeys] = useState<LogEntryWithKey[]>([]);
  const prevLogsLengthRef = useRef(0);
  const prevCurrentMatchRef = useRef<number | undefined>(undefined);
  const [atBottom, setAtBottom] = useState(true);

  useEffect(() => {
    const timeoutId = setTimeout(() => {
      // Add keys and original index to log entries
      const newLogsWithKeys: LogEntryWithKey[] = logs.map((entry, index) => ({
        ...entry,
        key: `log-${index}`,
        originalIndex: index,
      }));

      setLogsWithKeys(newLogsWithKeys);

      // Auto-scroll to bottom on initial load or when new logs arrive (if already at bottom)
      if (
        (prevLogsLengthRef.current === 0 && logs.length > 0) ||
        (logs.length > prevLogsLengthRef.current && atBottom)
      ) {
        virtuosoRef.current?.scrollToIndex({
          index: logs.length - 1,
          align: 'end',
          behavior: 'smooth',
        });
      }

      prevLogsLengthRef.current = logs.length;
    }, 100);

    return () => clearTimeout(timeoutId);
  }, [logs, atBottom]);

  // Scroll to current match when it changes
  useEffect(() => {
    if (
      matchIndices &&
      matchIndices.length > 0 &&
      currentMatchIndex !== undefined &&
      currentMatchIndex !== prevCurrentMatchRef.current
    ) {
      const logIndex = matchIndices[currentMatchIndex];
      virtuosoRef.current?.scrollToIndex({
        index: logIndex,
        align: 'center',
        behavior: 'smooth',
      });
      prevCurrentMatchRef.current = currentMatchIndex;
    }
  }, [currentMatchIndex, matchIndices]);

  if (logs.length === 0 && !error) {
    return (
      <div className="h-full flex items-center justify-center">
        <p className="text-center text-muted-foreground text-sm">
          {t('processes.noLogsAvailable')}
        </p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="h-full flex items-center justify-center">
        <p className="text-center text-destructive text-sm">
          <WarningCircleIcon className="size-icon-base inline mr-2" />
          {error}
        </p>
      </div>
    );
  }

  return (
    <div className="h-full">
      <Virtuoso
        ref={virtuosoRef}
        className="h-full"
        data={logsWithKeys}
        atBottomStateChange={setAtBottom}
        followOutput="smooth"
        initialTopMostItemIndex={logsWithKeys.length > 0 ? logsWithKeys.length - 1 : 0}
        computeItemKey={(_index, item) => item.key}
        itemContent={(_index, data) => {
          const isMatch = matchIndices?.includes(data.originalIndex) ?? false;
          const isCurrentMatch =
            matchIndices?.[currentMatchIndex ?? -1] === data.originalIndex;

          return (
            <RawLogText
              content={data.content}
              channel={data.type === 'STDERR' ? 'stderr' : 'stdout'}
              className="text-sm px-4 py-1"
              linkifyUrls
              searchQuery={isMatch ? searchQuery : undefined}
              isCurrentMatch={isCurrentMatch}
            />
          );
        }}
      />
    </div>
  );
}
