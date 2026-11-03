import { createBrowserRouter, Navigate } from 'react-router';
import { AppShell, TABS } from '@/components/app-shell';
import { PlaceholderPage } from '@/routes/placeholder-page';

const DESCRIPTIONS: Record<string, string> = {
  '/projects': 'Your projects and workflow templates.',
  '/agents': 'Reusable agents: prompt, skills, tool presets and defaults.',
  '/skills': 'Markdown instruction files in the Agent Skills format.',
  '/tools': 'Built-in tools and the scoped presets agents actually get.',
  '/patterns': 'Reusable multi-agent structures.',
  '/settings': 'Model list, defaults and library store location.',
};

export const router = createBrowserRouter([
  {
    element: <AppShell />,
    children: [
      { index: true, element: <Navigate to="/projects" replace /> },
      ...TABS.map((tab) => ({
        path: tab.path,
        element: (
          <PlaceholderPage
            title={tab.label}
            description={DESCRIPTIONS[tab.path] ?? ''}
            icon={tab.icon}
          />
        ),
      })),
      { path: '*', element: <Navigate to="/projects" replace /> },
    ],
  },
]);
