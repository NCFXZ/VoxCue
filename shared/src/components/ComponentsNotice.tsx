import type { ComponentId } from '../../electron/contracts/components';
import { useComponents } from '../stores/components';
import { ArrowUpRight } from './icons';
import { Button } from './ui/button';

export function ComponentsNotice({
  only,
  onSettings,
}: {
  only?: ComponentId;
  onSettings?(): void;
}) {
  const state = useComponents((store) => store.state);
  if (!window.desktop?.components || !state) return null;
  const missing = state.items.filter(
    (item) => item.phase !== 'ready' && (only ? item.id === only : !item.optional),
  );
  if (!missing.length) return null;
  return (
    <aside className="components-notice" aria-label="本地组件提示">
      <div>
        <strong>{only ? `${missing[0].label}尚未就绪` : '本地组件尚未就绪'}</strong>
        <p>
          {!only && `${missing.map((item) => item.label).join('、')}。`}请在设置中下载或查看进度。
        </p>
      </div>
      <Button variant="ghost" onClick={onSettings}>
        前往设置 <ArrowUpRight size={14} />
      </Button>
    </aside>
  );
}
