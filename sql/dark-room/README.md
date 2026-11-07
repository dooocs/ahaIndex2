# 小黑屋账号存档表（阿里云）

The tables and `api.sql` are installed directly in the existing Aliyun amazingindex
project. `001_saves.sql`, `002_manual_slot.sql` and `api.sql` retain the repeatable
schema definitions in source control. Both tables are dedicated to Dark Room.

- `dark_room_saves` holds one latest save per account.
- `dark_room_save_backups` holds the ten latest historical checkpoints and one
  protected manual snapshot, identified by `is_manual_slot`.

A server-side write with `last_operation = 'manual'` records the **new** snapshot
in the manual slot in the same transaction as the main save. The previous manual
snapshot enters ordinary history retention. Historical checkpoints preserve the
previous state. Automatic writes create historical checkpoints at most every ten
minutes. Manual, import, reset, restore and conflict operations checkpoint the
previous state immediately. Restoring a snapshot creates a new revision.

The two tables allow signed-in users to read their own rows under RLS. Writes
use the server-only `dark_room_api` dispatcher. It serializes writes per account,
checks the expected revision, handles request retries and restores snapshots as
new revisions. The verified account ID comes from GoTrue, never the browser body.

Aliyun's five function slots are already occupied. `edge/index.ts` extends the
existing `meet-api` function with `/functions/v1/meet-api/dark-room`, retaining
the existing six community actions and their error contracts. Deploy that file
as `meet-api` with gateway JWT verification disabled. Both routes verify the real
bearer token against GoTrue inside the function. Existing runtime secrets remain
in Aliyun. The frontend uses only the existing public community configuration.

The game page waits for account-scoped startup before initializing the iframe.
Guest progress keeps its original local key. Signed-in progress and its persistent
request queue use `amazingindex.dark-room.user.<account>.gameState` and `.sync`.
Manual saves capture the click-time snapshot. Every 30 seconds, changed progress
is queued for upload. Going offline retains pending manual and automatic saves,
including across reloads. Web Locks allow one writer tab per account where
supported, with the database revision check protecting every cloud write.
Conflicts require an explicit choice. Replacing local progress retains a `.recovery`
copy that is available in the save picker. The original export/import UI remains
under the game's settings.

Run `001_saves.test.sql` against the initial schema before applying the second
migration. Run `002_manual_slot.test.sql` after upgrading. The latter checks the
first manual save, automatic rotation and manual replacement with the server role.
Both tests use a spare auth account as a foreign-key target and roll back every
fixture write.

`api.test.sql` exercises dispatcher writes, stale revisions, restore and grants
in a rolled-back transaction. `tests/dark-room-sync.test.mjs` covers the queue and
both gateway routes. `scripts/verify-dark-room-cloud.mjs` exercises the real page
and iframe against isolated mock APIs in the existing community CI job.
