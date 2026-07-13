import type { CalendarProviderAdapter, ProviderStatus } from './types.js';
import { getGoogleSetupStatus } from '../lib/googleSetup.js';
import { isAuthenticated } from '../google/auth.js';
import { deleteMytimeGoogleCalendar } from '../google/calendar.js';
import { pushLocalItem, removeFromGoogle, syncWithGoogle } from '../google/sync.js';

function status(): ProviderStatus {
  const setup = getGoogleSetupStatus();
  return {
    provider: 'google',
    configured: Boolean(setup.credentials && setup.credentialsValidation?.ok !== false),
    connected: isAuthenticated(),
    detail: setup.ready ? 'Google Calendar connected' : 'Run: mytime setup google',
  };
}

export const googleProvider: CalendarProviderAdapter = {
  status,
  sync: syncWithGoogle,
  push: pushLocalItem,
  remove: removeFromGoogle,
  deleteMytimeCalendar: deleteMytimeGoogleCalendar,
};
