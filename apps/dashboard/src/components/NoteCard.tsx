/**
 * Expandable note card component.
 *
 * Shows truncated body when collapsed, full body when expanded.
 * Displays tags as colored chips, formatted date, and source indicator.
 *
 * Validates: FR-DB-004
 */

import { useState } from 'react';
import type { NoteRecord } from '../pages/notes-helpers.js';
import { formatNoteDate, truncateBody } from '../pages/notes-helpers.js';
import './NoteCard.css';

interface NoteCardProps {
  note: NoteRecord;
}

/** Deterministic color for a tag based on its name. */
const TAG_COLORS = [
  '#6366f1', // indigo
  '#10b981', // emerald
  '#f59e0b', // amber
  '#ef4444', // red
  '#3b82f6', // blue
  '#ec4899', // pink
  '#8b5cf6', // violet
  '#14b8a6', // teal
  '#f97316', // orange
];

function tagColor(tag: string): string {
  let hash = 0;
  for (let i = 0; i < tag.length; i++) {
    hash = tag.charCodeAt(i) + ((hash << 5) - hash);
  }
  return TAG_COLORS[Math.abs(hash) % TAG_COLORS.length];
}

const SOURCE_LABELS: Record<string, string> = {
  whatsapp: '💬 WhatsApp',
  dashboard: '🖥️ Dashboard',
  api: '🔗 API',
};

export default function NoteCard({ note }: NoteCardProps) {
  const [expanded, setExpanded] = useState(false);
  const needsTruncation = note.body.length > 150;
  const displayBody = expanded ? note.body : truncateBody(note.body, 150);

  return (
    <div className="note-card">
      <button
        className="note-card-toggle"
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
        aria-label={expanded ? 'Collapse note' : 'Expand note'}
      >
        <span className="note-card-expand-icon" aria-hidden="true">
          {expanded ? '▾' : '▸'}
        </span>
      </button>

      <div className="note-card-content">
        <div className="note-card-meta">
          <time className="note-card-date" dateTime={note.created_at}>
            {formatNoteDate(note.created_at)}
          </time>
          <span className="note-card-source">
            {SOURCE_LABELS[note.source] || note.source}
          </span>
        </div>

        <div
          className={`note-card-body${expanded ? ' note-card-body--expanded' : ''}`}
          onClick={() => setExpanded(!expanded)}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              setExpanded(!expanded);
            }
          }}
          aria-expanded={expanded}
          aria-label={expanded ? 'Click to collapse note' : 'Click to expand note'}
        >
          {displayBody}
          {needsTruncation && !expanded && (
            <span className="note-card-read-more"> Read more</span>
          )}
        </div>

        {note.tags.length > 0 && (
          <div className="note-card-tags" aria-label="Note tags">
            {note.tags.map((tag) => (
              <span
                key={tag}
                className="note-card-tag"
                style={{ backgroundColor: tagColor(tag) + '1a', color: tagColor(tag) }}
              >
                {tag}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
