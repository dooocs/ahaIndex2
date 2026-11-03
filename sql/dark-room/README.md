# 小黑屋账号存档表（阿里云）

`001_saves.sql` creates `public.dark_room_saves` and
`public.dark_room_save_backups` in the existing amazingindex project.
Each game has its own tables. No `game_id` multiplexing is used.

This release prepares storage only. The game still saves locally and does not
upload any existing progress. Authenticated users can SELECT their own records
through RLS; anon has no access and authenticated has no write privileges.
The future save API must authenticate the owner, implement atomic expected-
revision checks, validate schema compatibility and scope all server-role writes
by the verified user ID. Service-role keys never belong in the browser.

The trigger provides server timestamps, incrementing revisions, content hashes,
last-request retry suppression and checkpoints of the previous state. Autosave
checkpoints are throttled to one per ten minutes; manual/import/reset/restore/
conflict operations checkpoint immediately. Only the latest ten checkpoints per
user are retained. A restore must write a new current revision, not roll one back.

Run `001_saves.test.sql` after installation. It exercises actual table privileges,
RLS, revision generation, JSON validation, retry handling and ten-backup retention.
It uses one existing auth user UUID only as an FK target and refuses to touch an
existing save. All fixture writes are rolled back; no auth user is changed.

Browser sync, account-local slots, multi-tab locking and conflict-selection UI
are separate work and are not enabled by creating these tables.
