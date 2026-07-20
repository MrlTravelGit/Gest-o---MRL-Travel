export type TaskStatus = "open" | "in_progress" | "waiting_client" | "waiting_third_party" | "on_hold" | "completed" | "cancelled";
export type TaskCategory = "onboarding" | "flight_quote" | "hotel_quote" | "reschedule_or_cancel" | "check_in" | "points_expiration" | "transfer" | "complaint" | "client_registration" | "other";

export interface ManagementTask {
  taskId: string;
  clientId: string | null;
  clientName: string | null;
  scope: "client" | "internal";
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: 1 | 2 | 3 | 4;
  category: TaskCategory;
  assignedStaffId: string | null;
  assignedName: string | null;
  startsAt: string | null;
  dueAt: string | null;
  completedAt: string | null;
  timeSpentMinutes: number | null;
  source: string;
  overdue: boolean;
  checklist: Array<{ id: string; content: string; completedAt: string | null; position: number }>;
  createdAt: string;
  updatedAt: string;
}

export interface TaskIndicators {
  open: number;
  overdue: number;
  dueToday: number;
  next7Days: number;
  waitingClient: number;
  completedPeriod: number;
}

export interface ManagementTasksResult {
  items: ManagementTask[];
  total: number;
  limit: number;
  offset: number;
  canWrite: boolean;
  indicators: TaskIndicators;
  staff: Array<{ userId: string; fullName: string }>;
}

export interface ManagementTaskInput {
  clientId?: string;
  scope: "client" | "internal";
  title: string;
  description?: string;
  status: TaskStatus;
  priority: number;
  category: TaskCategory;
  assignedStaffId?: string;
  startsAt?: string;
  dueAt?: string;
  timeSpentMinutes?: number;
  checklist?: string[];
}

export interface TaskFilters {
  clientId?: string;
  search?: string;
  status?: string;
  priority?: number;
  category?: string;
  assignedStaffId?: string;
  source?: string;
  dueFrom?: string;
  dueTo?: string;
  sort?: "priority" | "due_at" | "updated_at" | "created_at";
  direction?: "asc" | "desc";
  limit?: number;
  offset?: number;
}
