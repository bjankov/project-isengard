import type { Settings } from '@app/schema';

/** Written to `settings.yaml` when the library has none. Users edit it in Settings. */
export const DEFAULT_SETTINGS: Settings = {
  models: [
    { provider: 'anthropic', model: 'claude-opus-5-5', label: 'Claude Opus 5.5' },
    { provider: 'anthropic', model: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5' },
    { provider: 'anthropic', model: 'claude-haiku-5-5', label: 'Claude Haiku 5.5' },
    { provider: 'anthropic', model: 'claude-fable-5-1', label: 'Claude Fable 5.1' },
  ],
  agentDefaults: {
    model: { provider: 'anthropic', model: 'claude-sonnet-5-5' },
    effort: 'medium',
    limits: { maxIterations: 20, maxTokens: 200_000, maxWallTimeSeconds: 600 },
  },
};
