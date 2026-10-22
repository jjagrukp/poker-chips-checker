import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import { routes } from './routes';
import type { Services } from './services';
import { ServicesProvider } from './ServicesProvider';

const router = createBrowserRouter(routes);

export function App({ services }: { services?: Services }) {
  return (
    <ServicesProvider {...(services ? { services } : {})}>
      <RouterProvider router={router} />
    </ServicesProvider>
  );
}
