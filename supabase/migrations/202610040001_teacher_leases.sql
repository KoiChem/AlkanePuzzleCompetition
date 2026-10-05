-- Local UID bindings are short-lived evidence of the central allowlist decision.
ALTER TABLE public.app_teacher_bindings ADD COLUMN lease_until_ms bigint NOT NULL DEFAULT 0;
CREATE INDEX app_teacher_active_lease ON public.app_teacher_bindings(lease_until_ms) WHERE active=true;

CREATE FUNCTION public.app_expire_teacher_leases(at_ms bigint) RETURNS void LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
  UPDATE app_teacher_bindings SET active=false,lease_until_ms=0
    WHERE active=true AND lease_until_ms<=at_ms;
END $$;
REVOKE ALL ON FUNCTION public.app_expire_teacher_leases(bigint) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.app_can_subscribe(topic text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT EXISTS (
    SELECT 1 FROM rooms r JOIN app_room_topics t ON t.room_id=r.id
    WHERE r.expires_at_ms > floor(extract(epoch FROM now())*1000)::bigint
      AND r.state NOT IN ('CANCELLED','EXPIRED')
      AND (
        (topic='room:'||r.public_id||':control:'||t.epoch AND (
          EXISTS(SELECT 1 FROM app_memberships m JOIN participants p ON p.room_id=m.room_id AND p.id=m.participant_id
            WHERE m.room_id=r.id AND m.uid=auth.uid()::text AND p.status<>'REMOVED')
          OR EXISTS(SELECT 1 FROM app_teacher_bindings b WHERE b.uid=auth.uid()::text AND b.uid=r.owner_teacher_id
            AND b.active AND b.lease_until_ms>floor(extract(epoch FROM now())*1000)::bigint)))
        OR (topic='room:'||r.public_id||':host:'||t.epoch AND (
          EXISTS(SELECT 1 FROM app_teacher_bindings b WHERE b.uid=auth.uid()::text AND b.uid=r.owner_teacher_id
            AND b.active AND b.lease_until_ms>floor(extract(epoch FROM now())*1000)::bigint)
          OR EXISTS(SELECT 1 FROM app_memberships m JOIN participants p ON p.room_id=m.room_id AND p.id=m.participant_id
            WHERE m.room_id=r.id AND m.uid=auth.uid()::text AND p.id=r.mate_host_id AND p.status<>'REMOVED')))
      )
  );
$$;
