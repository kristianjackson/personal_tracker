/**
 * Tag filter chips component.
 *
 * Shows available tags as clickable chips with an "All" option.
 * Active tag is visually highlighted. Click to toggle.
 *
 * Validates: FR-DB-004
 */

import './TagFilter.css';

interface TagFilterProps {
  tags: readonly string[];
  activeTag: string | null;
  onTagChange: (tag: string | null) => void;
}

export default function TagFilter({ tags, activeTag, onTagChange }: TagFilterProps) {
  return (
    <div className="tag-filter" role="group" aria-label="Filter by tag">
      <button
        className={`tag-filter-chip${activeTag === null ? ' tag-filter-chip--active' : ''}`}
        onClick={() => onTagChange(null)}
        aria-pressed={activeTag === null}
      >
        All
      </button>
      {tags.map((tag) => (
        <button
          key={tag}
          className={`tag-filter-chip${activeTag === tag ? ' tag-filter-chip--active' : ''}`}
          onClick={() => onTagChange(activeTag === tag ? null : tag)}
          aria-pressed={activeTag === tag}
        >
          {tag}
        </button>
      ))}
    </div>
  );
}
