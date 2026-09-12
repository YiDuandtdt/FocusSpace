import { useEffect, useMemo, useState } from 'react';
import type { AnalyticsReport } from '@focusspace/shared';
import { api, errorMessage } from '../api';
import { Notice } from '../components';

const minutes = (seconds: number) => `${Math.floor(seconds / 60)} 分`;
const percentChange = (now: number, before: number) =>
  before ? Math.round(((now - before) / before) * 100) : now ? 100 : 0;

function Trend({ data }: { data: AnalyticsReport['trend'] }) {
  const max = Math.max(60, ...data.map((point) => point.focusSeconds));
  const points = data
    .map(
      (point, index) =>
        `${(index / Math.max(1, data.length - 1)) * 100},${96 - (point.focusSeconds / max) * 82}`,
    )
    .join(' ');
  return (
    <div className="trend-chart">
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label="专注时间趋势图">
        <defs>
          <linearGradient id="trend-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#577e6d" stopOpacity=".36" />
            <stop offset="1" stopColor="#577e6d" stopOpacity="0" />
          </linearGradient>
        </defs>
        <polygon points={`0,100 ${points} 100,100`} fill="url(#trend-fill)" />
        <polyline
          points={points}
          fill="none"
          stroke="#365e50"
          strokeWidth="2"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <div className="trend-labels">
        {data
          .filter((_, index) => index % Math.max(1, Math.ceil(data.length / 7)) === 0)
          .map((point) => (
            <span key={point.key}>{point.label}</span>
          ))}
      </div>
    </div>
  );
}

export function AnalyticsPage() {
  const [period, setPeriod] = useState<AnalyticsReport['period']>('week');
  const [data, setData] = useState<AnalyticsReport | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let alive = true;
    setData(null);
    setError('');
    void api<AnalyticsReport>(`/users/me/analytics?period=${period}`)
      .then((result) => {
        if (alive) setData(result);
      })
      .catch((e) => {
        if (alive) setError(errorMessage(e));
      });
    return () => {
      alive = false;
    };
  }, [period]);
  const pie = useMemo(() => {
    if (!data?.labels.length) return 'conic-gradient(#dfe7e2 0 100%)';
    const total =
      data.labels.reduce((sum, item) => sum + item.focusSeconds, 0) || data.labels.length;
    let at = 0;
    const colors = ['#426b5b', '#87aa99', '#ddaa78', '#8b9eb8', '#b59cb9', '#d5c46c'];
    return `conic-gradient(${data.labels
      .slice(0, 6)
      .map((item, index) => {
        const start = at;
        at += ((item.focusSeconds || 1) / total) * 100;
        return `${colors[index]} ${start}% ${at}%`;
      })
      .join(',')})`;
  }, [data]);
  return (
    <div className="planning-page analytics-page">
      <div className="planning-heading">
        <div>
          <span className="eyebrow">STUDY IN FOCUS</span>
          <h1>数据统计</h1>
          <p>从时间、标签和任务三个角度回看投入。</p>
        </div>
        <div className="period-tabs">
          {(
            [
              ['day', '每日'],
              ['week', '每周'],
              ['month', '每月'],
            ] as const
          ).map(([key, label]) => (
            <button key={key} aria-pressed={period === key} onClick={() => setPeriod(key)}>
              {label}
            </button>
          ))}
        </div>
      </div>
      {error ? (
        <Notice>{error}</Notice>
      ) : !data ? (
        <section className="panel" role="status">
          正在整理学习数据…
        </section>
      ) : (
        <>
          <section className="analytics-metrics">
            <div>
              <span>有效专注</span>
              <strong>{minutes(data.totals.focusSeconds)}</strong>
              <small
                className={
                  percentChange(data.totals.focusSeconds, data.previous.focusSeconds) >= 0
                    ? 'positive'
                    : ''
                }
              >
                较上一周期{' '}
                {percentChange(data.totals.focusSeconds, data.previous.focusSeconds) >= 0
                  ? '+'
                  : ''}
                {percentChange(data.totals.focusSeconds, data.previous.focusSeconds)}%
              </small>
            </div>
            <div>
              <span>完成共学</span>
              <strong>{data.totals.sessions} 场</strong>
              <small>上一周期 {data.previous.sessions} 场</small>
            </div>
            <div>
              <span>任务完成</span>
              <strong>
                {data.totals.tasksDone} / {data.totals.tasksTotal}
              </strong>
              <small>
                {data.totals.tasksTotal
                  ? Math.round((data.totals.tasksDone / data.totals.tasksTotal) * 100)
                  : 0}
                % 完成率
              </small>
            </div>
          </section>
          <div className="analytics-grid">
            <section className="chart-card trend-card">
              <div>
                <span className="eyebrow">TIME TREND</span>
                <h2>专注趋势</h2>
              </div>
              <Trend data={data.trend} />
            </section>
            <section className="chart-card">
              <span className="eyebrow">LABEL MIX</span>
              <h2>标签占比</h2>
              <div className="pie-layout">
                <div
                  className="pie-chart"
                  style={{ background: pie }}
                  aria-label="标签专注占比饼状图"
                />
                <ol>
                  {data.labels.slice(0, 6).map((item) => (
                    <li key={item.label}>
                      <strong>{item.label}</strong>
                      <span>
                        {minutes(item.focusSeconds)} · {item.tasksDone}/{item.tasksTotal}
                      </span>
                    </li>
                  ))}
                </ol>
              </div>
              {!data.labels.length ? (
                <p className="muted">为任务添加标签后，这里会形成分布。</p>
              ) : null}
            </section>
          </div>
          <section className="chart-card heat-card">
            <div>
              <span className="eyebrow">LAST 12 WEEKS</span>
              <h2>学习热力图</h2>
            </div>
            <div className="heatmap" aria-label="近十二周每日专注热力图">
              {data.heatmap.map((day) => {
                const level =
                  day.focusSeconds === 0
                    ? 0
                    : day.focusSeconds < 1500
                      ? 1
                      : day.focusSeconds < 3000
                        ? 2
                        : day.focusSeconds < 5400
                          ? 3
                          : 4;
                return (
                  <i
                    key={day.date}
                    data-level={level}
                    title={`${day.date} · ${minutes(day.focusSeconds)}`}
                  />
                );
              })}
            </div>
            <div className="heat-legend">
              <span>少</span>
              {[0, 1, 2, 3, 4].map((level) => (
                <i key={level} data-level={level} />
              ))}
              <span>多</span>
            </div>
          </section>
          <section className="chart-card task-dimension">
            <div>
              <span className="eyebrow">TASK DETAIL</span>
              <h2>任务维度</h2>
            </div>
            {data.tasks.length ? (
              <div className="analytics-table" role="table">
                {data.tasks.map((task, index) => (
                  <div role="row" key={`${task.title}-${index}`}>
                    <span role="cell" className={task.completed ? 'task-done' : ''}>
                      {task.title}
                    </span>
                    <span role="cell">
                      {task.labels.length
                        ? task.labels.map((label) => `#${label}`).join(' ')
                        : '未分类'}
                    </span>
                    <strong role="cell">{minutes(task.focusSeconds)}</strong>
                    <span role="cell">{task.completed ? '已完成' : '进行中'}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="muted">这个周期还没有任务数据。</p>
            )}
          </section>
        </>
      )}
    </div>
  );
}
