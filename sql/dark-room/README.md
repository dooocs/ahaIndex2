# 小黑屋账号存档表（阿里云）

Apply `001_saves.sql` and then `002_manual_slot.sql` in the existing amazingindex
project. For a database that already has the initial tables, apply only
`002_manual_slot.sql`. Both tables are dedicated to Dark Room.

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
require server credentials. The save API must authenticate the owner and check
the expected revision atomically on writes. Autosave scheduling, account binding
and the save picker belong to the game integration.

Run `001_saves.test.sql` against the initial schema before applying the second
migration. Run `002_manual_slot.test.sql` after upgrading. The latter checks the
first manual save, automatic rotation and manual replacement with the server role.
Both tests use a spare auth account as a foreign-key target and roll back every
fixture write.
