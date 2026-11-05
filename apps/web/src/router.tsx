import { createBrowserRouter, Navigate } from 'react-router';
import { AppShell } from '@/components/app-shell';
import { AgentEditorRoute, AgentsIndex, AgentsLayout } from '@/routes/agents';
import { PatternCanvasRoute, PatternsPage } from '@/routes/patterns';
import { ProjectCanvasRoute, ProjectsPage } from '@/routes/projects';
import { SettingsPage } from '@/routes/settings';
import { SkillEditorRoute, SkillsIndex, SkillsLayout } from '@/routes/skills';
import { BuiltinToolRoute, ToolEditorRoute, ToolsIndex, ToolsLayout } from '@/routes/tools';

export const router = createBrowserRouter([
  {
    element: <AppShell />,
    children: [
      { index: true, element: <Navigate to="/projects" replace /> },
      { path: '/projects', element: <ProjectsPage /> },
      { path: '/projects/:id', element: <ProjectCanvasRoute /> },
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
      { path: '/patterns', element: <PatternsPage /> },
      { path: '/patterns/:id', element: <PatternCanvasRoute /> },
      { path: '/settings', element: <SettingsPage /> },
      { path: '*', element: <Navigate to="/projects" replace /> },
    ],
  },
]);
