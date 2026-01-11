-- Add index for recent task queries
-- This index supports efficient sorting by workspace activity for recent task views
CREATE INDEX IF NOT EXISTS idx_workspaces_task_updated ON workspaces(task_id, updated_at DESC);
