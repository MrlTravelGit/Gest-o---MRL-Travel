export type ExpirationAlertType = "points_expiration" | "management_expiration";
export type ExpirationAlertStatus = "pending" | "sent" | "failed";

export interface ExpirationAlertSettings {
  pointsEnabled: boolean;
  managementEnabled: boolean;
  thresholdDays: number[];
  dailyTime: string;
  timezone: string;
  lastRunAt: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
  updatedAt: string;
}

export interface ExpirationAlertHistoryItem {
  id: string;
  alertType: ExpirationAlertType;
  clientId: string;
  clientName?: string;
  programName: string;
  pointsAmount: number | null;
  expiresAt: string;
  thresholdDays: number;
  sentAt: string | null;
  status: ExpirationAlertStatus;
  errorMessage: string | null;
  createdAt: string;
}

export interface ExpirationAlertsDashboard {
  telegram: { tokenConfigured: boolean; chatConfigured: boolean; chatIdMasked: string | null };
  settings: ExpirationAlertSettings;
  summary: { awaiting: number; sent: number; failed: number; lastSentAt: string | null };
  history: ExpirationAlertHistoryItem[];
}

export interface ClientAlertSchedule {
  type: ExpirationAlertType;
  programName: string;
  pointsAmount: number | null;
  expiresAt: string;
  nextThresholdDays: number | null;
}

export interface ClientExpirationAlerts {
  client: { id: string; fullName: string; status: string };
  settings: Pick<ExpirationAlertSettings, "thresholdDays" | "pointsEnabled" | "managementEnabled" | "timezone">;
  schedules: ClientAlertSchedule[];
  history: ExpirationAlertHistoryItem[];
}
