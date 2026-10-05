// Prints read-only SQL for the dedicated project's SQL Editor. Never deletes Auth users.
const candidates = `WITH candidates AS (
  SELECT u.id, u.created_at, u.last_sign_in_at
  FROM auth.users AS u
  WHERE u.is_anonymous = true
    AND u.last_sign_in_at IS NOT NULL
    AND u.last_sign_in_at < now() - interval '14 days'
    AND NOT EXISTS (
      SELECT 1 FROM auth.identities AS i
      WHERE i.user_id = u.id AND i.provider <> 'anonymous'
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.app_teacher_bindings AS t WHERE t.uid = u.id::text
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.app_memberships AS m
      JOIN public.rooms AS r ON r.id = m.room_id
      WHERE m.uid = u.id::text
        AND r.expires_at_ms > floor(extract(epoch FROM now()) * 1000)::bigint
    )
)`;
const mode = process.argv[2] ?? '--count';
if (!['--count', '--list'].includes(mode) || process.argv.length > 3) {
  throw new Error('Usage: node scripts/anonymous-maintenance.mjs [--count|--list]');
}
const query = mode === '--count'
  ? 'SELECT count(*) AS candidate_count FROM candidates;'
  : 'SELECT id, created_at, last_sign_in_at FROM candidates ORDER BY last_sign_in_at, id LIMIT 500;';
process.stdout.write(`-- Read-only candidate inspection; run in the AlkanePuzzleCompetition project only.\n${candidates}\n${query}\n`);
