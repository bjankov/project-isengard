/**
 * Bundle Monaco locally (no CDN) so the app works offline: only the editor core, a single
 * generic worker and the languages we actually use.
 */
import { loader } from '@monaco-editor/react';
import * as monaco from 'monaco-editor/editor/editor.api';
import EditorWorker from 'monaco-editor/editor/editor.worker?worker';
import 'monaco-editor/languages/definitions/markdown/register';
import 'monaco-editor/languages/definitions/python/register';

self.MonacoEnvironment = {
  getWorker: () => new EditorWorker(),
};

loader.config({ monaco });
