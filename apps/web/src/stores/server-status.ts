import type { HealthResponse } from '@app/schema';
import { create } from 'zustand';
import { apiFetch } from '@/lib/api';

type ServerStatus =
  | { state: 'connecting' }
  | { state: 'online'; health: HealthResponse }
  | { state: 'offline'; error: string };

interface ServerStatusStore {
  status: ServerStatus;
  refresh: () => Promise<void>;
}

export const useServerStatus = create<ServerStatusStore>((set) => ({
  status: { state: 'connecting' },
  refresh: async () => {
    try {
      const health = await apiFetch<HealthResponse>('/health');
      set({ status: { state: 'online', health } });
    } catch (err) {
      set({
        status: { state: 'offline', error: err instanceof Error ? err.message : String(err) },
      });
    }
  },
}));
