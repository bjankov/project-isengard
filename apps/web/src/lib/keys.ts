/** Keyboard helpers shared by the global shortcuts, the editors and the canvas. */

export const isMac = typeof navigator !== 'undefined' && /mac/i.test(navigator.platform);

/** The platform's modifier key: ⌘ on macOS, Ctrl elsewhere. */
export const MOD = isMac ? '⌘' : 'Ctrl';

/** A shortcut with the platform's modifier, e.g. `modKey('S')` → "⌘S" or "Ctrl+S". */
export function modKey(key: string): string {
  return isMac ? `⌘${key}` : `Ctrl+${key}`;
}

/** Whether a key event goes to a text field or code editor, where shortcuts must not fire. */
export function isEditableTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    !!target.closest('input, textarea, select, [contenteditable="true"], .monaco-editor')
  );
}

/** Whether a modal dialog is open (it owns the keyboard then). */
export function dialogOpen(): boolean {
  return !!document.querySelector('[role="dialog"][data-state="open"], [role="alertdialog"]');
}
