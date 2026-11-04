import type { Settings } from '@app/schema';
import { useEffect } from 'react';
import { create } from 'zustand';
import { api } from '@/lib/api';

interface SettingsStore {
  settings: Settings | undefined;
  libraryDir: string | undefined;
  error: string | undefined;
  load: () => Promise<void>;
  set: (settings: Settings) => void;
}

export const useSettingsStore = create<SettingsStore>((set) => ({
  settings: undefined,
  libraryDir: undefined,
  error: undefined,
  load: async () => {
    try {
      const res = await api.getSettings();
      set({ settings: res.settings, libraryDir: res.libraryDir, error: undefined });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
    }
  },
  set: (settings) => set({ settings }),
}));

/** App settings; loads them on first use. `undefined` while loading. */
export function useSettings(): Settings | undefined {
  const settings = useSettingsStore((s) => s.settings);
  const load = useSettingsStore((s) => s.load);
  useEffect(() => {
    if (!settings) void load();
  }, [settings, load]);
  return settings;
}
