import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  DEFAULT_CHARACTER,
  DEFAULT_SPACE,
  type GrowthView,
  type PersonalSpace,
  type Member,
  type CatalogItem,
} from '@focusspace/shared';
import { useAuth } from '../auth';
import { api, errorMessage } from '../api';
import { createRequestId } from '../requestId';
import { Modal, Notice } from '../components';
import { CharacterPreview } from '../features/space/CharacterPreview';
import { StudySpace } from '../features/space/StudySpace';
import { tracks } from '../features/audio/tracks';
export const slotNames: Record<string, string> = {
  skin: '肤色',
  hair: '发型',
  hairColor: '发色',
  outfit: '服饰',
  accessory: '配件',
  room: '空间外观',
  desk: '书桌',
  chair: '座椅',
  desktop: '桌面',
  wall: '墙面',
  window: '窗边',
  rug: '地毯',
  light: '光照',
  sound: '环境音',
  motion: '动作',
  expression: '互动表现',
};
export function GrowthPage() {
  const { user, refresh } = useAuth();
  const [data, setData] = useState<GrowthView | null>(null),
    [personal, setPersonal] = useState<PersonalSpace | null>(null),
    [selected, setSelected] = useState('outfit.clay'),
    [slot, setSlot] = useState('all'),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [busy, setBusy] = useState(false),
    [showRules, setShowRules] = useState(false);
  const selectionInitialized = useRef(false);
  async function load() {
    try {
      const [g, p] = await Promise.all([
        api<GrowthView>('/users/me/growth'),
        api<PersonalSpace>('/users/me/space'),
      ]);
      if (!selectionInitialized.current) {
        setSelected(g.catalog.find((catalogItem) => !catalogItem.owned)?.id ?? g.catalog[0]?.id ?? '');
        selectionInitialized.current = true;
      }
      setData(g);
      setPersonal(p);
      setError('');
    } catch (e) {
      setError(errorMessage(e));
    }
  }
  useEffect(() => {
    void load();
  }, []);
  const item = data?.catalog.find((i) => i.id === selected);
  const preview = useMemo(() => {
    const character = structuredClone(personal?.character ?? DEFAULT_CHARACTER),
      space = structuredClone(personal?.space ?? DEFAULT_SPACE);
    if (item) {
      if (item.slot === 'sound') space.sound = item.id.slice(6) as typeof space.sound;
      else if (item.slot in character)
        (character as unknown as Record<string, string>)[item.slot] = item.id;
      else if (item.slot in space.slots)
        (space.slots as Record<string, string>)[item.slot] = item.id;
      else (space as unknown as Record<string, string>)[item.slot] = item.id;
    }
    const member: Member = {
      userId: user!.id,
      nickname: user!.nickname,
      avatarId: user!.avatarId,
      avatarUrl: user!.avatarUrl,
      character,
      seatIndex: 0,
      ready: false,
      afk: false,
      connectionState: 'CONNECTED',
      status: item?.slot === 'motion' ? 'BREAKING' : 'READY',
      isOwner: true,
      joinedAt: 0,
      lateJoin: false,
      tasksDone: 0,
      tasksTotal: 0,
      progressPercent: null,
      publicTasks: [],
    };
    return { character, space, members: [member] };
  }, [personal, item, user]);
  async function act(action: 'acquire' | 'equip', remove = false) {
    if (!item || busy) return;
    setBusy(true);
    setNotice('');
    setError('');
    try {
      await api(`/users/me/growth/${action}`, {
        method: 'POST',
        body: {
          assetId: item.id,
          requestId: createRequestId(),
          ...(action === 'equip' ? { remove } : {}),
        },
      });
      await load();
      await refresh();
      setNotice(
        action === 'acquire'
          ? '已永久拥有。点击「使用」保存到个人空间。'
          : remove
            ? '已换回基础搭配。'
            : '已使用。空间布置用于下一次共学，当前房间保留原快照。',
      );
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  const status = (i: CatalogItem) =>
    i.status === 'DISABLED'
      ? '已停用 · 使用基础替代'
      : i.owned
        ? '已拥有'
        : i.status === 'DELISTED'
          ? '已下架'
          : data!.level < i.minLevel
            ? `Lv.${i.minLevel} 后${i.price ? '可兑换' : '可领取'}`
            : i.price
              ? `${i.price} 学习币`
              : '免费领取';
  return (
    <div className="growth-page">
      <div className="page-heading">
        <span className="eyebrow">把专注，留在自己的小天地</span>
        <h1>成长与装扮</h1>
        <p>经验记录成长，学习币兑换永久拥有的装扮。只有外观不同，学习收益始终相同。</p>
      </div>
      {error ? (
        <Notice>
          {error} <button onClick={() => void load()}>重新加载</button>
        </Notice>
      ) : null}
      {notice ? (
        <Notice tone="success">
          {notice} <Link to="/space">前往个人空间 →</Link>
        </Notice>
      ) : null}
      {data ? (
        <>
          <section className="growth-passport">
            <button
              type="button"
              className="icon-help growth-help"
              aria-label="查看经验与学习币规则"
              onClick={() => setShowRules(true)}
            >
              ?
            </button>
            <div>
              <span>成长记录</span>
              <h2>Lv.{data.level}</h2>
              <progress
                aria-label="等级进度"
                value={data.xp - data.floor}
                max={data.next - data.floor}
              />
              <span className="growth-progress-count">
                {data.xp} / {data.next}
              </span>
            </div>
            <div>
              <span>学习币</span>
              <h2>{data.coins}</h2>
            </div>
          </section>
          {showRules ? (
            <Modal className="info-dialog" onCancel={() => setShowRules(false)}>
              <h2>经验与学习币</h2>
              <p>
                每整分钟服务端有效专注 +{data.rules.xpPerMinute} 经验、+
                {data.rules.coinsPerMinute} 币；完整轮次 +{data.rules.roundXp} 经验、+
                {data.rules.roundCoins} 币，奖励次数最多为有效专注分钟数 ÷ 25
                取整。不到一分钟的部分本场不计奖。
              </p>
              <p>
                开始前设定的目标，在结束前完成且有效学习至少 5 分钟：每日一次 +
                {data.rules.goalXp} 经验、+{data.rules.goalCoins} 币。与他人有效重叠至少 5
                分钟：每日一次 +{data.rules.togetherXp} 经验、+{data.rules.togetherCoins}{' '}
                币。按结算日（北京时间）各限一次，任务重复勾选不重复奖励。
              </p>
              <p>
                该场共学结束后统一结算到账。提前离开仍保留有效学习，房主接任不影响记录；缺席、暂离或断线不会扣除已获得经验。演示场次和升级前记录不发正式奖励。规则
                v{data.rules.version}，修改只用于之后新建的房间。
              </p>
              <button className="button primary" onClick={() => setShowRules(false)}>
                知道了
              </button>
            </Modal>
          ) : null}
          {data.pending ? <p role="status">{data.pending} 笔奖励处理中，刷新后重试补发。</p> : null}
          <div className="growth-workbench">
            <section className="growth-shelf">
              <div className="growth-filters">
                <label>
                  类别
                  <select value={slot} onChange={(e) => setSlot(e.target.value)}>
                    <option value="all">全部类别</option>
                    {Object.entries(slotNames).map(([key, name]) => (
                      <option key={key} value={key}>
                        {name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="growth-items">
                {data.catalog
                  .filter(
                    (i) => !i.owned && (slot === 'all' || i.slot === slot),
                  )
                  .sort((a, b) => Number(a.basic) - Number(b.basic))
                  .map((i) => (
                    <button
                      key={i.id}
                      className={`growth-item ${selected === i.id ? 'selected' : ''}`}
                      aria-pressed={selected === i.id}
                      onClick={() => {
                        setSelected(i.id);
                        if (window.matchMedia('(max-width: 900px)').matches)
                          document
                            .querySelector('.growth-preview')
                            ?.scrollIntoView({ block: 'start' });
                      }}
                    >
                      <i style={{ background: i.color }} aria-hidden="true" />
                      <small>{slotNames[i.slot]}</small>
                      <strong>{i.name}</strong>
                      <span>{status(i)}</span>
                      {i.equipped ? <b>使用中</b> : null}
                    </button>
                  ))}
              </div>
            </section>
            <aside className="growth-preview">
              {item ? (
                <>
                  <span className="eyebrow">先看看喜欢的样子</span>
                  <h2>{item.name}</h2>
                  {item.slot in preview.character ? (
                    <CharacterPreview member={preview.members[0]} />
                  ) : (
                    <StudySpace
                      members={preview.members}
                      phase="LOBBY"
                      theme={preview.space.theme}
                      space={preview.space}
                      seed={personal?.seed ?? 1}
                      userId={user!.id}
                    />
                  )}
                  {item.slot === 'sound' ? (
                    <audio
                      key={item.id}
                      controls
                      loop
                      src={tracks.find((t) => t.id === item.id.slice(6))?.src}
                    />
                  ) : null}
                  {item.slot === 'expression' ? (
                    <div className="expression-preview" aria-label="星光鼓励预览">
                      {item.id === 'expression.sparkle' ? '✨' : '🌱 💪 ☕'}
                    </div>
                  ) : null}
                  <p>兼容槽位：{slotNames[item.slot]} · 两种房型通用</p>
                  <p>
                    {item.price} 学习币 · Lv.{item.minLevel} {item.price ? '后可兑换' : '后可领取'}
                    {item.owned ? ' · 已永久拥有' : ''}
                  </p>
                  <small>预览不会保存。达到等级只开放获取条件。</small>
                  <div className="growth-actions">
                    {item.owned ? (
                      <button
                        className="button primary"
                        disabled={busy || item.status === 'DISABLED' || item.equipped}
                        onClick={() => void act('equip')}
                      >
                        使用
                      </button>
                    ) : (
                      <button
                        className="button primary"
                        disabled={
                          busy ||
                          item.status !== 'ACTIVE' ||
                          data.level < item.minLevel ||
                          data.coins < item.price
                        }
                        onClick={() => void act('acquire')}
                      >
                        {item.price ? `兑换 · ${item.price} 币` : '免费领取'}
                      </button>
                    )}
                    {item.equipped && !item.basic ? (
                      <button
                        className="button secondary"
                        disabled={busy}
                        onClick={() => void act('equip', true)}
                      >
                        卸下 / 恢复基础
                      </button>
                    ) : null}
                  </div>
                  <Link to="/space">进入个人空间 →</Link>
                </>
              ) : null}
            </aside>
          </div>
          <section className="panel">
            <h2>最近流水</h2>
            {data.ledger.length ? (
              <div className="growth-ledger">
                {data.ledger.map((l) => (
                  <article key={l.id}>
                    <div>
                      <strong>{l.reason}</strong>
                      <small>
                        {new Date(l.createdAt).toLocaleString('zh-CN')} ·{' '}
                        {l.source === 'STUDY'
                          ? `学习奖励 · v${l.ruleVersion}`
                          : l.source === 'REDEEM'
                            ? '永久兑换'
                            : '管理员补偿'}
                      </small>
                    </div>
                    <span>
                      {l.xp >= 0 ? '+' : ''}
                      {l.xp} 经验 / {l.coins >= 0 ? '+' : ''}
                      {l.coins} 币
                    </span>
                  </article>
                ))}
              </div>
            ) : (
              <p>先设一个小目标，完成第一次有效专注。这里会留下每笔奖励与兑换记录。</p>
            )}
          </section>
        </>
      ) : !error ? (
        <p role="status">正在打开装扮架…</p>
      ) : null}
    </div>
  );
}
