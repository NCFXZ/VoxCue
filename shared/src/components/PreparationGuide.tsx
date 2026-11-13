import { useId, useState } from 'react';
import { t } from '../i18n';
import { openChatLink } from '../services/chat';
import {
  preparationGuideUrl,
  type PreparationAction,
  type PreparationStep,
} from '../services/preparationGuide';
import { useGeneralSettings } from '../stores/generalSettings';
import { Button } from './ui/button';
import { ArrowUpRight } from './icons';

const defaults: Record<PreparationStep, string> = {
  resume: '添加简历，让面试准备更贴合你的经历。',
  job: '简历已保存。补充目标岗位，或直接开始面试。',
  skills: '结合已保存的简历和职位描述，准备相关的面试技能。',
  ready: '先检查麦克风和系统声音，再打开面试窗口。资料可以随时继续补充。',
};
const explanations: Record<PreparationAction, string> = {
  upload: '上传简历，整理成待确认的个人经历摘要。',
  resume: '粘贴简历内容，整理后由你确认保存。',
  job: '添加目标岗位的职位描述，让准备更有针对性。',
  skills: '结合简历和当前岗位，生成或更新相关面试技能。',
  profile: '查看或编辑已保存的简历、职位描述和面试资料。',
  interview: '检查声音与面试设置，准备好后进入面试窗口。',
};

export function PreparationGuide({
  actions,
  step,
  disabled,
  onAction,
}: {
  actions: { id: PreparationAction; label: string }[];
  step: PreparationStep;
  disabled: boolean;
  onAction(action: PreparationAction): void;
}) {
  const language = useGeneralSettings((state) => state.language);
  const guideUrl = preparationGuideUrl(language);
  const [linkError, setLinkError] = useState(false);
  const [hovered, setHovered] = useState<PreparationAction>();
  const [focused, setFocused] = useState<PreparationAction>();
  const descriptionId = useId();
  const selected = hovered ?? focused;
  const active = !disabled && actions.some(({ id }) => id === selected) ? selected : 'default';
  return (
    <section className="preparation-guide" aria-label={t('接下来想做什么？')}>
      <h1>{t('接下来想做什么？')}</h1>
      <p className="preparation-guide-description">
        {[
          { id: 'default', text: defaults[step] },
          ...actions.map(({ id }) => ({ id, text: explanations[id] })),
        ].map(({ id, text }) => (
          <span
            key={id}
            id={`${descriptionId}-${id}`}
            className={active === id ? 'is-active' : undefined}
            aria-hidden={active !== id}
          >
            {t(text)}
          </span>
        ))}
      </p>
      <div className="preparation-guide-actions">
        {actions.map(({ id, label }) => (
          <Button
            key={id}
            variant="outline"
            disabled={disabled}
            onClick={() => onAction(id)}
            aria-describedby={`${descriptionId}-${id}`}
            onMouseEnter={() => setHovered(id)}
            onMouseLeave={() => setHovered(undefined)}
            onFocus={(event) => {
              if (event.currentTarget.matches(':focus-visible')) setFocused(id);
            }}
            onBlur={() => setFocused(undefined)}
          >
            {t(label)}
            <ArrowUpRight size={14} aria-hidden="true" />
          </Button>
        ))}
      </div>
      <a
        className="preparation-guide-link"
        href={guideUrl}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(event) => {
          if (!window.desktop) return;
          event.preventDefault();
          setLinkError(false);
          void openChatLink(guideUrl).catch(() => setLinkError(true));
        }}
      >
        {t('使用指南')}
        <ArrowUpRight size={14} aria-hidden="true" />
      </a>
      {linkError && (
        <p className="inline-error" role="alert">
          {t('无法打开使用指南，请稍后重试。')}
        </p>
      )}
    </section>
  );
}
