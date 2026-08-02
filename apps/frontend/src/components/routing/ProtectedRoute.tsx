import { Navigate } from 'react-router-dom';
import { Loading } from '../common/Loading';
import { useAuthStore } from '../../store/authStore';

export function ProtectedRoute({ children }: { children: JSX.Element }) {
  const hasCheckedSession = useAuthStore((s) => s.hasCheckedSession);
  const status = useAuthStore((s) => s.status);

  if (!hasCheckedSession) {
    return <Loading message="Checking secure session" />;
  }

  if (status === 'unauthenticated') {
    return <Navigate to="/login" replace />;
  }

  return children;
}
