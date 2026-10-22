import { Outlet } from 'react-router-dom';

export function Layout() {
  return (
    <div className="min-h-dvh px-4 py-8 sm:px-8">
      <Outlet />
    </div>
  );
}
