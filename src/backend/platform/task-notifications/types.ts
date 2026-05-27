export type TaskNotificationType = 'task-completed' | 'task-failed';
export type TaskNotificationSeverity = 'success' | 'error';

export interface TaskNotificationRecord {
  notificationId: string;
  dedupeKey: string;
  type: TaskNotificationType;
  severity: TaskNotificationSeverity;
  taskId: string;
  taskGuid: string | null;
  taskTitle: string | null;
  taskFileName: string | null;
  contextPackId: string | null;
  contextPackDir: string | null;
  contextPackLabel: string | null;
  archivePath: string | null;
  errorItemPath: string | null;
  createdAt: string;
  seenAt: string | null;
  dismissedAt: string | null;
  message: string;
}

export interface TaskNotificationStore {
  schemaVersion: 1;
  notifications: TaskNotificationRecord[];
}

export interface TaskNotificationSnapshot {
  action: 'taskNotifications.read';
  mode: 'read-only';
  unseenCount: number;
  notifications: TaskNotificationRecord[];
  generatedAt: string;
  message: string;
}

export interface TaskNotificationMutationResponse {
  action:
    | 'taskNotifications.markSeen'
    | 'taskNotifications.dismiss'
    | 'taskNotifications.dismissAll';
  mode: 'updated';
  unseenCount: number;
  notifications: TaskNotificationRecord[];
  generatedAt: string;
  message: string;
}

export type TaskNotificationEvent = {
  type: 'snapshot';
  snapshot: TaskNotificationSnapshot;
};
