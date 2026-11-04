import { Settings as SettingsSchema, modelKey, type ModelOption, type Settings } from '@app/schema';
import { Copy, Plus, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { AgentDefaultsFields } from '@/components/agent-defaults';
import { EditorHeader } from '@/components/editor-header';
import { Section } from '@/components/field';
import { EditorBody } from '@/components/library-layout';
import { UnsavedChangesGuard } from '@/components/unsaved-changes-guard';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useSaveShortcut } from '@/hooks/use-save-shortcut';
import { ApiError, api } from '@/lib/api';
import { errorAt, issuesToErrors, type FieldErrors } from '@/lib/validation';
import { useSettings, useSettingsStore } from '@/stores/settings';
import { sameData } from '@/lib/same';

const same = sameData;

export function SettingsPage() {
  const saved = useSettings();
  const loadError = useSettingsStore((s) => s.error);
  if (loadError) return <p className="p-8 text-sm text-destructive">{loadError}</p>;
  if (!saved) return null;
  return <SettingsForm saved={saved} />;
}

function SettingsForm({ saved }: { saved: Settings }) {
  const libraryDir = useSettingsStore((s) => s.libraryDir);
  const setStore = useSettingsStore((s) => s.set);

  const [draft, setDraft] = useState<Settings>(saved);
  const [submitted, setSubmitted] = useState(false);
  const [serverErrors, setServerErrors] = useState<FieldErrors>({});
  const [saving, setSaving] = useState(false);

  const dirty = !same(draft, saved);
  const clientErrors = useMemo(() => {
    if (!submitted) return {};
    const r = SettingsSchema.safeParse(draft);
    return r.success ? {} : issuesToErrors(r.error.issues);
  }, [draft, submitted]);
  const errors = { ...serverErrors, ...clientErrors };

  const save = async () => {
    if (saving || !dirty) return;
    setSubmitted(true);
    const check = SettingsSchema.safeParse(draft);
    if (!check.success) {
      toast.error('Some fields need attention', { description: check.error.issues[0]?.message });
      return;
    }
    setSaving(true);
    try {
      const res = await api.updateSettings(draft);
      setStore(res.settings);
      setDraft(res.settings);
      setSubmitted(false);
      setServerErrors({});
      toast.success('Settings saved', {
        description: res.commit ? `Commit ${res.commit.hash.slice(0, 7)}` : undefined,
      });
    } catch (err) {
      if (err instanceof ApiError && err.status === 400)
        setServerErrors(issuesToErrors(err.issues));
      toast.error('Could not save settings', {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setSaving(false);
    }
  };
  useSaveShortcut(() => void save());

  const update = (fn: (s: Settings) => Settings) => {
    setServerErrors({});
    setDraft(fn);
  };
  const setModel = (i: number, m: ModelOption) =>
    update((s) => ({ ...s, models: s.models.map((x, j) => (j === i ? m : x)) }));
  const defaultKey = modelKey(draft.agentDefaults.model);

  return (
    <div className="h-full overflow-y-auto">
      <UnsavedChangesGuard dirty={dirty} />
      <EditorHeader
        eyebrow="App"
        title="Settings"
        dirty={dirty}
        saving={saving}
        onSave={() => void save()}
      />
      <EditorBody>
        <Section
          title="Models"
          description="The models agents can choose from. A static list: nothing is fetched from providers."
          actions={
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() =>
                update((s) => ({
                  ...s,
                  models: [...s.models, { provider: '', model: '', label: '' }],
                }))
              }
            >
              <Plus />
              Add model
            </Button>
          }
        >
          <div className="overflow-hidden rounded-lg border">
            <div className="grid grid-cols-[1fr_1.5fr_1.5fr_auto] gap-2 border-b bg-muted/40 px-3 py-2 text-xs font-medium text-muted-foreground">
              <span>Provider</span>
              <span>Model id</span>
              <span>Label</span>
              <span className="w-8" />
            </div>
            {draft.models.length === 0 && (
              <p className="px-3 py-4 text-sm text-muted-foreground">
                No models. Agents will have nothing to choose from.
              </p>
            )}
            {draft.models.map((m, i) => {
              const rowError = errorAt(errors, `models.${i}`);
              const isDefault = modelKey(m) === defaultKey;
              return (
                <div key={i} className="border-b px-3 py-2 last:border-b-0">
                  <div className="grid grid-cols-[1fr_1.5fr_1.5fr_auto] items-center gap-2">
                    <Input
                      value={m.provider}
                      onChange={(e) => setModel(i, { ...m, provider: e.target.value })}
                      placeholder="anthropic"
                      className="h-8 font-mono text-xs"
                      aria-label={`Provider ${i + 1}`}
                    />
                    <div className="flex items-center gap-2">
                      <Input
                        value={m.model}
                        onChange={(e) => setModel(i, { ...m, model: e.target.value })}
                        placeholder="claude-sonnet-5-5"
                        className="h-8 font-mono text-xs"
                        aria-label={`Model id ${i + 1}`}
                      />
                      {isDefault && <Badge variant="secondary">default</Badge>}
                    </div>
                    <Input
                      value={m.label ?? ''}
                      onChange={(e) =>
                        setModel(i, {
                          ...m,
                          label: e.target.value === '' ? undefined : e.target.value,
                        })
                      }
                      placeholder="Display name (optional)"
                      className="h-8 text-xs"
                      aria-label={`Label ${i + 1}`}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Remove model ${i + 1}`}
                      onClick={() =>
                        update((s) => ({ ...s, models: s.models.filter((_, j) => j !== i) }))
                      }
                    >
                      <X />
                    </Button>
                  </div>
                  {rowError && <p className="mt-1 text-xs text-destructive">{rowError}</p>}
                </div>
              );
            })}
          </div>
        </Section>

        <Section title="Defaults for new agents" description="Applied when you create an agent.">
          <AgentDefaultsFields
            value={draft.agentDefaults}
            onChange={(agentDefaults) => update((s) => ({ ...s, agentDefaults }))}
            models={draft.models.filter((m) => m.provider.trim() && m.model.trim())}
            errors={errors}
            pathPrefix="agentDefaults"
          />
        </Section>

        <Section
          title="Library store"
          description="The git repository holding every skill, tool preset, agent, pattern and project."
        >
          <div className="flex items-center gap-2">
            <code className="flex-1 truncate rounded-md border bg-muted/40 px-3 py-2 font-mono text-xs">
              {libraryDir}
            </code>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                void navigator.clipboard.writeText(libraryDir ?? '');
                toast.success('Path copied');
              }}
            >
              <Copy />
              Copy
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            To use another location, start the app with <code className="font-mono">APP_HOME</code>{' '}
            set to a different folder.
          </p>
        </Section>
      </EditorBody>
    </div>
  );
}
