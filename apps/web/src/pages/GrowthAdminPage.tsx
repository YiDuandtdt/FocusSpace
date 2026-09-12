import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { GROWTH_CATALOG, type RewardRules, type GrowthLedger } from '@focusspace/shared';
import { api, errorMessage } from '../api';
import { createRequestId } from '../requestId';
import { useAuth } from '../auth';
import { Notice } from '../components';
type Data = {
  items: { id: string; price: number; minLevel: number; status: string }[];
  rules: RewardRules;
  ledger: GrowthLedger[];
  total: number;
  page: number;
  assets: { assetId: string; source: string }[];
  account: { xp: number; coins: number; level: number } | null;
};
const ruleNames: Record<string, string> = {
  xpPerMinute: '每分钟经验',
  coinsPerMinute: '每分钟币',
  roundXp: '轮次经验',
  roundCoins: '轮次币',
  goalXp: '每日目标经验',
  goalCoins: '每日目标币',
  togetherXp: '每日共学经验',
  togetherCoins: '每日共学币',
};
export function GrowthAdminPage() {
  const { user } = useAuth();
  const [data, setData] = useState<Data | null>(null),
    [q, setQ] = useState(''),
    [lookup, setLookup] = useState(''),
    [page, setPage] = useState(1),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [busy, setBusy] = useState(false),
    [asset, setAsset] = useState('outfit.clay');
  const pending = useRef<{ key: string; id: string } | null>(null);
  async function load() {
    try {
      setData(await api<Data>(`/admin/growth?userId=${encodeURIComponent(lookup)}&page=${page}`));
      setError('');
    } catch (e) {
      setError(errorMessage(e));
    }
  }
  useEffect(() => {
    if (user?.role === 'ADMIN') void load();
  }, [lookup, page, user?.role]);
  async function submit(e: FormEvent<HTMLFormElement>, action: string) {
    e.preventDefault();
    if (busy || !data) return;
    const form = new FormData(e.currentTarget),
      reason = String(form.get('reason') ?? '');
    let payload: Record<string, unknown> = { action, reason };
    if (action === 'item')
      payload = {
        ...payload,
        assetId: asset,
        price: Number(form.get('price')),
        minLevel: Number(form.get('minLevel')),
        status: form.get('status'),
      };
    else if (action === 'compensate')
      payload = {
        ...payload,
        userId: form.get('userId'),
        xp: Number(form.get('xp')),
        coins: Number(form.get('coins')),
        ...(form.get('assetId') ? { assetId: form.get('assetId') } : {}),
      };
    else
      payload = {
        ...payload,
        rules: {
          version: data.rules.version,
          ...Object.fromEntries(Object.keys(ruleNames).map((key) => [key, Number(form.get(key))])),
        },
      };
    const key = JSON.stringify(payload);
    if (pending.current?.key !== key) pending.current = { key, id: createRequestId() };
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const result = await api<{ auditId: string }>('/admin/growth', {
        method: 'POST',
        body: { ...payload, requestId: pending.current.id },
      });
      setNotice(`操作已保存，审计编号：${result.auditId}`);
      await load();
      pending.current = null;
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  if (user?.role !== 'ADMIN') return <Notice>仅管理员可访问成长管理。</Notice>;
  const item = data?.items.find((i) => i.id === asset);
  const reason = (
    <label>
      操作原因（必填）
      <textarea
        name="reason"
        required
        minLength={3}
        maxLength={300}
        placeholder="说明变更、补发或纠错依据"
      />
    </label>
  );
  return (
    <div className="growth-admin">
      <Link to="/admin">← 管理后台</Link>
      <div className="page-heading">
        <h1>成长与资产管理</h1>
        <p>所有修改留存审计。基础资源受保护；下架停止新获取，停用会使用基础替代。</p>
      </div>
      {error ? (
        <Notice>
          {error} <button onClick={() => void load()}>重新读取</button>
        </Notice>
      ) : null}
      {notice ? (
        <Notice tone="success">
          {notice} <Link to="/admin?tab=audits">查看审计 →</Link>
        </Notice>
      ) : null}
      {data ? (
        <>
          <div className="admin-grid">
            <section className="panel">
              <h2>目录配置</h2>
              <label>
                已实现的资源
                <select value={asset} onChange={(e) => setAsset(e.target.value)}>
                  {GROWTH_CATALOG.map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.name} · {i.id}
                      {i.basic ? ' · 基础保护' : ''}
                    </option>
                  ))}
                </select>
              </label>
              {item ? (
                <form
                  key={`${asset}-${item.price}-${item.minLevel}-${item.status}`}
                  onSubmit={(e) => void submit(e, 'item')}
                >
                  <label>
                    学习币价格
                    <input
                      name="price"
                      type="number"
                      min="0"
                      max="10000"
                      defaultValue={item.price}
                      required
                    />
                  </label>
                  <label>
                    最低等级
                    <input
                      name="minLevel"
                      type="number"
                      min="1"
                      max="30"
                      defaultValue={item.minLevel}
                      required
                    />
                  </label>
                  <label>
                    状态
                    <select name="status" defaultValue={item.status}>
                      <option value="ACTIVE">启用</option>
                      <option value="DELISTED">下架（已有可用）</option>
                      <option value="DISABLED">停用（基础替代）</option>
                    </select>
                  </label>
                  {reason}
                  <button className="button primary" disabled={busy}>
                    保存物品配置
                  </button>
                </form>
              ) : null}
              <Link to="/growth">查看生成器预览 →</Link>
            </section>
            <section className="panel">
              <h2>补发与纠错</h2>
              <p>正数补发、负币纠错，不能出现负余额。经验不扣减；资产补发永久保留。</p>
              <form onSubmit={(e) => void submit(e, 'compensate')}>
                <label>
                  用户 ID
                  <input name="userId" defaultValue={lookup} required />
                </label>
                <label>
                  经验增加
                  <input name="xp" type="number" min="0" max="10000" defaultValue="0" required />
                </label>
                <label>
                  学习币变动
                  <input
                    name="coins"
                    type="number"
                    min="-10000"
                    max="10000"
                    defaultValue="0"
                    required
                  />
                </label>
                <label>
                  补发资产（可选）
                  <select name="assetId">
                    <option value="">不补发资产</option>
                    {GROWTH_CATALOG.map((i) => (
                      <option key={i.id} value={i.id}>
                        {i.name}
                      </option>
                    ))}
                  </select>
                </label>
                {reason}
                <button className="button primary" disabled={busy}>
                  记入补偿流水
                </button>
              </form>
              <Link to="/admin?tab=users">查找用户 ID →</Link>
            </section>
          </div>
          <details className="panel">
            <summary>奖励规则 v{data.rules.version} · 仅影响之后新建的 Session</summary>
            <form key={data.rules.version} onSubmit={(e) => void submit(e, 'rules')}>
              <div className="admin-grid">
                {Object.entries(ruleNames).map(([key, label]) => (
                  <label key={key}>
                    {label}
                    <input
                      type="number"
                      name={key}
                      defaultValue={data.rules[key as keyof RewardRules]}
                      min={key.includes('PerMinute') ? 1 : 0}
                      max={
                        key === 'roundXp'
                          ? 50
                          : key === 'coinsPerMinute' ||
                              key === 'goalCoins' ||
                              key === 'togetherCoins'
                            ? 10
                            : 20
                      }
                      required
                    />
                  </label>
                ))}
              </div>
              {reason}
              <button className="button primary" disabled={busy}>
                发布下一版本规则
              </button>
            </form>
          </details>
          <section className="panel">
            <h2>资产与流水查询</h2>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                setLookup(q);
                setPage(1);
              }}
            >
              <label>
                用户 ID（留空查看所有流水）
                <input value={q} onChange={(e) => setQ(e.target.value)} maxLength={100} />
              </label>
              <button className="button secondary">查询</button>
            </form>
            {data.account ? (
              <p>
                Lv.{data.account.level} · {data.account.xp} 经验 · {data.account.coins} 学习币
              </p>
            ) : lookup ? (
              <p>尚无成长账户，请核对用户 ID。</p>
            ) : null}
            {lookup ? (
              <details>
                <summary>拥有资产 · {data.assets.length}</summary>
                {data.assets.map((a) => (
                  <p key={a.assetId}>
                    {GROWTH_CATALOG.find((i) => i.id === a.assetId)?.name ?? a.assetId} ·{' '}
                    <code>{a.assetId}</code> · {a.source}
                  </p>
                ))}
              </details>
            ) : null}
            <div className="growth-table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>时间 / 用户</th>
                    <th>来源 / 关联</th>
                    <th>经验 / 币</th>
                    <th>原因</th>
                  </tr>
                </thead>
                <tbody>
                  {data.ledger.map((l) => (
                    <tr key={l.id}>
                      <td>
                        {new Date(l.createdAt).toLocaleString('zh-CN')}
                        <br />
                        <code>{(l as GrowthLedger & { userId: string }).userId}</code>
                      </td>
                      <td>
                        {l.source} · v{l.ruleVersion}
                        <br />
                        <code>{l.recordId ?? l.assetId ?? l.id}</code>
                      </td>
                      <td>
                        {l.xp} / {l.coins}
                      </td>
                      <td>{l.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="growth-actions">
              <button disabled={page === 1} onClick={() => setPage((p) => p - 1)}>
                上一页
              </button>
              <span>
                第 {page} 页 · 共 {data.total} 笔
              </span>
              <button disabled={page * 30 >= data.total} onClick={() => setPage((p) => p + 1)}>
                下一页
              </button>
            </div>
          </section>
        </>
      ) : !error ? (
        <p role="status">读取管理数据…</p>
      ) : null}
    </div>
  );
}
