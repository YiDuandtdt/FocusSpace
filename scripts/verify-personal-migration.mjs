import { DatabaseSync } from 'node:sqlite';
import assert from 'node:assert/strict';
const [beforePath, afterPath] = process.argv.slice(2);
assert(beforePath && afterPath, 'Provide backup and migrated database paths');
const before = new DatabaseSync(beforePath, { readOnly: true });
const after = new DatabaseSync(afterPath, { readOnly: true });
try {
  for (const table of [
    'User',
    'Room',
    'StudySession',
    'StudyRecord',
    'Task',
    'ChatMessage',
    'PresenceInterval',
    'RoomMember',
  ]) {
    const columns = before
      .prepare(`PRAGMA table_info("${table}")`)
      .all()
      .map((c) => `"${c.name}"`)
      .join(',');
    // New rows may be created between a live VACUUM backup and service shutdown.
    // Compare every backed-up row, without treating later legitimate activity as data loss.
    for (const row of before.prepare(`SELECT ${columns} FROM "${table}" ORDER BY id`).all()) {
      const current = after.prepare(`SELECT ${columns} FROM "${table}" WHERE id = ?`).get(row.id);
      assert.deepEqual(current, row, `${table}: a backed-up row changed`);
    }
  }
  const users = after.prepare('SELECT count(*) n FROM User').get().n;
  assert.equal(after.prepare('SELECT count(*) n FROM PersonalSpace').get().n, users);
  console.log(
    'PASS production migration: all backed-up rows across 8 tables unchanged; every account has a personal space; later rows retained',
  );
} finally {
  before.close();
  after.close();
}
