import { FormEvent, useState } from 'react';
import { authApi } from '../services/api';
import styles from './Page.module.css';

export function AdminInvitesPage() {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'viewer' | 'analyst'>('viewer');
  const [expiresInHours, setExpiresInHours] = useState(72);
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [revokeId, setRevokeId] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const inviteUrl = (token: string) => `${window.location.origin}/register?invite=${encodeURIComponent(token)}`;

  const createInvite = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setMessage(null);
    setInviteLink(null);
    setIsSubmitting(true);
    try {
      const response = await authApi.createInvitation({ email: email.trim(), role, expiresInHours });
      const token = response.data?.data?.token as string | undefined;
      if (!token) throw new Error('Invite token missing from response');
      setInviteLink(inviteUrl(token));
      setMessage('Invitation created. Share this one-time link with the intended recipient only.');
    } catch (err: unknown) {
      const serverError = typeof err === 'object' && err !== null && 'response' in err
        ? (err as { response?: { data?: { error?: { message?: string } } } }).response?.data?.error?.message
        : undefined;
      setError(serverError ?? 'Unable to create invitation. Confirm you are an organization admin.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const revokeInvite = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setMessage(null);
    try {
      await authApi.revokeInvitation(revokeId.trim());
      setMessage('Invitation revoked if it was pending in your organization.');
      setRevokeId('');
    } catch (err: unknown) {
      const serverError = typeof err === 'object' && err !== null && 'response' in err
        ? (err as { response?: { data?: { error?: { message?: string } } } }).response?.data?.error?.message
        : undefined;
      setError(serverError ?? 'Unable to revoke invitation.');
    }
  };

  return (
    <div className={styles.page}>
      <h1 className={styles.title}>Team invitations</h1>
      <p>Create signed, expiring invitations for users in your organization. Invites can grant viewer or analyst access only.</p>
      <form onSubmit={createInvite} style={{ display: 'grid', gap: 12, maxWidth: 520 }}>
        <label><span>Email</span><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" style={{ width: '100%', padding: '0.65rem', marginTop: 4 }} /></label>
        <label><span>Role</span><select value={role} onChange={(e) => setRole(e.target.value as 'viewer' | 'analyst')} style={{ width: '100%', padding: '0.65rem', marginTop: 4 }}><option value="viewer">Viewer</option><option value="analyst">Analyst</option></select></label>
        <label><span>Expires in hours</span><input type="number" min={1} max={168} value={expiresInHours} onChange={(e) => setExpiresInHours(Number(e.target.value))} style={{ width: '100%', padding: '0.65rem', marginTop: 4 }} /></label>
        <button type="submit" disabled={isSubmitting} style={{ padding: '0.7rem', fontWeight: 600 }}>{isSubmitting ? 'Creating…' : 'Create invitation'}</button>
      </form>
      {inviteLink && <p style={{ wordBreak: 'break-all' }}><strong>Invite link:</strong> {inviteLink}</p>}
      <form onSubmit={revokeInvite} style={{ display: 'grid', gap: 12, maxWidth: 520, marginTop: 24 }}>
        <h2>Revoke invitation</h2>
        <label><span>Invitation ID</span><input type="text" value={revokeId} onChange={(e) => setRevokeId(e.target.value)} required style={{ width: '100%', padding: '0.65rem', marginTop: 4 }} /></label>
        <button type="submit" style={{ padding: '0.7rem', fontWeight: 600 }}>Revoke pending invitation</button>
      </form>
      {message && <p>{message}</p>}
      {error && <p className={styles.error}>{error}</p>}
    </div>
  );
}
