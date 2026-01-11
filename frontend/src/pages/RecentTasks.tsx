import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { formatDistanceToNow } from 'date-fns';
import { Clock, FolderKanban } from 'lucide-react';
import { useRecentTasks } from '@/hooks/useRecentTasks';
import { Loader } from '@/components/ui/loader';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { paths } from '@/lib/paths';
import type { RecentTaskWithProject } from 'shared/types';

const STATUS_COLORS: Record<string, string> = {
  todo: 'bg-gray-100 text-gray-800 border-gray-300',
  inprogress: 'bg-blue-100 text-blue-800 border-blue-300',
  inreview: 'bg-purple-100 text-purple-800 border-purple-300',
  done: 'bg-green-100 text-green-800 border-green-300',
  cancelled: 'bg-red-100 text-red-800 border-red-300',
};

interface GroupedTasks {
  today: RecentTaskWithProject[];
  yesterday: RecentTaskWithProject[];
  thisWeek: RecentTaskWithProject[];
  older: RecentTaskWithProject[];
}

function groupTasksByTime(tasks: RecentTaskWithProject[]): GroupedTasks {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterdayStart = new Date(todayStart);
  yesterdayStart.setDate(yesterdayStart.getDate() - 1);
  const weekStart = new Date(todayStart);
  weekStart.setDate(weekStart.getDate() - 7);

  return tasks.reduce(
    (groups, task) => {
      const activityDate = new Date(task.last_activity_at);

      if (activityDate >= todayStart) {
        groups.today.push(task);
      } else if (activityDate >= yesterdayStart) {
        groups.yesterday.push(task);
      } else if (activityDate >= weekStart) {
        groups.thisWeek.push(task);
      } else {
        groups.older.push(task);
      }

      return groups;
    },
    {
      today: [],
      yesterday: [],
      thisWeek: [],
      older: [],
    } as GroupedTasks
  );
}

interface TaskItemProps {
  task: RecentTaskWithProject;
  onClick: () => void;
}

function TaskItem({ task, onClick }: TaskItemProps) {
  const statusColor = STATUS_COLORS[task.status] || STATUS_COLORS.todo;

  return (
    <div
      onClick={onClick}
      className="group p-4 border border-border rounded-lg hover:bg-accent hover:border-accent-foreground/20 cursor-pointer transition-colors"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <FolderKanban className="h-4 w-4 text-muted-foreground flex-shrink-0" />
            <span className="text-sm text-muted-foreground truncate">
              {task.project_name}
            </span>
          </div>
          <h3 className="font-medium text-foreground mb-2 group-hover:text-accent-foreground">
            {task.title}
          </h3>
          <div className="flex items-center gap-2 flex-wrap">
            <Badge
              variant="outline"
              className={`${statusColor} text-xs px-2 py-0.5`}
            >
              {task.status}
            </Badge>
            {task.has_in_progress_attempt && (
              <Badge
                variant="outline"
                className="bg-blue-50 text-blue-700 border-blue-200 text-xs px-2 py-0.5"
              >
                Running
              </Badge>
            )}
            {task.last_attempt_failed && (
              <Badge
                variant="outline"
                className="bg-red-50 text-red-700 border-red-200 text-xs px-2 py-0.5"
              >
                Failed
              </Badge>
            )}
            <span className="text-xs text-muted-foreground">
              {task.executor}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground flex-shrink-0">
          <Clock className="h-3.5 w-3.5" />
          <span>
            {formatDistanceToNow(new Date(task.last_activity_at), {
              addSuffix: true,
            })}
          </span>
        </div>
      </div>
    </div>
  );
}

interface TaskGroupProps {
  title: string;
  tasks: RecentTaskWithProject[];
  onTaskClick: (task: RecentTaskWithProject) => void;
}

function TaskGroup({ title, tasks, onTaskClick }: TaskGroupProps) {
  if (tasks.length === 0) return null;

  return (
    <div className="space-y-3">
      <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
        {title}
      </h2>
      <div className="space-y-2">
        {tasks.map((task) => (
          <TaskItem
            key={task.id}
            task={task}
            onClick={() => onTaskClick(task)}
          />
        ))}
      </div>
    </div>
  );
}

export function RecentTasks() {
  const navigate = useNavigate();
  const { tasks, isLoading, error } = useRecentTasks({ limit: 50 });

  const groupedTasks = useMemo(() => groupTasksByTime(tasks), [tasks]);

  const handleTaskClick = (task: RecentTaskWithProject) => {
    navigate(paths.task(task.project_id, task.id));
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-full">
        <Card className="max-w-md">
          <CardHeader>
            <CardTitle className="text-destructive">
              Failed to load recent tasks
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">{error.message}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (tasks.length === 0) {
    return (
      <div className="flex items-center justify-center h-full">
        <Card className="max-w-md">
          <CardHeader>
            <CardTitle>No Recent Activity</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Start working on tasks to see them here
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-4xl mx-auto p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Recent Tasks</h1>
            <p className="text-sm text-muted-foreground mt-1">
              {tasks.length} {tasks.length === 1 ? 'task' : 'tasks'} recently
              worked on
            </p>
          </div>
        </div>

        <div className="space-y-8">
          <TaskGroup
            title="Today"
            tasks={groupedTasks.today}
            onTaskClick={handleTaskClick}
          />
          <TaskGroup
            title="Yesterday"
            tasks={groupedTasks.yesterday}
            onTaskClick={handleTaskClick}
          />
          <TaskGroup
            title="This Week"
            tasks={groupedTasks.thisWeek}
            onTaskClick={handleTaskClick}
          />
          <TaskGroup
            title="Older"
            tasks={groupedTasks.older}
            onTaskClick={handleTaskClick}
          />
        </div>
      </div>
    </div>
  );
}
