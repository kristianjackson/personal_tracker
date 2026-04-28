/**
 * Notes page — paginated note list with search, tag filter, and date range.
 *
 * Validates: FR-DB-004
 */

import { useEffect, useState, useCallback, useRef } from 'react';
import type { DateRangePreset } from './trends-helpers.js';
import { daysAgo, todayUTC, resolvePreset } from './trends-helpers.js';
import type { NoteRecord, NotesPagination } from './notes-helpers.js';
import { buildNotesQueryString, PREDEFINED_TAGS } from './notes-helpers.js';
import DateRangeSelector from '../components/DateRangeSelector.js';
import TagFilter from '../components/TagFilter.js';
import NoteCard from '../components/NoteCard.js';
import { apiUrl } from '../api.js';
import './NotesPage.css';

const PAGE_SIZE = 20;
const DEBOUNCE_MS = 300;

export default function NotesPage() {
  /* ── Filter state ────────────────────────────────────────── */
  const [searchText, setSearchText] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [preset, setPreset] = useState<DateRangePreset>('30d');
  const [customStart, setCustomStart] = useState(daysAgo(29));
  const [customEnd, setCustomEnd] = useState(todayUTC());
  const [page, setPage] = useState(1);

  /* ── Data state ──────────────────────────────────────────── */
  const [notes, setNotes] = useState<NoteRecord[]>([]);
  const [pagination, setPagination] = useState<NotesPagination | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const range = resolvePreset(preset, customStart, customEnd);

  /* ── Debounce search input ───────────────────────────────── */
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function handleSearchChange(value: string) {
    setSearchText(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setDebouncedSearch(value);
      setPage(1);
    }, DEBOUNCE_MS);
  }

  /* ── Fetch notes ─────────────────────────────────────────── */
  const fetchNotes = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = buildNotesQueryString({
        page,
        limit: PAGE_SIZE,
        start: range.start,
        end: range.end,
        tag: activeTag || undefined,
        q: debouncedSearch || undefined,
      });
      const res = await fetch(apiUrl(`/api/notes${qs}`));
      if (!res.ok) {
        throw new Error(`API returned ${res.status}`);
      }
      const json = (await res.json()) as { data: NoteRecord[]; pagination: NotesPagination };
      setNotes(json.data);
      setPagination(json.pagination);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load notes');
    } finally {
      setLoading(false);
    }
  }, [page, range.start, range.end, activeTag, debouncedSearch]);

  useEffect(() => {
    fetchNotes();
  }, [fetchNotes]);

  /* ── Filter handlers ─────────────────────────────────────── */
  function handlePresetChange(p: DateRangePreset) {
    setPreset(p);
    setPage(1);
  }

  function handleCustomRangeChange(start: string, end: string) {
    setCustomStart(start);
    setCustomEnd(end);
    setPreset('custom');
    setPage(1);
  }

  function handleTagChange(tag: string | null) {
    setActiveTag(tag);
    setPage(1);
  }

  /* ── Render ──────────────────────────────────────────────── */
  return (
    <div className="page notes">
      <h2>Notes</h2>
      <p className="notes-subtitle">
        Browse and search your notes
      </p>

      {/* Filters */}
      <div className="notes-filters">
        {/* Search */}
        <div className="notes-search">
          <span className="notes-search-icon" aria-hidden="true">🔍</span>
          <input
            type="search"
            className="notes-search-input"
            placeholder="Search notes..."
            value={searchText}
            onChange={(e) => handleSearchChange(e.target.value)}
            aria-label="Search notes"
          />
        </div>

        {/* Tag filter + Date range */}
        <div className="notes-filter-row">
          <div className="notes-filter-section">
            <span className="notes-filter-label">Tags</span>
            <TagFilter
              tags={PREDEFINED_TAGS}
              activeTag={activeTag}
              onTagChange={handleTagChange}
            />
          </div>
        </div>

        <DateRangeSelector
          preset={preset}
          customStart={customStart}
          customEnd={customEnd}
          onPresetChange={handlePresetChange}
          onCustomRangeChange={handleCustomRangeChange}
        />
      </div>

      {/* Loading */}
      {loading && (
        <div className="notes-loading" role="status" aria-live="polite">
          Loading…
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="notes-error" role="alert">
          <p>{error}</p>
          <button className="notes-retry" onClick={fetchNotes}>
            Retry
          </button>
        </div>
      )}

      {/* Empty */}
      {!loading && !error && notes.length === 0 && (
        <div className="notes-empty">
          No notes found for the current filters. Try adjusting your search or date range.
        </div>
      )}

      {/* Note list */}
      {!loading && !error && notes.length > 0 && (
        <>
          <div className="notes-total">
            {pagination ? `${pagination.total} note${pagination.total === 1 ? '' : 's'} found` : ''}
          </div>

          <div className="notes-list" role="list" aria-label="Notes">
            {notes.map((note) => (
              <div key={note.id} role="listitem">
                <NoteCard note={note} />
              </div>
            ))}
          </div>

          {/* Pagination */}
          {pagination && pagination.totalPages > 1 && (
            <nav className="notes-pagination" aria-label="Notes pagination">
              <button
                className="notes-pagination-btn"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                aria-label="Previous page"
              >
                ← Previous
              </button>
              <span className="notes-pagination-info">
                Page {pagination.page} of {pagination.totalPages}
              </span>
              <button
                className="notes-pagination-btn"
                onClick={() => setPage((p) => Math.min(pagination.totalPages, p + 1))}
                disabled={page >= pagination.totalPages}
                aria-label="Next page"
              >
                Next →
              </button>
            </nav>
          )}
        </>
      )}
    </div>
  );
}
