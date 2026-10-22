import { useRoutes } from 'react-router-dom';
import { routes } from '../routes';

// Test-only: a plain MemoryRouter child, since jsdom's AbortSignal trips data routers' Requests.
export function AppRoutes() {
  return useRoutes(routes);
}
