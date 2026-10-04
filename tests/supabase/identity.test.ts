import { it, expect } from 'vitest';
import { googleIdentity } from '../../src/platform/supabase-identity';
const user = { id: 'uid', email: 'TEACHER@example.com', email_confirmed_at: '2026-10-01', is_anonymous: false, identities: [{ provider: 'google' }] };
it('rejects anonymous and unverified accounts even if they claim a teacher email', () => {
  expect(googleIdentity({...user,is_anonymous:true})).toBeNull();
  expect(googleIdentity({...user,email_confirmed_at:undefined})).toBeNull();
  expect(googleIdentity({...user,identities:[{provider:'email'}]})).toBeNull();
});
it('uses only a server verified Google identity', () => {
  expect(googleIdentity(user)).toEqual({id:'uid',email:'teacher@example.com'});
});
