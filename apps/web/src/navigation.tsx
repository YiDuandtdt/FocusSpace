import { useEffect } from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';

/** Keep list navigation shareable and restore it on refresh/back. */
export function useListLocation(prefix = '') {
  const [params, setParams] = useSearchParams();
  const get = (key: string) => params.get(prefix + key) ?? '';
  const update = (values: Record<string, string | number>) => {
    setParams((previous) => {
      const next = new URLSearchParams(previous);
      for (const [key, value] of Object.entries(values)) {
        if (value === '' || (key === 'page' && value === 1)) next.delete(prefix + key);
        else next.set(prefix + key, String(value));
      }
      return next;
    });
  };
  const rawPage = Number(get('page'));
  const page = Number.isSafeInteger(rawPage) && rawPage > 0 ? rawPage : 1;
  return { get, update, page };
}

export function RouteAnnouncer() {
  const { pathname, hash } = useLocation();
  const name =
    pathname === '/login'
      ? '登录'
      : pathname === '/register'
        ? '注册'
        : pathname === '/history'
          ? '学习历史'
          : pathname.startsWith('/admin')
            ? '管理共学空间'
            : pathname.startsWith('/join/')
              ? '共学邀请'
              : pathname.endsWith('/summary')
                ? '学习总结'
                : pathname.startsWith('/rooms/')
                  ? '共学房间'
                  : pathname === '/'
                    ? '我的空间'
                    : '页面未找到';
  useEffect(() => {
    document.title = `${name} · FocusSpace`;
    if (hash) {
      const frame = requestAnimationFrame(() =>
        document.getElementById(hash.slice(1))?.scrollIntoView(),
      );
      return () => cancelAnimationFrame(frame);
    }
    window.scrollTo({ top: 0, behavior: 'instant' });
    document.getElementById('main-content')?.focus({ preventScroll: true });
  }, [pathname, hash, name]);
  return (
    <span className="sr-only" role="status">
      {name}
    </span>
  );
}
