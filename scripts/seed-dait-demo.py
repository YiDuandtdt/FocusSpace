"""Seed a repeatable, production-database demo dataset for the existing `dait` account.

The seed is intentionally scoped to rows whose IDs start with ``dait-demo-``.  It
does not delete or rewrite the account's existing history; re-running it replaces
only the previous demo rows and restores the account's demo-facing profile,
personal space and growth balance.

This script uses SQLite directly so it can be run even when the Node service is
not available. Stop the running FocusSpace process before running it.
"""

from __future__ import annotations

import json
import os
import sqlite3
import time
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DB_PATH = ROOT / "prisma" / "data" / "focusspace.db"
PREFIX = "dait-demo-"


def ms(days: float = 0, hours: float = 0, minutes: float = 0) -> int:
    return int((time.time() - days * 86400 - hours * 3600 - minutes * 60) * 1000)


def json_text(value: object) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def insert_many(conn: sqlite3.Connection, table: str, columns: list[str], rows: list[tuple]) -> None:
    marks = ",".join("?" for _ in columns)
    conn.executemany(
        f'INSERT INTO "{table}" ({",".join(columns)}) VALUES ({marks})', rows
    )


def insert_many_ignore(conn: sqlite3.Connection, table: str, columns: list[str], rows: list[tuple]) -> None:
    marks = ",".join("?" for _ in columns)
    conn.executemany(
        f'INSERT OR IGNORE INTO "{table}" ({",".join(columns)}) VALUES ({marks})', rows
    )


conn = sqlite3.connect(DB_PATH)
conn.execute("PRAGMA foreign_keys = ON")
try:
    dait = conn.execute('SELECT id FROM "User" WHERE username = ?', ("dait",)).fetchone()
    if not dait:
        raise SystemExit("账号 dait 不存在，请先创建账号后再运行本脚本。")
    dait_id = dait[0]
    companions = conn.execute(
        'SELECT id, username FROM "User" WHERE username IN (?, ?) ORDER BY username',
        ("lifuc", "hana"),
    ).fetchall()
    if len(companions) != 2:
        raise SystemExit("需要已有 lifuc 和 hana 作为共学演示伙伴；请先创建这两个账号。")
    lifuc_id = next(row[0] for row in companions if row[1] == "lifuc")
    hana_id = next(row[0] for row in companions if row[1] == "hana")

    # Remove only a previous run of this seed. Children are removed before their
    # parent rows so SQLite foreign-key checking remains enabled.
    # Delete children by their demo parent as well as by the seed prefix. The
    # running server may have created live phase/message IDs with a random CUID;
    # those rows still belong to the demo room and must be removed before the
    # room/session can be rebuilt.
    conn.execute('DELETE FROM "GrowthLedger" WHERE id LIKE ? OR key LIKE ? OR recordId LIKE ?', (f"{PREFIX}%", f"{PREFIX}%", f"{PREFIX}%"))
    conn.execute('DELETE FROM "AdminAudit" WHERE id LIKE ?', (f"{PREFIX}%",))
    conn.execute('DELETE FROM "ChatMessage" WHERE id LIKE ? OR roomId LIKE ? OR sessionId LIKE ?', (f"{PREFIX}%", f"{PREFIX}%", f"{PREFIX}%"))
    conn.execute('DELETE FROM "Task" WHERE id LIKE ? OR sessionId LIKE ? OR todoId LIKE ?', (f"{PREFIX}%", f"{PREFIX}%", f"{PREFIX}%"))
    conn.execute('DELETE FROM "PresenceInterval" WHERE id LIKE ? OR sessionId LIKE ?', (f"{PREFIX}%", f"{PREFIX}%"))
    conn.execute('DELETE FROM "PhaseInterval" WHERE id LIKE ? OR sessionId LIKE ?', (f"{PREFIX}%", f"{PREFIX}%"))
    conn.execute('DELETE FROM "StudyRecord" WHERE id LIKE ? OR sessionId LIKE ?', (f"{PREFIX}%", f"{PREFIX}%"))
    conn.execute('DELETE FROM "RoomMember" WHERE id LIKE ? OR roomId LIKE ?', (f"{PREFIX}%", f"{PREFIX}%"))
    conn.execute('DELETE FROM "Todo" WHERE id LIKE ?', (f"{PREFIX}%",))
    conn.execute('DELETE FROM "Room" WHERE id LIKE ?', (f"{PREFIX}%",))
    conn.execute('DELETE FROM "StudySession" WHERE id LIKE ?', (f"{PREFIX}%",))
    now = int(time.time() * 1000)
    nick = "dait 演示账号"
    character = {
        "version": 1,
        "skin": "skin.honey",
        "hair": "hair.bob",
        "hairColor": "hair.chestnut",
        "outfit": "outfit.blue",
        "accessory": "accessory.glasses",
        "motion": "motion.stretch",
        "expression": "expression.sparkle",
    }
    space = {
        "version": 1,
        "room": "room.arch",
        "theme": "night",
        "desk": "desk.walnut",
        "chair": "chair.cream",
        "light": "light.warm",
        "slots": {
            "desktop": "desktop.books",
            "wall": "wall.clock",
            "window": "window.flowers",
            "rug": "rug.sand",
        },
        "sound": "rain",
    }
    conn.execute(
        'UPDATE "User" SET nickname = ?, avatarId = ?, characterConfig = ?, onboarding = ? WHERE id = ?',
        (nick, "lilac", json_text(character), "DONE", dait_id),
    )
    conn.execute(
        'INSERT INTO "PersonalSpace" (userId, config, revision, updatedAt) VALUES (?, ?, ?, ?) '
        'ON CONFLICT(userId) DO UPDATE SET config=excluded.config, revision=excluded.revision, updatedAt=excluded.updatedAt',
        (dait_id, json_text(space), 7, now),
    )

    # Make the main non-basic catalog items visible in the account. This gives
    # the /growth and /space pages both owned and still-unowned examples.
    owned_assets = [
        "skin.honey",
        "hair.bob",
        "hairColor.chestnut",
        "outfit.blue",
        "accessory.glasses",
        "motion.stretch",
        "expression.sparkle",
        "room.arch",
        "desk.walnut",
        "chair.cream",
        "desktop.books",
        "wall.clock",
        "window.flowers",
        "rug.sand",
        "light.warm",
        "sound.rain",
    ]
    insert_many_ignore(
        conn,
        "OwnedAsset",
        ["userId", "assetId", "source", "createdAt"],
        [(dait_id, asset, "DEMO", now) for asset in owned_assets],
    )

    # Restore a useful level-3 account with a visible path to level 4. Existing
    # historical ledger rows are kept; demo study rows below add three more
    # clearly labelled study transactions.
    conn.execute(
        'INSERT INTO "GrowthAccount" (userId, xp, coins, level) VALUES (?, ?, ?, ?) '
        'ON CONFLICT(userId) DO UPDATE SET xp=excluded.xp, coins=excluded.coins, level=excluded.level',
        (dait_id, 860, 355, 3),
    )

    # Long-term planning data: parent/child task, scheduled item and recurring
    # item. The dates are deliberately close enough to be visible in the calendar.
    todo_rows = [
        (
            f"{PREFIX}todo-1",
            dait_id,
            None,
            "准备期末项目答辩",
            0,
            None,
            "HIGH",
            ms(days=-3),
            ms(days=-1, hours=2),
            ms(days=-1, hours=1),
            json_text(["课程", "重要"]),
            "NONE",
            None,
            1,
            None,
            ms(days=0),
            ms(days=0),
        ),
        (
            f"{PREFIX}todo-2",
            dait_id,
            f"{PREFIX}todo-1",
            "整理系统架构图和演示流程",
            1,
            ms(days=3),
            "MEDIUM",
            ms(days=-2),
            ms(days=-1, hours=1),
            ms(days=-1),
            json_text(["文档"]),
            "NONE",
            None,
            2,
            None,
            ms(days=0),
            ms(days=0),
        ),
        (
            f"{PREFIX}todo-3",
            dait_id,
            None,
            "复盘多人共学流程",
            0,
            None,
            "MEDIUM",
            ms(days=1),
            ms(hours=-2),
            ms(hours=-1),
            json_text(["复盘", "FocusSpace"]),
            "DAILY",
            f"{PREFIX}series-1",
            1,
            None,
            ms(days=0),
            ms(days=0),
        ),
        (
            f"{PREFIX}todo-4",
            dait_id,
            None,
            "准备下一次产品演示",
            0,
            None,
            "LOW",
            ms(days=5),
            None,
            None,
            json_text(["演示"]),
            "WEEKLY",
            f"{PREFIX}series-2",
            1,
            None,
            ms(days=0),
            ms(days=0),
        ),
    ]
    # Add a richer planning history so the calendar and completion filters show
    # both completed work and overdue/upcoming work. The generated dates span
    # roughly three weeks before and after today; recurrence remains limited to
    # values supported by the product (DAILY/WEEKLY).
    todo_titles = [
        "补充产品需求说明",
        "整理前端组件清单",
        "检查接口异常处理",
        "录制功能演示旁白",
        "复盘本周专注数据",
        "优化个人空间布局",
        "整理用户反馈",
        "准备阶段交付材料",
    ]
    todo_labels = [
        ["产品", "文档"],
        ["前端", "整理"],
        ["后端", "测试"],
        ["演示", "交付"],
        ["复盘", "数据"],
        ["空间", "体验"],
        ["反馈", "优化"],
        ["阶段交付", "重要"],
    ]
    for extra_index in range(1, 25):
        # Negative days_ago means a future due date; every fourth past item is
        # intentionally left incomplete to make overdue states visible.
        days_ago = extra_index - 12
        due_at = ms(days=days_ago)
        completed = days_ago >= 0 and extra_index % 4 != 0
        recurrence = "DAILY" if extra_index % 6 == 0 else "WEEKLY" if extra_index % 7 == 0 else "NONE"
        priority = ("HIGH", "MEDIUM", "LOW")[extra_index % 3]
        created_at = ms(days=days_ago + 2)
        completed_at = due_at - 30 * 60 * 1000 if completed else None
        todo_rows.append(
            (
                f"{PREFIX}todo-extra-{extra_index}",
                dait_id,
                None,
                todo_titles[(extra_index - 1) % len(todo_titles)],
                int(completed),
                completed_at,
                priority,
                due_at,
                due_at - 2 * 3600 * 1000,
                due_at - 1 * 3600 * 1000,
                json_text(todo_labels[(extra_index - 1) % len(todo_labels)]),
                recurrence,
                f"{PREFIX}series-extra-{extra_index}" if recurrence != "NONE" else None,
                1,
                None,
                created_at,
                now,
            )
        )
    insert_many(
        conn,
        "Todo",
        [
            "id",
            "userId",
            "parentId",
            "title",
            "completed",
            "completedAt",
            "priority",
            "dueAt",
            "scheduledStart",
            "scheduledEnd",
            "labels",
            "recurrence",
            "seriesId",
            "version",
            "archivedAt",
            "createdAt",
            "updatedAt",
        ],
        todo_rows,
    )

    rules = json_text(
        {
            "version": 1,
            "xpPerMinute": 2,
            "coinsPerMinute": 1,
            "roundXp": 5,
            "roundCoins": 2,
            "goalXp": 5,
            "goalCoins": 2,
            "togetherXp": 5,
            "togetherCoins": 2,
        }
    )
    snapshot = json_text(
        {
            "config": space,
            "seed": 20260910,
            "ownerId": dait_id,
            "ownerName": nick,
            "sourceRevision": 7,
        }
    )

    # A broad history provides visible daily/weekly/monthly trend changes and a
    # filled twelve-week heatmap. Recent sessions deliberately occur at several
    # times today, while older sessions cover the previous 83 days.
    history_specs = [
        (0, 3, 1800), (0, 6, 3600), (0, 9, 5400), (0, 12, 2700),
        (1, 2, 4500), (2, 3, 3000), (3, 4, 6000), (4, 2, 2400),
        (5, 3, 4200), (6, 1, 3600), (7, 2, 5400), (8, 3, 3000),
        (9, 1, 2400), (11, 2, 6600), (13, 4, 3600), (15, 2, 4800),
        (17, 3, 1800), (20, 2, 7200), (23, 3, 3000), (26, 1, 4200),
        (29, 2, 5400), (32, 4, 2400), (36, 2, 6000), (40, 3, 3600),
        (44, 1, 4800), (48, 2, 1800), (52, 3, 5400), (56, 2, 3000),
        (60, 4, 6600), (66, 2, 4200), (72, 3, 2400), (78, 1, 6000),
        (83, 2, 3600),
    ]
    history_records: list[tuple[str, int, int, int]] = []
    for i, (days_ago, hours_ago, focus_total) in enumerate(history_specs, start=1):
        room_id = f"{PREFIX}history-room-{i}"
        session_id = f"{PREFIX}history-session-{i}"
        start = ms(days=days_ago, hours=hours_ago)
        focus = max(300, focus_total // 3)
        break_s = 300
        end = start + 3 * focus + 2 * break_s
        code = f"D7H{221 + i:03d}"
        phase_values = [
            (1, "FOCUS", start, start + focus),
            (1, "BREAK", start + focus, start + focus + break_s),
            (2, "FOCUS", start + focus + break_s, start + 2 * focus + break_s),
            (2, "BREAK", start + 2 * focus + break_s, start + 2 * focus + 2 * break_s),
            (3, "FOCUS", start + 2 * focus + 2 * break_s, end),
        ]
        conn.execute(
            'INSERT INTO "StudySession" (id, phase, roundNo, focusSeconds, breakSeconds, targetRounds, phaseStartAt, phaseEndAt, startedAt, endedAt, endReason, feedbackVersion, rewardRules, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            (session_id, "ENDED", 3, focus, break_s, 3, end, end, start, end, "DEMO_SEEDED", 1, rules, start),
        )
        conn.execute(
            'INSERT INTO "Room" (id, code, name, ownerId, sessionId, visibility, theme, spaceSnapshot, spaceOwnerId, delistedAt, capacity, revision, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            (room_id, code, f"dait演示·历史共学第{i}场", dait_id, session_id, "PRIVATE", ("library", "rain", "night")[i % 3], snapshot, dait_id, None, 8, 8, start),
        )
        for round_no, phase, phase_start, phase_end in phase_values:
            conn.execute(
                'INSERT INTO "PhaseInterval" (id, sessionId, roundNo, phase, startAt, endAt) VALUES (?, ?, ?, ?, ?, ?)',
                (f"{PREFIX}phase-{i}-{round_no}-{phase.lower()}", session_id, round_no, phase, phase_start, phase_end),
            )
        for seat, user_id, presence_end in (
            (0, dait_id, end),
            (1, lifuc_id, end - 420),
            (2, hana_id, end - 780),
        ):
            conn.execute(
                'INSERT INTO "RoomMember" (id, roomId, userId, seatIndex, ready, afk, connectionState, joinedAt, leftAt, lastSeenAt, reconnectDeadlineAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                (f"{PREFIX}member-{i}-{seat}", room_id, user_id, seat, 1, 0, "DISCONNECTED", start, presence_end, presence_end, None),
            )
            conn.execute(
                'INSERT INTO "PresenceInterval" (id, sessionId, userId, startAt, endAt, endReason) VALUES (?, ?, ?, ?, ?, ?)',
                (f"{PREFIX}presence-{i}-{seat}", session_id, user_id, start, presence_end, "DEMO_SEEDED"),
            )
        task_specs = [
            (dait_id, "完成核心功能演示脚本", "HIGH", 1, "PUBLIC", ["演示", "核心"]),
            (dait_id, "整理阶段交付记录", "MEDIUM", 1 if i % 2 else 0, "PRIVATE", ["文档"]),
            (dait_id, "检查移动端布局", "LOW", 1, "PUBLIC", ["UI", "移动端"]),
            (lifuc_id, "确认后端接口状态", "MEDIUM", 1, "PUBLIC", ["联调"]),
        ]
        for ti, (user_id, title, priority, completed, visibility, labels) in enumerate(task_specs, start=1):
            task_id = f"{PREFIX}task-{i}-{ti}"
            done_at = end - 600 if completed else None
            conn.execute(
                'INSERT INTO "Task" (id, sessionId, userId, todoId, parentId, title, priority, dueAt, labels, visibility, firstCompletedRound, completed, completedAt, version, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                (task_id, session_id, user_id, None, None, title, priority, None, json_text(labels), visibility, 1 if completed else None, completed, done_at, 2 if completed else 1, start),
            )
        conn.execute(
            'INSERT INTO "ChatMessage" (id, roomId, sessionId, userId, removedAt, content, createdAt, requestId) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            # Chat retention is 24 hours in production. Keep demo messages
            # recent so historical rooms still have visible conversation text.
            (f"{PREFIX}message-{i}-1", room_id, session_id, lifuc_id, None, "这轮节奏很好，Break 后继续推进。", now - i * 60 * 1000, f"00000000-0000-4000-8000-{i+300:012d}"),
        )
        dait_record = f"{PREFIX}record-{i}-dait"
        conn.execute(
            'INSERT INTO "StudyRecord" (id, sessionId, userId, focusSeconds, roundsCompleted, tasksDone, tasksTotal, studiedWith, rewardState, rewardFacts, settledAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            (dait_record, session_id, dait_id, focus_total, 3, 2 if i % 4 else 1, 3, 2, "POSTED", json_text({"goal": i % 3 != 0, "togetherSeconds": min(1800, focus_total)}), end),
        )
        conn.execute(
            'INSERT INTO "StudyRecord" (id, sessionId, userId, focusSeconds, roundsCompleted, tasksDone, tasksTotal, studiedWith, rewardState, rewardFacts, settledAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            (f"{PREFIX}record-{i}-lifuc", session_id, lifuc_id, max(900, int(focus_total * 0.78)), 2, 1, 2, 1, "LEGACY", None, None),
        )
        conn.execute(
            'INSERT INTO "StudyRecord" (id, sessionId, userId, focusSeconds, roundsCompleted, tasksDone, tasksTotal, studiedWith, rewardState, rewardFacts, settledAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            (f"{PREFIX}record-{i}-hana", session_id, hana_id, max(900, int(focus_total * 0.68)), 2, 1, 2, 1, "LEGACY", None, None),
        )
        history_records.append((dait_record, end, i, focus_total))

    # Keep a small visible message trail in each historical room as well as in
    # the live Break room. This is repeated explicitly after the history loop so
    # the script remains easy to inspect and re-run.
    for i, (_, settled_at, _, _) in enumerate(history_records, start=1):
        conn.execute(
            'INSERT INTO "ChatMessage" (id, roomId, sessionId, userId, removedAt, content, createdAt, requestId) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            (f"{PREFIX}history-message-{i}", f"{PREFIX}history-room-{i}", f"{PREFIX}history-session-{i}", lifuc_id, None, "历史演示：Break 阶段完成一次复盘交流。", now - (i + 40) * 60 * 1000, f"00000000-0000-4000-8000-{i+600:012d}"),
        )

    # A live public Break room is the main entry point for the demo. It exposes
    # public rooms, fixed seats, task privacy, messages, themes and the timer.
    live_room = f"{PREFIX}live-room"
    live_session = f"{PREFIX}live-session"
    live_start = ms(hours=1)
    live_phase_start = ms(minutes=4)
    live_phase_end = ms(minutes=-11)
    conn.execute(
        'INSERT INTO "StudySession" (id, phase, roundNo, focusSeconds, breakSeconds, targetRounds, phaseStartAt, phaseEndAt, startedAt, endedAt, endReason, feedbackVersion, rewardRules, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        (live_session, "BREAK", 1, 1500, 300, 4, live_phase_start, live_phase_end, live_start, None, None, 1, rules, live_start),
    )
    conn.execute(
        'INSERT INTO "Room" (id, code, name, ownerId, sessionId, visibility, theme, spaceSnapshot, spaceOwnerId, delistedAt, capacity, revision, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        (live_room, "DA7T88", "dait演示·沉浸式共学", dait_id, live_session, "PUBLIC", "night", snapshot, dait_id, None, 8, 12, live_start),
    )
    conn.execute(
        'INSERT INTO "PhaseInterval" (id, sessionId, roundNo, phase, startAt, endAt) VALUES (?, ?, ?, ?, ?, ?)',
        (f"{PREFIX}live-phase-focus", live_session, 1, "FOCUS", live_start, live_phase_start),
    )
    conn.execute(
        'INSERT INTO "PhaseInterval" (id, sessionId, roundNo, phase, startAt, endAt) VALUES (?, ?, ?, ?, ?, ?)',
        (f"{PREFIX}live-phase-break", live_session, 1, "BREAK", live_phase_start, None),
    )
    for seat, user_id in ((0, dait_id), (1, lifuc_id), (2, hana_id)):
        conn.execute(
            'INSERT INTO "RoomMember" (id, roomId, userId, seatIndex, ready, afk, connectionState, joinedAt, leftAt, lastSeenAt, reconnectDeadlineAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            (f"{PREFIX}live-member-{seat}", live_room, user_id, seat, 1, 0, "CONNECTED", live_start, None, now, None),
        )
        conn.execute(
            'INSERT INTO "PresenceInterval" (id, sessionId, userId, startAt, endAt, endReason) VALUES (?, ?, ?, ?, ?, ?)',
            (f"{PREFIX}live-presence-{seat}", live_session, user_id, live_start, None, None),
        )
    insert_many(
        conn,
        "Task",
        ["id", "sessionId", "userId", "todoId", "parentId", "title", "priority", "dueAt", "labels", "visibility", "firstCompletedRound", "completed", "completedAt", "version", "createdAt"],
        [
            (f"{PREFIX}live-task-1", live_session, dait_id, f"{PREFIX}todo-1", None, "完成答辩演示材料", "HIGH", ms(days=2), json_text(["演示", "重要"]), "PUBLIC", 1, 1, live_phase_start - 120000, 2, live_start),
            (f"{PREFIX}live-task-2", live_session, dait_id, None, None, "检查成长奖励和个人空间", "MEDIUM", None, json_text(["成长", "空间"]), "PRIVATE", None, 0, None, 1, live_start),
            (f"{PREFIX}live-task-3", live_session, lifuc_id, None, None, "确认接口演示状态", "MEDIUM", None, json_text(["联调"]), "PUBLIC", 1, 1, live_phase_start - 60000, 2, live_start),
            (f"{PREFIX}live-task-4", live_session, hana_id, None, None, "整理自己的学习笔记", "LOW", None, json_text(["学习"]), "PRIVATE", None, 0, None, 1, live_start),
        ],
    )
    insert_many(
        conn,
        "ChatMessage",
        ["id", "roomId", "sessionId", "userId", "removedAt", "content", "createdAt", "requestId"],
        [
            (f"{PREFIX}live-message-1", live_room, live_session, lifuc_id, None, "Break 里同步一下演示进度。", now - 90000, "00000000-0000-4000-8000-000000000101"),
            (f"{PREFIX}live-message-2", live_room, live_session, dait_id, None, "好的，下一轮继续完成剩余任务。", now - 45000, "00000000-0000-4000-8000-000000000102"),
        ],
    )

    # Study ledgers make the growth page and each historical Summary meaningful.
    xp_after, coins_after = 500, 175
    for index, (record_id, settled_at, _, focus_total) in enumerate(history_records, start=1):
        xp_gain = max(20, round(focus_total / 60 * 2))
        coin_gain = max(10, round(focus_total / 60))
        xp_after += xp_gain
        coins_after += coin_gain
        conn.execute(
            'INSERT INTO "GrowthLedger" (id, key, userId, source, recordId, assetId, ruleVersion, xp, coins, xpAfter, coinsAfter, rewardDay, goalBonus, togetherBonus, reason, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            (f"{PREFIX}ledger-{index}", f"{PREFIX}record:{record_id}", dait_id, "STUDY", record_id, None, 1, xp_gain, coin_gain, xp_after, coins_after, f"demo-day-{index:02d}", 1 if index % 3 == 1 else 0, 1 if index % 2 == 0 else 0, f"演示场次 {index}：有效专注、完整轮次、学习目标与共同学习奖励", settled_at),
        )
    # Keep the account aligned with the final demo ledger balance.
    conn.execute('UPDATE "GrowthAccount" SET xp=?, coins=?, level=? WHERE userId=?', (xp_after, coins_after, max(3, min(8, 3 + xp_after // 1500)), dait_id))

    conn.execute(
        'INSERT INTO "AdminAudit" (id, actorId, action, targetId, reason, createdAt, result, summary, requestId) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        (f"{PREFIX}audit-1", dait_id, "DEMO_DATA_SEEDED", dait_id, "初始化 dait 演示数据", now, "SUCCESS", "生成历史、计划、共学、成长、空间和公开房间演示数据", "00000000-0000-4000-8000-000000000201"),
    )

    conn.commit()
    print(json.dumps({
        "account": "dait",
        "role": "ADMIN",
        "liveRoomCode": "DA7T88",
        "liveRoomId": live_room,
        "historySessions": len(history_records),
        "todosAdded": len(todo_rows),
        "demoPrefix": PREFIX,
        "database": str(DB_PATH),
    }, ensure_ascii=False, indent=2))
finally:
    conn.close()
