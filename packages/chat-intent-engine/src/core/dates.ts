const MONTHS: Record<string, number> = {
  january: 1,
  jan: 1,
  february: 2,
  feb: 2,
  march: 3,
  mar: 3,
  april: 4,
  apr: 4,
  may: 5,
  june: 6,
  jun: 6,
  july: 7,
  jul: 7,
  august: 8,
  aug: 8,
  september: 9,
  sep: 9,
  sept: 9,
  october: 10,
  oct: 10,
  november: 11,
  nov: 11,
  december: 12,
  dec: 12,
};

const WEEKDAYS: Record<string, number> = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
};

export interface NormalizedDate {
  /** ISO calendar date in `YYYY-MM-DD` form. */
  normalized: string;
  /** Explanation of how the value was derived, for recording assumptions. */
  basis: string;
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function isValidDate(year: number, month: number, day: number): boolean {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return false;
  if (month < 1 || month > 12 || day < 1) return false;
  return day <= new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function isoDate(year: number, month: number, day: number): string {
  return `${year}-${pad(month)}-${pad(day)}`;
}

function fromParts(
  year: number,
  month: number,
  day: number,
  basis: string,
): NormalizedDate | null {
  if (!isValidDate(year, month, day)) return null;
  return { normalized: isoDate(year, month, day), basis };
}

/** Normalize an explicit calendar date such as `2026-07-31`, `July 31, 2026`, or `31 July 2026`. */
export function parseExplicitDate(text: string): NormalizedDate | null {
  const iso = /\b(\d{4})-(\d{2})-(\d{2})\b/.exec(text);
  if (iso) {
    const year = Number(iso[1]);
    const month = Number(iso[2]);
    const day = Number(iso[3]);
    return fromParts(year, month, day, `Used explicit date "${iso[0]}".`);
  }

  const monthFirst = /\b([A-Za-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b/.exec(text);
  if (monthFirst) {
    const month = MONTHS[monthFirst[1]?.toLowerCase() ?? ''];
    const day = Number(monthFirst[2]);
    const year = Number(monthFirst[3]);
    if (month) return fromParts(year, month, day, `Used explicit date "${monthFirst[0]}".`);
  }

  const dayFirst = /\b(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]+),?\s+(\d{4})\b/.exec(text);
  if (dayFirst) {
    const day = Number(dayFirst[1]);
    const month = MONTHS[dayFirst[2]?.toLowerCase() ?? ''];
    const year = Number(dayFirst[3]);
    if (month) return fromParts(year, month, day, `Used explicit date "${dayFirst[0]}".`);
  }

  return null;
}

function shift(baseUtc: number, days: number): string {
  const date = new Date(baseUtc + days * 24 * 60 * 60 * 1000);
  return isoDate(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

/** Normalize a relative date only when an explicit reference date is supplied. */
export function parseRelativeDate(text: string, referenceIso?: string): NormalizedDate | null {
  if (!referenceIso) return null;

  const reference = new Date(referenceIso);
  if (Number.isNaN(reference.getTime())) return null;

  const base = Date.UTC(
    reference.getUTCFullYear(),
    reference.getUTCMonth(),
    reference.getUTCDate(),
  );
  const lower = text.toLowerCase();

  if (/\btoday\b/.test(lower)) {
    return { normalized: shift(base, 0), basis: `Resolved "today" against ${referenceIso}.` };
  }
  if (/\btomorrow\b/.test(lower)) {
    return { normalized: shift(base, 1), basis: `Resolved "tomorrow" against ${referenceIso}.` };
  }
  if (/\byesterday\b/.test(lower)) {
    return { normalized: shift(base, -1), basis: `Resolved "yesterday" against ${referenceIso}.` };
  }

  const inDays = /\bin\s+(\d{1,3})\s+days?\b/.exec(lower);
  if (inDays) {
    const days = Number(inDays[1]);
    return {
      normalized: shift(base, days),
      basis: `Resolved "${inDays[0]}" against ${referenceIso}.`,
    };
  }

  const inWeeks = /\bin\s+(\d{1,2})\s+weeks?\b/.exec(lower);
  if (inWeeks) {
    const days = Number(inWeeks[1]) * 7;
    return {
      normalized: shift(base, days),
      basis: `Resolved "${inWeeks[0]}" against ${referenceIso}.`,
    };
  }

  const next = /\bnext\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/.exec(lower);
  if (next) {
    const target = WEEKDAYS[next[1] ?? ''];
    if (target !== undefined) {
      const current = new Date(base).getUTCDay();
      let delta = (target - current + 7) % 7;
      if (delta === 0) delta = 7;
      return {
        normalized: shift(base, delta),
        basis: `Resolved "${next[0]}" against ${referenceIso}.`,
      };
    }
  }

  const thisWeek = /\bthis\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/.exec(
    lower,
  );
  if (thisWeek) {
    const target = WEEKDAYS[thisWeek[1] ?? ''];
    if (target !== undefined) {
      const current = new Date(base).getUTCDay();
      const delta = (target - current + 7) % 7;
      return {
        normalized: shift(base, delta),
        basis: `Resolved "${thisWeek[0]}" against ${referenceIso}.`,
      };
    }
  }

  return null;
}

/** Try explicit dates first, then relative dates when a reference date is available. */
export function normalizeDate(text: string, referenceIso?: string): NormalizedDate | null {
  return parseExplicitDate(text) ?? parseRelativeDate(text, referenceIso);
}
