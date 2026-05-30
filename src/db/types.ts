export type ItemStatus = 'open' | 'done';
export type ItemPriority = 0 | 1 | 2 | 3;

export type ItemSource = 'task' | 'external';

export type Item = {
  id: string;
  title: string;
  notes?: string;
  project?: string;
  tags: string[];
  priority: ItemPriority;
  status: ItemStatus;
  source: ItemSource;
  start?: string;
  end?: string;
  allDay: boolean;
  googleEventId?: string;
  googleCalendarId?: string;
  syncedAt?: string;
  updatedAt: string;
  createdAt: string;
  completedAt?: string;
};

export type ItemRow = {
  id: string;
  title: string;
  notes: string | null;
  project: string | null;
  tags: string;
  priority: number;
  status: string;
  source: string;
  start: string | null;
  end: string | null;
  all_day: number;
  google_event_id: string | null;
  google_calendar_id: string | null;
  synced_at: string | null;
  updated_at: string;
  created_at: string;
  completed_at: string | null;
};

export function rowToItem(row: ItemRow): Item {
  return {
    id: row.id,
    title: row.title,
    notes: row.notes ?? undefined,
    project: row.project ?? undefined,
    tags: row.tags ? JSON.parse(row.tags) : [],
    priority: row.priority as ItemPriority,
    status: row.status as ItemStatus,
    source: (row.source as ItemSource) || 'task',
    start: row.start ?? undefined,
    end: row.end ?? undefined,
    allDay: Boolean(row.all_day),
    googleEventId: row.google_event_id ?? undefined,
    googleCalendarId: row.google_calendar_id ?? undefined,
    syncedAt: row.synced_at ?? undefined,
    updatedAt: row.updated_at,
    createdAt: row.created_at,
    completedAt: row.completed_at ?? undefined,
  };
}

export function itemToRow(item: Item): ItemRow {
  return {
    id: item.id,
    title: item.title,
    notes: item.notes ?? null,
    project: item.project ?? null,
    tags: JSON.stringify(item.tags),
    priority: item.priority,
    status: item.status,
    source: item.source,
    start: item.start ?? null,
    end: item.end ?? null,
    all_day: item.allDay ? 1 : 0,
    google_event_id: item.googleEventId ?? null,
    google_calendar_id: item.googleCalendarId ?? null,
    synced_at: item.syncedAt ?? null,
    updated_at: item.updatedAt,
    created_at: item.createdAt,
    completed_at: item.completedAt ?? null,
  };
}
