import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, cpSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
mkdirSync('.tmp', { recursive: true });
const directory = mkdtempSync(resolve('.tmp/feedback-migration-'));
mkdirSync(resolve(directory, 'migrations'));
cpSync('prisma/schema.prisma', resolve(directory, 'schema.prisma'));
cpSync(
  'prisma/migrations/migration_lock.toml',
  resolve(directory, 'migrations/migration_lock.toml'),
);
const latest = '202609080002_feedback';
for (const migration of readdirSync('prisma/migrations', { withFileTypes: true }))
  if (migration.isDirectory() && migration.name !== latest)
    cpSync(
      resolve('prisma/migrations', migration.name),
      resolve(directory, 'migrations', migration.name),
      { recursive: true },
    );
const env = {
  ...process.env,
  DATABASE_URL: 'file:' + resolve(directory, 'legacy.db').replaceAll('\\', '/'),
};
function deploy() {
  const result = spawnSync(
    process.execPath,
    [
      'node_modules/prisma/build/index.js',
      'migrate',
      'deploy',
      '--schema',
      resolve(directory, 'schema.prisma'),
    ],
    { env, encoding: 'utf8', windowsHide: true },
  );
  assert.equal(result.status, 0, result.stdout + result.stderr);
}
new DatabaseSync(resolve(directory, 'legacy.db')).close();
deploy();
const db = new DatabaseSync(resolve(directory, 'legacy.db'));
db.exec(`INSERT INTO User(id,username,passwordHash,nickname) VALUES('legacy-user','legacy_user','preserved-hash','原账号');
INSERT INTO StudySession(id,focusSeconds,breakSeconds,phase,roundNo) VALUES('legacy-session',1500,300,'LOBBY',0);
INSERT INTO Room(id,code,name,ownerId,sessionId) VALUES('legacy-room','LEGACY','原房间','legacy-user','legacy-session');
INSERT INTO RoomMember(id,roomId,userId,seatIndex) VALUES('legacy-member','legacy-room','legacy-user',0);
INSERT INTO Task(id,sessionId,userId,title,completed) VALUES('legacy-task','legacy-session','legacy-user','原私有任务',1);`);
db.close();
cpSync(resolve('prisma/migrations', latest), resolve(directory, 'migrations', latest), {
  recursive: true,
});
deploy();
deploy();
const upgraded = new DatabaseSync(resolve(directory, 'legacy.db'));
assert.equal(
  upgraded.prepare('SELECT passwordHash FROM User').get().passwordHash,
  'preserved-hash',
);
const task = upgraded.prepare('SELECT * FROM Task').get();
assert.equal(task.title, '原私有任务');
assert.equal(task.visibility, 'PRIVATE');
assert.equal(task.firstCompletedRound, null);
assert.equal(upgraded.prepare('SELECT feedbackVersion FROM StudySession').get().feedbackVersion, 0);
upgraded.exec(
  `INSERT INTO StudySession(id,focusSeconds,breakSeconds) VALUES('new-session',1500,300)`,
);
assert.equal(
  upgraded.prepare(`SELECT feedbackVersion FROM StudySession WHERE id='new-session'`).get()
    .feedbackVersion,
  1,
);
assert.equal(upgraded.prepare('PRAGMA quick_check').get().quick_check, 'ok');
upgraded.close();
writeFileSync(
  resolve(directory, 'result.json'),
  JSON.stringify({ passed: true, directory }, null, 2),
);
console.log(
  'PASS legacy upgrade, repeat deploy, preserved account/task, private defaults and unknown legacy details. ' +
    directory,
);
