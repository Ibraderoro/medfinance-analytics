import { Navigate } from 'react-router-dom';
import { useAuthStore, type SessionUser } from '../../store/authStore';

export function RoleRoute({ allow, children }: { allow: Array<SessionUser['role']>; children: JSX.Element }) {
  const user = useAuthStore((s) => s.user);

  if (!user || !allow.includes(user.role)) {
    return <Navigate to="/dashboard" replace />;
  }

  return children;
}
