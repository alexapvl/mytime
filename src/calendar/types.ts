import type { Item } from '../db/types.js';

export type CalendarProvider = 'google' | 'apple';

export type SyncResult = {
  pushed: number;
  pulled: number;
  deleted: number;
  calendars: number;
  errors: string[];
};

export type ProviderStatus = {
  provider: CalendarProvider;
  configured: boolean;
  connected: boolean;
  detail?: string;
};

export type ProviderCalendarInfo = {
  id: string;
  summary: string;
  primary?: boolean;
  sourceTitle?: string;
  enabled: boolean;
  locked: boolean;
};

export type CalendarProviderAdapter = {
  status(): Promise<ProviderStatus> | ProviderStatus;
  sync(): Promise<SyncResult>;
  push(item: Item): Promise<boolean>;
  remove(item: Item): Promise<void>;
  deleteMytimeCalendar(): Promise<boolean>;
};
