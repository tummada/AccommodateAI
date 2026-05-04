import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Bell, LogOut, Menu, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useAuth } from '@/lib/auth-context';
import { fetchNotifications } from '@/lib/api/notifications';

interface TopbarProps {
  collapsed: boolean;
  onToggleCollapse: () => void;
  onOpenMobile: () => void;
}

export function Topbar({ collapsed, onToggleCollapse, onOpenMobile }: TopbarProps) {
  const { user, logout, client, isAuthenticated } = useAuth();
  const navigate = useNavigate();

  // T-059: real notifications query (replaces the previous static badge constants).
  // - Only enabled while authenticated so we never fire requests on /login or during logout.
  // - limit:20 mirrors NotificationsPage page size — enough to detect any unread "urgent"
  //   item which we surface as the red "critical" indicator (parity with NotificationsPage
  //   urgencyLevel >= 4 logic at NotificationsPage.tsx:185).
  // - Failures fall through to badgeCount=0 (badge hidden, neutral aria-label) — Topbar
  //   must not throw or block the rest of the chrome if the API hiccups.
  const notificationsQuery = useQuery({
    queryKey: ['notifications', 'topbar'],
    queryFn: () => fetchNotifications(client, { limit: 20 }),
    enabled: isAuthenticated,
    staleTime: 30_000,
    retry: 1,
  });

  const apiUnreadCount = notificationsQuery.data?.unreadCount ?? 0;
  // Critical = any UNREAD notification with priority 'urgent' OR type 'deadline_l4' / 'deadline_l5'.
  // Mirrors NotificationsPage.mapUrgencyLevel (NotificationsPage.tsx:169-179) where
  // urgencyLevel >= 4 is treated as critical/overdue.
  const hasCritical = (notificationsQuery.data?.notifications ?? []).some(
    (n) =>
      n.readAt === null &&
      (n.priority === 'urgent' || n.type === 'deadline_l4' || n.type === 'deadline_l5'),
  );

  const handleLogout = async () => {
    // ACMD-116: logout() now calls the backend + broadcasts before
    // clearing local state. Await so we only navigate after state is
    // consistent — otherwise ProtectedRoute could re-render briefly
    // before Topbar unmounts.
    try {
      await logout();
    } finally {
      navigate('/login', { replace: true });
    }
  };

  const initials = (user?.name ?? user?.email ?? 'U')
    .split(/[\s@]/)
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();

  return (
    <header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b border-border bg-surface px-4 lg:px-6">
      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="icon"
          className="lg:hidden"
          onClick={onOpenMobile}
          aria-label="Open navigation"
        >
          <Menu className="h-5 w-5" aria-hidden="true" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="hidden lg:inline-flex"
          onClick={onToggleCollapse}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          aria-expanded={!collapsed}
        >
          {collapsed ? (
            <PanelLeftOpen className="h-5 w-5" aria-hidden="true" />
          ) : (
            <PanelLeftClose className="h-5 w-5" aria-hidden="true" />
          )}
        </Button>
      </div>

      <div className="flex items-center gap-2">
        {/* NavBellBadge — ACMD-142: navigate to /notifications + badge.
            T-059: count + color now driven by GET /api/v1/notifications. */}
        {(() => {
          const badgeCount = apiUnreadCount;
          const badgeColor = hasCritical ? '#EF4444' : '#2563EB';
          const badgeLabel = badgeCount > 99 ? '99+' : String(badgeCount);

          return (
            <div className="relative">
              <Button
                variant="ghost"
                size="icon"
                aria-label={`${badgeCount} unread notifications`}
                onClick={() => navigate('/notifications')}
                data-testid="topbar-bell-button"
              >
                <Bell className="h-5 w-5" aria-hidden="true" />
              </Button>
              {badgeCount > 0 && (
                <span
                  className="pointer-events-none absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-bold text-white"
                  style={{ backgroundColor: badgeColor }}
                  aria-hidden="true"
                  data-testid="topbar-bell-badge"
                >
                  {badgeLabel}
                </span>
              )}
            </div>
          );
        })()}

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="flex items-center gap-2 rounded-md px-2 py-1 text-sm hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label="User menu"
            >
              <Avatar>
                <AvatarFallback>{initials}</AvatarFallback>
              </Avatar>
              <span className="hidden text-left sm:block">
                <span className="block max-w-[160px] truncate text-sm font-medium text-text">
                  {user?.name ?? user?.email ?? 'Signed in'}
                </span>
                <span className="block max-w-[160px] truncate text-xs text-text-muted">
                  {user?.role ?? ''}
                </span>
              </span>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel>
              <div className="text-sm font-semibold text-text">{user?.name ?? 'Account'}</div>
              <div className="truncate text-xs font-normal text-text-muted">{user?.email}</div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={() => {
                void handleLogout();
              }}
            >
              <LogOut className="mr-2 h-4 w-4" aria-hidden="true" />
              Log out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
