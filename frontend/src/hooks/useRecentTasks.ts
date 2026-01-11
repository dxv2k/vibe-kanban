import { useState, useEffect } from 'react';
import { RecentTaskWithProject } from '../../../shared/types';

interface UseRecentTasksOptions {
  projectIds?: string[];
  limit?: number;
  enabled?: boolean;
}

interface UseRecentTasksReturn {
  tasks: RecentTaskWithProject[];
  isLoading: boolean;
  error: Error | null;
  refetch: () => Promise<void>;
}

export function useRecentTasks(
  options: UseRecentTasksOptions = {}
): UseRecentTasksReturn {
  const { projectIds, limit = 50, enabled = true } = options;
  const [tasks, setTasks] = useState<RecentTaskWithProject[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchTasks = async () => {
    if (!enabled) {
      setIsLoading(false);
      return;
    }

    try {
      setIsLoading(true);
      setError(null);

      const params = new URLSearchParams();
      if (projectIds && projectIds.length > 0) {
        params.append('project_ids', projectIds.join(','));
      }
      params.append('limit', limit.toString());

      const response = await fetch(`/api/tasks/recent?${params.toString()}`);

      if (!response.ok) {
        throw new Error(`Failed to fetch recent tasks: ${response.statusText}`);
      }

      const data = await response.json();
      setTasks(data.data || []);
    } catch (err) {
      setError(
        err instanceof Error ? err : new Error('Unknown error fetching tasks')
      );
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchTasks();
  }, [enabled, projectIds?.join(','), limit]);

  return {
    tasks,
    isLoading,
    error,
    refetch: fetchTasks,
  };
}
