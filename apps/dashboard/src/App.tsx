import { ORDINAL_MIN, ORDINAL_MAX } from '@symptom-tracker/shared';

export default function App() {
  return (
    <div>
      <h1>Symptom Tracker Dashboard</h1>
      <p>
        Ordinal scale: {ORDINAL_MIN}–{ORDINAL_MAX}
      </p>
    </div>
  );
}
