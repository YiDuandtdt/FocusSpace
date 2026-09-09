import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  DEFAULT_CHARACTER,
  DEFAULT_SPACE,
  assetOptions,
  type AssetCategory,
  type CharacterConfig,
  type Member,
  type PersonalSpace,
  type SpaceConfig,
} from '@focusspace/shared';
import { useAuth } from '../auth';
import { api, errorMessage } from '../api';
import { Notice } from '../components';
import { StudySpace } from '../features/space/StudySpace';
import { CharacterPreview } from '../features/space/CharacterPreview';
import { memberLabels } from '../features/space/memberPresentation';
import { themes } from '../features/space/themes';
import { AmbientAudio } from '../features/audio/AmbientAudio';
import '../features/space/personal.css';

function Choices({
  category,
  label,
  value,
  onChange,
}: {
  category: AssetCategory;
  label: string;
  value: string;
  onChange(value: string): void;
}) {
  return (
    <fieldset className="asset-field">
      <legend>{label}</legend>
      <div className="asset-options">
        {assetOptions(category).map((a) => (
          <button
            type="button"
            key={a.id}
            aria-pressed={value === a.id}
            className={value === a.id ? 'selected' : ''}
            onClick={() => onChange(a.id)}
          >
            <i style={{ background: a.color }} aria-hidden="true" />
            <span>{a.name}</span>
            {value === a.id ? <b aria-hidden="true">✓</b> : null}
          </button>
        ))}
      </div>
    </fieldset>
  );
}
const presets: { name: string; character: CharacterConfig }[] = [
  { name: '安静读者', character: { ...DEFAULT_CHARACTER, accessory: 'accessory.glasses' } },
  {
    name: '灵感手记',
    character: {
      ...DEFAULT_CHARACTER,
      hair: 'hair.bob',
      outfit: 'outfit.clay',
      accessory: 'accessory.beret',
    },
  },
  {
    name: '专注频道',
    character: {
      ...DEFAULT_CHARACTER,
      skin: 'skin.honey',
      hair: 'hair.bun',
      outfit: 'outfit.blue',
      accessory: 'accessory.headphones',
    },
  },
];
export function PersonalSpacePage() {
  const { user, refresh } = useAuth(),
    navigate = useNavigate(),
    [params] = useSearchParams();
  const onboarding = params.get('setup') === '1';
  const [saved, setSaved] = useState<PersonalSpace | null>(null),
    [draft, setDraft] = useState<PersonalSpace | null>(null);
  const [tab, setTab] = useState<'space' | 'character'>(onboarding ? 'character' : 'space');
  const [status, setStatus] = useState<Member['status']>('JOINED');
  const [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [busy, setBusy] = useState(false);
  const dirty = !!draft && JSON.stringify(draft) !== JSON.stringify(saved);
  async function load() {
    try {
      const p = await api<PersonalSpace>('/users/me/space');
      setSaved(p);
      setDraft(p);
      setError('');
    } catch (e) {
      setError(errorMessage(e));
    }
  }
  useEffect(() => {
    void load();
  }, []);
  useEffect(() => {
    if (!dirty) return;
    const guard = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener('beforeunload', guard);
    return () => window.removeEventListener('beforeunload', guard);
  }, [dirty]);
  function changeCharacter(key: keyof CharacterConfig, value: string) {
    setDraft((d) => (d ? { ...d, character: { ...d.character, [key]: value } } : d));
    setNotice('');
  }
  function changeSpace(key: keyof SpaceConfig, value: string) {
    setDraft((d) => (d ? { ...d, space: { ...d.space, [key]: value } } : d));
    setNotice('');
  }
  function changeSlot(key: keyof SpaceConfig['slots'], value: string) {
    setDraft((d) =>
      d ? { ...d, space: { ...d.space, slots: { ...d.space.slots, [key]: value } } } : d,
    );
    setNotice('');
  }
  async function save(skip = false) {
    if (!draft || !saved || busy) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const source = skip ? saved : draft;
      const result = await api<PersonalSpace>('/users/me/space', {
        method: 'PUT',
        body: {
          character: source.character,
          space: source.space,
          revision: source.revision,
          ...(onboarding ? { onboarding: skip ? 'SKIPPED' : 'DONE' } : {}),
        },
      });
      setSaved(result);
      setDraft(result);
      await refresh();
      setNotice('已保存。形象随你入座，空间用于下一次共学。');
      if (onboarding) {
        const next = params.get('next');
        navigate(next && /^\/join\/[A-HJ-NP-Z2-9]{6}$/.test(next) ? next : '/');
      }
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  const member = useMemo<Member>(
    () => ({
      userId: user!.id,
      nickname: user!.nickname,
      avatarId: user!.avatarId,
      avatarUrl: user!.avatarUrl,
      character: draft?.character ?? DEFAULT_CHARACTER,
      seatIndex: 0,
      ready: status === 'READY',
      afk: status === 'AFK',
      connectionState: status === 'DISCONNECTED' ? 'DISCONNECTED' : 'CONNECTED',
      status,
      isOwner: true,
      joinedAt: 0,
      lateJoin: false,
      tasksDone: 0,
      tasksTotal: 0,
      progressPercent: null,
      publicTasks: [],
    }),
    [user, draft?.character, status],
  );
  const members = useMemo(() => [member], [member]);
  if (!draft)
    return (
      <section className="empty-state">
        <h1>打开你的个人空间</h1>
        {error ? (
          <>
            <Notice>{error}</Notice>
            <button className="button secondary" onClick={() => void load()}>
              重新加载
            </button>
          </>
        ) : (
          <p role="status">正在读取已保存的搭配…</p>
        )}
      </section>
    );
  return (
    <div className="personal-page">
      <div className="personal-heading">
        <div>
          <span className="eyebrow">
            {onboarding ? 'MAKE YOURSELF AT HOME' : 'A LITTLE PLACE OF YOUR OWN'}
          </span>
          <h1>{onboarding ? '先选一份，属于你的安静。' : '我的个人空间'}</h1>
          <p>
            {onboarding
              ? '选个形象、一处风景就好。也可以直接开始，之后慢慢布置。'
              : '把喜欢的样子留下来。下一次，邀请朋友来这里一起学习。'}
          </p>
        </div>
        <span className="free-tag">基础搭配 · 全部免费</span>
      </div>
      {error ? <Notice>{error} 当前编辑内容已保留。</Notice> : null}
      {notice ? <Notice tone="success">{notice}</Notice> : null}
      <div className="personal-workbench">
        <section className="personal-preview-panel">
          <div className="personal-preview-heading">
            <div>
              <span className="eyebrow">LIVE PREVIEW</span>
              <h2>{tab === 'space' ? `${user!.nickname}的自习室` : '每次入座，都是你'}</h2>
            </div>
            <span className="save-state">{dirty ? '● 尚未保存' : '✓ 已长期保存'}</span>
          </div>
          {tab === 'space' ? (
            <StudySpace
              members={members}
              phase={
                status === 'FOCUSING'
                  ? 'FOCUS'
                  : status === 'BREAKING'
                    ? 'BREAK'
                    : status === 'ENDED'
                      ? 'ENDED'
                      : 'LOBBY'
              }
              theme={draft.space.theme}
              space={draft.space}
              seed={draft.seed}
              userId={user!.id}
            />
          ) : (
            <CharacterPreview member={member} />
          )}
          <div className="preview-states" aria-label="预览角色状态">
            {(Object.keys(memberLabels) as Member['status'][]).map((s) => (
              <button
                type="button"
                key={s}
                aria-pressed={status === s}
                onClick={() => setStatus(s)}
              >
                {memberLabels[s]}
              </button>
            ))}
          </div>
          <div className="personal-preview-caption">
            <span>
              {tab === 'space' ? '8 个固定座位 · 留给你和学习搭子' : '3D 虚拟形象 · 与账号头像独立'}
            </span>
            <span>预览动作，不影响正在进行的共学</span>
          </div>
        </section>
        <aside className="personal-editor">
          <div className="personal-tabs" role="tablist" aria-label="个人空间编辑">
            <button
              role="tab"
              aria-selected={tab === 'space'}
              aria-controls="personal-editor-body"
              onClick={() => setTab('space')}
            >
              自习室
            </button>
            <button
              role="tab"
              aria-selected={tab === 'character'}
              aria-controls="personal-editor-body"
              onClick={() => setTab('character')}
            >
              虚拟形象
            </button>
          </div>
          <fieldset className="editor-fields" disabled={busy} id="personal-editor-body">
            {tab === 'character' ? (
              <>
                <fieldset className="asset-field">
                  <legend>基础搭配</legend>
                  <div className="preset-options">
                    {presets.map((p) => (
                      <button
                        type="button"
                        key={p.name}
                        onClick={() => {
                          setDraft((d) => (d ? { ...d, character: p.character } : d));
                          setNotice('');
                        }}
                      >
                        <span>{p.name}</span>
                        <small>一键试穿 ↗</small>
                      </button>
                    ))}
                  </div>
                </fieldset>
                {(!onboarding
                  ? (['skin', 'hair', 'hairColor', 'outfit', 'accessory'] as const)
                  : (['outfit', 'accessory'] as const)
                ).map((key) => (
                  <Choices
                    key={key}
                    category={key}
                    label={
                      {
                        skin: '肤色',
                        hair: '发型',
                        hairColor: '发色',
                        outfit: '服装配色',
                        accessory: '配饰',
                      }[key]
                    }
                    value={draft.character[key]}
                    onChange={(v) => changeCharacter(key, v)}
                  />
                ))}
                <p className="editor-note">
                  想换账号头像？点击顶部昵称，在个人资料中选择默认头像或上传图片。
                </p>
              </>
            ) : (
              <>
                <fieldset className="asset-field">
                  <legend>空间风格</legend>
                  <div className="personal-theme-options">
                    {(['library', 'rain', 'night'] as const).map((t) => (
                      <button
                        key={t}
                        type="button"
                        aria-pressed={draft.space.theme === t}
                        data-theme={t}
                        onClick={() => {
                          setDraft((d) =>
                            d
                              ? {
                                  ...d,
                                  space: {
                                    ...d.space,
                                    theme: t,
                                    light: t === 'night' ? 'light.warm' : 'light.day',
                                    sound: themes[t].sound as SpaceConfig['sound'],
                                  },
                                }
                              : d,
                          );
                          setNotice('');
                        }}
                      >
                        <i aria-hidden="true" />
                        <span>{themes[t].name}</span>
                      </button>
                    ))}
                  </div>
                </fieldset>
                <Choices
                  category="room"
                  label="基础房型"
                  value={draft.space.room}
                  onChange={(v) => changeSpace('room', v)}
                />
                {!onboarding ? (
                  <>
                    <Choices
                      category="desk"
                      label="桌子"
                      value={draft.space.desk}
                      onChange={(v) => changeSpace('desk', v)}
                    />
                    <Choices
                      category="chair"
                      label="椅子"
                      value={draft.space.chair}
                      onChange={(v) => changeSpace('chair', v)}
                    />
                    <details className="slot-details" open>
                      <summary>
                        摆放槽位 <small>预设位置，座位始终可用</small>
                      </summary>
                      {(['desktop', 'wall', 'window', 'rug'] as const).map((key) => (
                        <Choices
                          key={key}
                          category={key}
                          label={
                            { desktop: '桌面', wall: '墙面', window: '窗边', rug: '地毯区' }[key]
                          }
                          value={draft.space.slots[key]}
                          onChange={(v) => changeSlot(key, v)}
                        />
                      ))}
                    </details>
                    <Choices
                      category="light"
                      label="灯光"
                      value={draft.space.light}
                      onChange={(v) => changeSpace('light', v)}
                    />
                    <label>
                      推荐环境音
                      <select
                        value={draft.space.sound}
                        onChange={(e) => changeSpace('sound', e.target.value)}
                      >
                        <option value="birds">林间鸟鸣</option>
                        <option value="rain">细雨</option>
                        <option value="fire">炉火</option>
                        <option value="stream">溪流</option>
                      </select>
                    </label>
                  </>
                ) : null}
                <p className="editor-note">
                  保存后用于下一次共学。已经开始接待的房间会保留原布置，推荐声音由每个人自行播放。
                </p>
              </>
            )}
          </fieldset>
          {onboarding ? (
            <button
              className="button secondary full"
              onClick={() => setTab(tab === 'space' ? 'character' : 'space')}
            >
              {tab === 'character' ? '下一步：看看空间' : '返回选择形象'}
            </button>
          ) : null}
        </aside>
      </div>
      <div className="personal-savebar">
        <div>
          <strong>
            {onboarding
              ? '随时可以回来修改'
              : dirty
                ? '喜欢的话，就留下这套搭配'
                : '你的形象与自习室已就位'}
          </strong>
          <span>角色随你进入不同房间 · 个人空间长期保留</span>
        </div>
        <div className="personal-save-actions">
          {onboarding ? (
            <button className="text-button" disabled={busy} onClick={() => void save(true)}>
              跳过，直接开始
            </button>
          ) : (
            <>
              <button
                className="text-button"
                disabled={busy}
                onClick={() => {
                  setDraft((d) =>
                    d
                      ? {
                          ...d,
                          character: structuredClone(DEFAULT_CHARACTER),
                          space: structuredClone(DEFAULT_SPACE),
                        }
                      : d,
                  );
                  setNotice('已恢复默认预览，保存后生效。');
                }}
              >
                恢复默认
              </button>
              <button
                className="button secondary"
                disabled={busy || !dirty}
                onClick={() => {
                  setDraft(saved);
                  setError('');
                  setNotice('已取消编辑，恢复到最近保存的搭配。');
                }}
              >
                取消编辑
              </button>
            </>
          )}
          <button
            className="button primary"
            disabled={busy || (!dirty && !onboarding)}
            onClick={() => void save()}
          >
            {busy ? '正在保存…' : onboarding ? '保存并开始学习 ↗' : '保存搭配'}
          </button>
        </div>
      </div>
      {error ? (
        <button
          className="text-button"
          disabled={busy}
          onClick={() => {
            if (window.confirm('载入服务器上已保存的版本会替换当前草稿，继续？')) void load();
          }}
        >
          载入已保存版本
        </button>
      ) : null}
      {!onboarding ? (
        <>
          <AmbientAudio recommended={draft.space.sound} />
          <Link to="/#room-entry" className="personal-host-link">
            用已保存的空间发起共学 →
          </Link>
        </>
      ) : null}
    </div>
  );
}
