import { createBrowserRouter, Navigate, RouterProvider } from 'react-router-dom';
import { Layout } from './Layout';
import { Home } from './routes/Home';

const router = createBrowserRouter([
  {
    element: <Layout />,
    children: [
      { index: true, element: <Home /> },
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
]);

export function App() {
  return <RouterProvider router={router} />;
}
