// ============================================================================
// CALENDAR ENGINE (src/calendarEngine.js)
// Phase 9.2 — Real Tomorrow Launch Discovery Engine
// Calculates calendar target dates for tomorrow in specified timezone,
// and classifies expected launch dates.
// ============================================================================

import { config } from './config.js';

/**
 * Formats a Date object or timestamp into YYYY-MM-DD in the given IANA timezone (or UTC).
 * @param {Date|number} dateObj 
 * @param {string} timezone 
 * @returns {string} ISO date string YYYY-MM-DD
 */
export function formatDateInTimezone(dateObj, timezone = 'UTC') {
  const d = dateObj instanceof Date ? dateObj : new Date(dateObj);
  if (isNaN(d.getTime())) return null;

  try {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone || 'UTC',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    });
    return formatter.format(d); // Returns YYYY-MM-DD in en-CA format
  } catch (err) {
    // Fallback to UTC if timezone string is invalid
    const year = d.getUTCFullYear();
    const month = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
}

/**
 * Calculates TARGET_DATE = LOCAL_TODAY + 1 CALENDAR DAY in PRELAUNCH_TIMEZONE.
 * @param {number|Date} [nowInput] 
 * @param {string} [tzInput] 
 * @returns {{ todayDateStr: string, tomorrowDateStr: string, timezone: string, timestampMs: number }}
 */
export function calculateTomorrowTargetDate(nowInput = Date.now(), tzInput = null) {
  const timezone = tzInput || config.prelaunchTimezone || 'UTC';
  const now = nowInput instanceof Date ? nowInput : new Date(nowInput);

  const todayDateStr = formatDateInTimezone(now, timezone);

  // Add 1 calendar day (24h offset standard for date rollover calculation, then format in timezone)
  const tomorrowDateObj = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  let tomorrowDateStr = formatDateInTimezone(tomorrowDateObj, timezone);

  // If adding 24h landed on same date due to timezone boundaries, add up to 48h to cross midnight boundary
  if (tomorrowDateStr === todayDateStr) {
    const nextDayObj = new Date(now.getTime() + 36 * 60 * 60 * 1000);
    tomorrowDateStr = formatDateInTimezone(nextDayObj, timezone);
  }

  return {
    todayDateStr,
    tomorrowDateStr,
    timezone,
    timestampMs: now.getTime()
  };
}

/**
 * Classifies an expected launch date string or timestamp against target dates.
 * 
 * @param {string|number} expectedLaunchInput - Date string (YYYY-MM-DD or ISO) or epoch ms
 * @param {string} targetTomorrowStr - Target tomorrow date YYYY-MM-DD
 * @param {string} targetTodayStr - Target today date YYYY-MM-DD
 * @param {string} [timezone] - Timezone
 * @returns {{ status: 'TOMORROW'|'TODAY'|'PAST'|'FUTURE_FAR'|'INVALID', parsedDateStr: string|null }}
 */
export function classifyLaunchDate(expectedLaunchInput, targetTomorrowStr, targetTodayStr, timezone = 'UTC') {
  if (!expectedLaunchInput) {
    return { status: 'INVALID', parsedDateStr: null };
  }

  let parsedDateStr = null;

  if (typeof expectedLaunchInput === 'number') {
    parsedDateStr = formatDateInTimezone(new Date(expectedLaunchInput), timezone);
  } else if (typeof expectedLaunchInput === 'string') {
    // If input is YYYY-MM-DD format directly
    if (/^\d{4}-\d{2}-\d{2}$/.test(expectedLaunchInput.trim())) {
      parsedDateStr = expectedLaunchInput.trim();
    } else {
      const parsed = new Date(expectedLaunchInput);
      if (!isNaN(parsed.getTime())) {
        parsedDateStr = formatDateInTimezone(parsed, timezone);
      }
    }
  }

  if (!parsedDateStr) {
    return { status: 'INVALID', parsedDateStr: null };
  }

  if (parsedDateStr === targetTomorrowStr) {
    return { status: 'TOMORROW', parsedDateStr };
  }

  if (parsedDateStr === targetTodayStr) {
    return { status: 'TODAY', parsedDateStr };
  }

  if (parsedDateStr < targetTodayStr) {
    return { status: 'PAST', parsedDateStr };
  }

  return { status: 'FUTURE_FAR', parsedDateStr };
}
