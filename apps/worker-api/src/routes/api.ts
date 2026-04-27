import { Hono } from 'hono';
import type { Env } from '../index';

/**
 * Dashboard API routes.
 *
 * All endpoints are protected by Cloudflare Access JWT middleware
 * (applied in index.ts before this router is mounted).
 *
 * Validates: FR-DB-001, FR-DB-004, FR-DB-005, FR-DB-006
 * Design: Section 10.1
 */

type ApiEnv = { Bindings: Env; Variables: { userEmail: string } };

export const apiRoutes = new Hono<ApiEnv>();

// ── Helpers ─────────────────────────────────────────────────────────

/** Return YYYY-MM-DD for `daysAgo` days before today (UTC). */
function defaultStart(daysAgo = 30): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - daysAgo);
  return d.toISOString().slice(0, 10);
}

function todayUTC(): string {
  return new Date().toISOString().slice(0, 10);
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isValidDate(v: string): boolean {
  return DATE_RE.test(v) && !isNaN(Date.parse(v));
}

function clampLimit(raw: string | undefined, defaultVal: number, max: number): number {
  if (!raw) return defaultVal;
  const n = parseInt(raw, 10);
  if (isNaN(n) || n < 1) return defaultVal;
  return Math.min(n, max);
}

function parsePage(raw: string | undefined): number {
  if (!raw) return 1;
  const n = parseInt(raw, 10);
  return isNaN(n) || n < 1 ? 1 : n;
}

// ── GET /overview ───────────────────────────────────────────────────

apiRoutes.get('/overview', async (c) => {
  const db = c.env.DB;
  const start = c.req.query('start') || defaultStart(30);
  const end = c.req.query('end') || todayUTC();

  if (!isValidDate(start) || !isValidDate(end)) {
    return c.json({ error: 'Invalid date format. Use YYYY-MM-DD.' }, 400);
  }

  // Total check-ins in range
  const totalRow = await db
    .prepare('SELECT COUNT(*) AS cnt FROM daily_checkin WHERE checkin_date >= ? AND checkin_date <= ?')
    .bind(start, end)
    .first<{ cnt: number }>();
  const totalCheckins = totalRow?.cnt ?? 0;

  // Days in range (inclusive)
  const startMs = new Date(start).getTime();
  const endMs = new Date(end).getTime();
  const totalDays = Math.max(1, Math.floor((endMs - startMs) / 86_400_000) + 1);

  // Completion rate
  const completionRate = Math.round((totalCheckins / totalDays) * 100) / 100;

  // Current streak: consecutive days with check-ins ending today (or most recent)
  const streakRows = await db
    .prepare(
      'SELECT checkin_date FROM daily_checkin WHERE checkin_date <= ? ORDER BY checkin_date DESC LIMIT 365',
    )
    .bind(end)
    .all<{ checkin_date: string }>();

  let streak = 0;
  if (streakRows.results && streakRows.results.length > 0) {
    let expected = new Date(end);
    for (const row of streakRows.results) {
      const rowDate = row.checkin_date;
      const expectedStr = expected.toISOString().slice(0, 10);
      if (rowDate === expectedStr) {
        streak++;
        expected.setUTCDate(expected.getUTCDate() - 1);
      } else if (rowDate < expectedStr) {
        // Gap found — streak broken
        break;
      }
    }
  }

  // Note count in range
  const noteRow = await db
    .prepare('SELECT COUNT(*) AS cnt FROM note WHERE created_at >= ? AND created_at <= ?')
    .bind(start + 'T00:00:00Z', end + 'T23:59:59Z')
    .first<{ cnt: number }>();
  const noteCount = noteRow?.cnt ?? 0;

  // Active flag count
  const flagRow = await db
    .prepare('SELECT COUNT(*) AS cnt FROM analytic_flag WHERE dismissed_at IS NULL')
    .first<{ cnt: number }>();
  const activeFlagCount = flagRow?.cnt ?? 0;

  // Last check-in
  const lastCheckin = await db
    .prepare('SELECT checkin_date, created_at FROM daily_checkin ORDER BY checkin_date DESC LIMIT 1')
    .first<{ checkin_date: string; created_at: string }>();

  return c.json({
    data: {
      totalCheckins,
      completionRate,
      streak,
      noteCount,
      activeFlagCount,
      lastCheckinDate: lastCheckin?.checkin_date ?? null,
      lastCheckinAt: lastCheckin?.created_at ?? null,
      periodStart: start,
      periodEnd: end,
    },
  });
});

// ── GET /checkins ───────────────────────────────────────────────────

apiRoutes.get('/checkins', async (c) => {
  const db = c.env.DB;
  const start = c.req.query('start');
  const end = c.req.query('end');

  if (!start || !end) {
    return c.json({ error: 'start and end query params are required (YYYY-MM-DD).' }, 400);
  }
  if (!isValidDate(start) || !isValidDate(end)) {
    return c.json({ error: 'Invalid date format. Use YYYY-MM-DD.' }, 400);
  }

  const checkins = await db
    .prepare(
      `SELECT id, user_id, checkin_date, status, source, is_retroactive, created_at, updated_at
       FROM daily_checkin
       WHERE checkin_date >= ? AND checkin_date <= ?
       ORDER BY checkin_date DESC`,
    )
    .bind(start, end)
    .all<{
      id: string;
      user_id: string;
      checkin_date: string;
      status: string;
      source: string;
      is_retroactive: number;
      created_at: string;
      updated_at: string;
    }>();

  // Fetch observations for each check-in
  const results = [];
  for (const ci of checkins.results ?? []) {
    const obs = await db
      .prepare(
        `SELECT id, variable_code, value_numeric, value_text, scale_min, scale_max, skipped, entered_at
         FROM symptom_observation
         WHERE daily_checkin_id = ?
         ORDER BY entered_at ASC`,
      )
      .bind(ci.id)
      .all<{
        id: string;
        variable_code: string;
        value_numeric: number | null;
        value_text: string | null;
        scale_min: number | null;
        scale_max: number | null;
        skipped: number;
        entered_at: string;
      }>();

    results.push({
      ...ci,
      observations: obs.results ?? [],
    });
  }

  return c.json({ data: results });
});

// ── GET /notes ──────────────────────────────────────────────────────

apiRoutes.get('/notes', async (c) => {
  const db = c.env.DB;
  const start = c.req.query('start');
  const end = c.req.query('end');
  const tag = c.req.query('tag');
  const q = c.req.query('q');
  const page = parsePage(c.req.query('page'));
  const limit = clampLimit(c.req.query('limit'), 20, 100);
  const offset = (page - 1) * limit;

  // Build WHERE clauses
  const conditions: string[] = [];
  const params: (string | number)[] = [];

  if (start) {
    if (!isValidDate(start)) {
      return c.json({ error: 'Invalid start date format. Use YYYY-MM-DD.' }, 400);
    }
    conditions.push('created_at >= ?');
    params.push(start + 'T00:00:00Z');
  }
  if (end) {
    if (!isValidDate(end)) {
      return c.json({ error: 'Invalid end date format. Use YYYY-MM-DD.' }, 400);
    }
    conditions.push('created_at <= ?');
    params.push(end + 'T23:59:59Z');
  }
  if (tag) {
    // Use LIKE on the JSON tags array — matches tags containing the value
    conditions.push("tags LIKE ?");
    params.push(`%"${tag}"%`);
  }
  if (q) {
    conditions.push('body LIKE ?');
    params.push(`%${q}%`);
  }

  const whereClause = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';

  // Count total for pagination
  const countStmt = db.prepare(`SELECT COUNT(*) AS cnt FROM note ${whereClause}`);
  const countRow = await countStmt.bind(...params).first<{ cnt: number }>();
  const total = countRow?.cnt ?? 0;

  // Fetch page
  const dataStmt = db.prepare(
    `SELECT id, user_id, daily_checkin_id, body, tags, source, created_at
     FROM note ${whereClause}
     ORDER BY created_at DESC
     LIMIT ? OFFSET ?`,
  );
  const rows = await dataStmt.bind(...params, limit, offset).all<{
    id: string;
    user_id: string;
    daily_checkin_id: string | null;
    body: string;
    tags: string | null;
    source: string;
    created_at: string;
  }>();

  // Parse tags JSON
  const notes = (rows.results ?? []).map((row) => ({
    ...row,
    tags: row.tags ? JSON.parse(row.tags) : [],
  }));

  return c.json({
    data: notes,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  });
});

// ── GET /medications ────────────────────────────────────────────────

apiRoutes.get('/medications', async (c) => {
  const db = c.env.DB;
  const start = c.req.query('start') || defaultStart(30);
  const end = c.req.query('end') || todayUTC();

  if (!isValidDate(start) || !isValidDate(end)) {
    return c.json({ error: 'Invalid date format. Use YYYY-MM-DD.' }, 400);
  }

  // Events with medication display name
  const events = await db
    .prepare(
      `SELECT me.id, me.user_id, me.medication_definition_id, me.event_type,
              me.dose_value, me.dose_unit, me.injection_site, me.event_at,
              me.event_date, me.created_at,
              md.display_name, md.code AS medication_code, md.route
       FROM medication_event me
       JOIN medication_definition md ON me.medication_definition_id = md.id
       WHERE me.event_date >= ? AND me.event_date <= ?
       ORDER BY me.event_date DESC, me.event_at DESC`,
    )
    .bind(start, end)
    .all();

  // Adherence: per-medication summary
  const adherenceRows = await db
    .prepare(
      `SELECT md.id AS medication_id, md.display_name, md.code,
              SUM(CASE WHEN me.event_type = 'taken' THEN 1 ELSE 0 END) AS taken,
              SUM(CASE WHEN me.event_type = 'missed' THEN 1 ELSE 0 END) AS missed,
              SUM(CASE WHEN me.event_type = 'injected' THEN 1 ELSE 0 END) AS injected,
              COUNT(*) AS total
       FROM medication_event me
       JOIN medication_definition md ON me.medication_definition_id = md.id
       WHERE me.event_date >= ? AND me.event_date <= ?
       GROUP BY md.id`,
    )
    .bind(start, end)
    .all<{
      medication_id: string;
      display_name: string;
      code: string;
      taken: number;
      missed: number;
      injected: number;
      total: number;
    }>();

  const adherence = (adherenceRows.results ?? []).map((row) => {
    const adherentEvents = row.taken + row.injected;
    const rate = row.total > 0 ? Math.round((adherentEvents / row.total) * 100) / 100 : 0;
    return {
      medicationId: row.medication_id,
      displayName: row.display_name,
      code: row.code,
      taken: row.taken,
      missed: row.missed,
      injected: row.injected,
      total: row.total,
      adherenceRate: rate,
    };
  });

  // Side effects in range
  const sideEffects = await db
    .prepare(
      `SELECT id, user_id, linked_medication_event_id, variable_code,
              severity, observed_date, observed_at
       FROM side_effect_observation
       WHERE observed_date >= ? AND observed_date <= ?
       ORDER BY observed_date DESC`,
    )
    .bind(start, end)
    .all();

  return c.json({
    data: {
      events: events.results ?? [],
      adherence,
      sideEffects: sideEffects.results ?? [],
    },
  });
});

// ── GET /flags ──────────────────────────────────────────────────────

apiRoutes.get('/flags', async (c) => {
  const db = c.env.DB;
  const status = c.req.query('status') || 'active';

  if (!['active', 'dismissed', 'all'].includes(status)) {
    return c.json({ error: "status must be 'active', 'dismissed', or 'all'." }, 400);
  }

  let whereClause = '';
  if (status === 'active') {
    whereClause = 'WHERE dismissed_at IS NULL';
  } else if (status === 'dismissed') {
    whereClause = 'WHERE dismissed_at IS NOT NULL';
  }

  const rows = await db
    .prepare(
      `SELECT id, user_id, flag_code, started_on, ended_on, severity,
              explanation, dismissed_at, created_at
       FROM analytic_flag ${whereClause}
       ORDER BY created_at DESC`,
    )
    .all<{
      id: string;
      user_id: string;
      flag_code: string;
      started_on: string;
      ended_on: string | null;
      severity: string;
      explanation: string;
      dismissed_at: string | null;
      created_at: string;
    }>();

  // Parse explanation JSON
  const flags = (rows.results ?? []).map((row) => {
    let explanationParsed: unknown = row.explanation;
    try {
      explanationParsed = JSON.parse(row.explanation);
    } catch {
      // Keep as string if not valid JSON
    }
    return {
      ...row,
      explanation: explanationParsed,
    };
  });

  return c.json({ data: flags });
});

// ── GET /reports ────────────────────────────────────────────────────

apiRoutes.get('/reports', async (c) => {
  const db = c.env.DB;

  const rows = await db
    .prepare(
      `SELECT id, user_id, report_type, period_start, period_end,
              r2_pdf_key, r2_csv_key, generated_at, generator
       FROM summary_report
       ORDER BY generated_at DESC`,
    )
    .all();

  return c.json({ data: rows.results ?? [] });
});

// ── GET /reports/:id/download ───────────────────────────────────────

apiRoutes.get('/reports/:id/download', async (c) => {
  const db = c.env.DB;
  const bucket = c.env.BUCKET;
  const reportId = c.req.param('id');
  const type = c.req.query('type') || 'pdf';

  if (!['pdf', 'csv'].includes(type)) {
    return c.json({ error: "type must be 'pdf' or 'csv'." }, 400);
  }

  const report = await db
    .prepare('SELECT id, r2_pdf_key, r2_csv_key FROM summary_report WHERE id = ?')
    .bind(reportId)
    .first<{ id: string; r2_pdf_key: string | null; r2_csv_key: string | null }>();

  if (!report) {
    return c.json({ error: 'Report not found.' }, 404);
  }

  const r2Key = type === 'pdf' ? report.r2_pdf_key : report.r2_csv_key;
  if (!r2Key) {
    return c.json({ error: `No ${type.toUpperCase()} file available for this report.` }, 404);
  }

  // Fetch the object from R2 and stream it back
  const object = await bucket.get(r2Key);
  if (!object) {
    return c.json({ error: 'File not found in storage.' }, 404);
  }

  const contentType = type === 'pdf' ? 'application/pdf' : 'text/csv';
  const filename = `report-${reportId}.${type}`;

  return new Response(object.body, {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'private, no-cache',
    },
  });
});
