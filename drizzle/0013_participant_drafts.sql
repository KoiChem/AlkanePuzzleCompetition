CREATE TABLE participant_drafts (
 room_id text NOT NULL, participant_id text NOT NULL, question_id text NOT NULL,
 field_id text NOT NULL CHECK(field_id IN ('formula','name')),
 manifest_id text NOT NULL, writer_epoch integer NOT NULL CHECK(writer_epoch>=1),
 version integer NOT NULL CHECK(version>=1), value_json text NOT NULL CHECK(json_valid(value_json)),
 edited_elapsed_ms integer NOT NULL CHECK(edited_elapsed_ms>=0), updated_at_ms integer NOT NULL,
 PRIMARY KEY(room_id,participant_id,question_id,field_id),
 FOREIGN KEY(room_id,participant_id) REFERENCES participants(room_id,id) ON DELETE CASCADE,
 FOREIGN KEY(room_id,question_id) REFERENCES room_questions(room_id,question_id) ON DELETE CASCADE
);
