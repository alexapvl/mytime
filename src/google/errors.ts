export function isSyncTokenExpired(err: unknown): boolean {
  const e = err as {
    code?: number | string;
    message?: string;
    response?: {
      status?: number;
      data?: { error?: { message?: string; errors?: { reason?: string }[] } };
    };
  };

  if (e.response?.status === 410) return true;
  if (e.code === 410 || e.code === '410') return true;

  const reasons = e.response?.data?.error?.errors ?? [];
  if (reasons.some((r) => r.reason === 'fullSyncRequired')) return true;

  const msg = [e.message, e.response?.data?.error?.message].filter(Boolean).join(' ');
  return /sync token/i.test(msg) || /full sync is required/i.test(msg);
}

export function errorMessage(err: unknown): string {
  const e = err as { message?: string; response?: { data?: { error?: { message?: string } } } };
  return e.response?.data?.error?.message ?? e.message ?? String(err);
}
