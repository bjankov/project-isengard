import { createBrowserRouter, Navigate } from 'react-router';
import { FolderKanban, Shapes } from 'lucide-react';
import { AppShell } from '@/components/app-shell';
import { AgentEditorRoute, AgentsIndex, AgentsLayout } from '@/routes/agents';
import { PlaceholderPage } from '@/routes/placeholder-page';
import { SettingsPage } from '@/routes/settings';
import { SkillEditorRoute, SkillsIndex, SkillsLayout } from '@/routes/skills';
import { BuiltinToolRoute, ToolEditorRoute, ToolsIndex, ToolsLayout } from '@/routes/tools';

export const router = createBrowserRouter([
  {
    element: <AppShell />,
    children: [
      { index: true, element: <Navigate to="/projects" replace /> },
      {
        path: '/projects',
        element: (
          <PlaceholderPage
            title="Projects"
            description="Your projects and workflow templates."
            icon={FolderKanban}
          />
        ),
      },
      {
        path: '/agents',
        element: <AgentsLayout />,
        children: [
          { index: true, element: <AgentsIndex /> },
          { path: 'new', element: <AgentEditorRoute /> },
          { path: ':id', element: <AgentEditorRoute /> },
        ],
      },
      {
        path: '/skills',
        element: <SkillsLayout />,
        children: [
          { index: true, element: <SkillsIndex /> },
          { path: 'new', element: <SkillEditorRoute /> },
          { path: ':id', element: <SkillEditorRoute /> },
        ],
      },
      {
        path: '/tools',
        element: <ToolsLayout />,
        children: [
          { index: true, element: <ToolsIndex /> },
          { path: 'new', element: <ToolEditorRoute /> },
          { path: 'builtin/:builtin', element: <BuiltinToolRoute /> },
          { path: ':id', element: <ToolEditorRoute /> },
        ],
      },
      {
        path: '/patterns',
        element: (
          <PlaceholderPage
            title="Patterns"
            description="Reusable multi-agent structures."
            icon={Shapes}
          />
        ),
      },
      { path: '/settings', element: <SettingsPage /> },
      { path: '*', element: <Navigate to="/projects" replace /> },
    ],
  },
]);
