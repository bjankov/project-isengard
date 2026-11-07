import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { Kbd } from '@/canvas/kbd';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Keyboard } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { MOD, dialogOpen, isEditableTarget } from '@/lib/keys';

interface Shortcut {
  /** Key combinations; `then` marks a sequence (G, then a digit), otherwise alternatives. */
  keys: string[][];
  then?: boolean;
  what: string;
}

const SECTIONS: { title: string; items: Shortcut[] }[] = [
  {
    title: 'Everywhere',
    items: [
      { keys: [['?']], what: 'Show these shortcuts' },
      {
        keys: [['G'], ['1–6']],
        then: true,
        what: 'Go to a tab: Projects, Agents, Skills, Tools, Patterns, Settings',
      },
      { keys: [[MOD, 'S']], what: 'Save the open editor' },
    ],
  },
  {
    title: 'Canvas',
    items: [
      { keys: [[MOD, 'K']], what: 'Quick add: a node, agent, tool step or pattern' },
      { keys: [['P']], what: 'Context preview of the selected agent' },
      { keys: [['F']], what: 'Zoom to fit' },
      { keys: [['Esc']], what: 'Clear the selection' },
      { keys: [[MOD, 'Z']], what: 'Undo' },
      { keys: [[MOD, 'Shift', 'Z']], what: 'Redo' },
      {
        keys: [
          [MOD, 'C'],
          [MOD, 'V'],
        ],
        what: 'Copy and paste nodes',
      },
      { keys: [[MOD, 'A']], what: 'Select all nodes' },
      { keys: [['Delete']], what: 'Delete the selection' },
      { keys: [[MOD, 'Click']], what: 'Add to the selection' },
      { keys: [['Double-click']], what: 'Expand or collapse a pattern' },
    ],
  },
];

const TAB_PATHS = ['/projects', '/agents', '/skills', '/tools', '/patterns', '/settings'];

/**
 * Global shortcuts: `?` opens the list of shortcuts, `G` then a digit opens a tab. They don't
 * fire while typing in a field or while a dialog is open.
 */
export function GlobalShortcuts() {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const pendingG = useRef<number | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (isEditableTarget(e.target) || dialogOpen()) return;
      if (e.key === '?') {
        e.preventDefault();
        setOpen(true);
        return;
      }
      const now = Date.now();
      if (pendingG.current !== null && now - pendingG.current < 1500) {
        pendingG.current = null;
        const path = TAB_PATHS[Number(e.key) - 1];
        if (path) {
          e.preventDefault();
          void navigate(path);
        }
        return;
      }
      pendingG.current = e.key.toLowerCase() === 'g' ? now : null;
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navigate]);

  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-8 text-muted-foreground"
            aria-label="Keyboard shortcuts"
            onClick={() => setOpen(true)}
          >
            <Keyboard className="size-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">Keyboard shortcuts (?)</TooltipContent>
      </Tooltip>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Keyboard shortcuts</DialogTitle>
            <DialogDescription>Press ? anywhere to see this list again.</DialogDescription>
          </DialogHeader>
          <div className="space-y-5">
            {SECTIONS.map((section) => (
              <section key={section.title}>
                <h3 className="mb-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">
                  {section.title}
                </h3>
                <dl className="divide-y rounded-md border">
                  {section.items.map((item) => (
                    <div key={item.what} className="flex items-center gap-4 px-3 py-1.5 text-sm">
                      <dt className="flex shrink-0 items-center gap-1">
                        {item.keys.map((combo, i) => (
                          <span key={i} className="flex items-center gap-0.5">
                            {i > 0 && (
                              <span className="px-0.5 text-xs text-muted-foreground">
                                {item.then ? 'then' : '/'}
                              </span>
                            )}
                            {combo.map((k) => (
                              <Kbd key={k} className="text-[11px]">
                                {k}
                              </Kbd>
                            ))}
                          </span>
                        ))}
                      </dt>
                      <dd className="ml-auto text-right text-muted-foreground">{item.what}</dd>
                    </div>
                  ))}
                </dl>
              </section>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
