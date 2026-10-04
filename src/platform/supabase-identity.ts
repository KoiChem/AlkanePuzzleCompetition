import { normalizeTeacherEmail, type TeacherIdentity } from './teacher-identity';
export type VerifiedUser = {
  id: string; email?: string; email_confirmed_at?: string;
  is_anonymous?: boolean; identities?: Array<{ provider?: string }>;
};
export function googleIdentity(user: VerifiedUser): TeacherIdentity | null {
  if (user.is_anonymous || !user.email || !user.email_confirmed_at || !user.identities?.some(x => x.provider === 'google')) return null;
  return { id: user.id, email: normalizeTeacherEmail(user.email) };
}
export async function verifySupabaseUser(request: Request, url: string, key: string): Promise<VerifiedUser | null> {
  const authorization = request.headers.get('authorization');
  if (!authorization?.startsWith('Bearer ')) return null;
  const response = await fetch(`${url}/auth/v1/user`, { headers: { authorization, apikey: key }, signal: AbortSignal.timeout(5000) });
  if (!response.ok) return null;
  const user = await response.json() as VerifiedUser;
  return typeof user.id === 'string' && user.id ? user : null;
}
