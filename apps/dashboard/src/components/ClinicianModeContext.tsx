import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';
import { readPersistedState, persistState } from './clinician-mode-helpers.js';

export interface ClinicianModeState {
  /** Whether clinician summary mode is active. */
  enabled: boolean;
  /** Toggle clinician mode on/off. */
  toggle: () => void;
}

const ClinicianModeContext = createContext<ClinicianModeState>({
  enabled: false,
  toggle: () => {},
});

export function ClinicianModeProvider({ children }: { children: ReactNode }) {
  const [enabled, setEnabled] = useState(readPersistedState);

  const toggle = useCallback(() => {
    setEnabled((prev) => {
      const next = !prev;
      persistState(next);
      return next;
    });
  }, []);

  return (
    <ClinicianModeContext.Provider value={{ enabled, toggle }}>
      {children}
    </ClinicianModeContext.Provider>
  );
}

export function useClinicianMode(): ClinicianModeState {
  return useContext(ClinicianModeContext);
}
