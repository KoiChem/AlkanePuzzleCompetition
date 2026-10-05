CREATE TABLE participant_drafts (
 room_id text NOT NULL, participant_id text NOT NULL, question_id text NOT NULL,
 field_id text NOT NULL CHECK(field_id IN ('formula','name')),
 manifest_id text NOT NULL, writer_epoch integer NOT NULL CHECK(writer_epoch>=1),
 version integer NOT NULL CHECK(version>=1), value_json text NOT NULL CHECK(json_valid(value_json)),
 edited_elapsed_ms bigint NOT NULL CHECK(edited_elapsed_ms>=0), updated_at_ms bigint NOT NULL,
 PRIMARY KEY(room_id,participant_id,question_id,field_id),
 FOREIGN KEY(room_id,participant_id) REFERENCES participants(room_id,id) ON DELETE CASCADE,
 FOREIGN KEY(room_id,question_id) REFERENCES room_questions(room_id,question_id) ON DELETE CASCADE
);
ALTER TABLE public.participant_drafts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.participant_drafts FROM PUBLIC, anon, authenticated;
-- Each expired room owns all of its records through ON DELETE CASCADE.
CREATE OR REPLACE FUNCTION public.app_prune_expired_rooms(batch_limit integer DEFAULT 100)
RETURNS integer LANGUAGE plpgsql SET search_path=public AS $$
DECLARE deleted_count integer;
BEGIN
 IF batch_limit < 1 OR batch_limit > 1000 THEN RAISE EXCEPTION 'invalid batch limit'; END IF;
 DELETE FROM rooms WHERE id IN (SELECT id FROM rooms WHERE expires_at_ms <= floor(extract(epoch FROM clock_timestamp())*1000)::bigint ORDER BY expires_at_ms,id LIMIT batch_limit FOR UPDATE SKIP LOCKED);
 GET DIAGNOSTICS deleted_count = ROW_COUNT;
 PERFORM app_prune_auxiliary();
 RETURN deleted_count;
END $$;
REVOKE ALL ON FUNCTION public.app_prune_expired_rooms(integer) FROM PUBLIC, anon, authenticated;
-- Scheduler installed separately by administrator: see docs/OPERATIONS.md.
