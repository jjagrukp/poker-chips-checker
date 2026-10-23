import { Navigate, type RouteObject } from 'react-router-dom';
import { brand } from '@/app/configuration/brand';
import { LimitationsScreen } from '@/features/settings/ui/Limitations';
import { Layout } from './Layout';
import { Home } from './routes/Home';
import { SettingsRoute } from './routes/SettingsRoute';
import { SetupRoute, TournamentRoute } from './routes/SetupRoute';

export const routes: RouteObject[] = [
  {
    element: <Layout />,
    children: [
      { index: true, element: <Home /> },
      { path: 'setup/:id', element: <SetupRoute /> },
      { path: 'setup/:id/:step', element: <SetupRoute /> },
      { path: 'tournament/:id', element: <TournamentRoute /> },
      { path: 'settings', element: <SettingsRoute /> },
      { path: 'limitations', element: <LimitationsScreen appName={brand.appName} /> },
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
];
