import { Outlet } from 'react-router-dom';
import { AppNotices } from './AppNotices';

export function Layout() {
  return (
    <div className="min-h-dvh px-4 py-8 sm:px-8">
      <AppNotices />
      <Outlet />
    </div>
  );
}
