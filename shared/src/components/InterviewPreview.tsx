import { useEffect, useRef } from 'react';
import landscape from '../assets/interview-landscape.jpg';
import storyPath from '../assets/interview-story-path.jpg';
import storyNotebook from '../assets/interview-story-notebook.jpg';
import { interviewAlwaysDark } from './ui/appearance-control';
import { MarkdownContent } from './MarkdownContent';
import { AppLogo } from './AppLogo';
import { ProviderIdentity } from './ProviderIdentity';
import { InterviewChromeBase } from './InterviewChromeBase';
import {
  ArrowUp,
  AudioLines,
  ChevronUp,
  Copy,
  MessageSquare,
  Settings,
  ShieldCheck,
  Sparkles,
  Screenshot,
  Volume2,
  Square,
  DragGrip,
} from './icons';

// One sample layout for settings and login, using the actual interview materials.
export function InterviewPreview({
  compact = false,
  label = '面试界面预览',
}: {
  compact?: boolean;
  label?: string;
}) {
  const background = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = background.current;
    if (!node || compact) return;
    const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
    let frame = 0;
    let timer: ReturnType<typeof window.setTimeout> | undefined;
    let started = false;
    let cancelled = false;
    let scriptedTop = node.scrollTop;
    const cancel = () => {
      cancelled = true;
      window.clearTimeout(timer);
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
    const animate = (target: number) => {
      const from = node.scrollTop;
      let start: number | undefined;
      const tick = (now: number) => {
        if (cancelled) return;
        const progress = Math.min(1, (now - (start ??= now)) / 800);
        node.scrollTop = from + (target - from) * (1 - (1 - progress) ** 3);
        scriptedTop = node.scrollTop;
        if (progress < 1) frame = requestAnimationFrame(tick);
        else {
          frame = 0;
          cancel();
        }
      };
      frame = requestAnimationFrame(tick);
    };
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (reducedMotion.matches || (node.scrollTop > 0 && !started)) return cancel();
        if (!entry.isIntersecting || entry.intersectionRatio < 0.35) {
          if (started) cancel();
          return;
        }
        if (started || cancelled) return;
        started = true;
        timer = window.setTimeout(() => {
          timer = undefined;
          if (cancelled) return;
          const target = Math.max(0, node.firstElementChild!.clientHeight - node.clientHeight / 2);
          animate(target);
        }, 1000);
      },
      { threshold: 0.35 },
    );
    const visibility = () => {
      if (document.hidden) cancel();
    };
    const motion = () => {
      if (reducedMotion.matches) cancel();
    };
    const scroll = () => {
      if (!cancelled && node.scrollTop !== scriptedTop) cancel();
    };
    observer.observe(node);
    for (const event of ['wheel', 'pointerdown', 'touchstart', 'keydown'])
      node.addEventListener(event, cancel, { passive: true });
    node.addEventListener('scroll', scroll, { passive: true });
    reducedMotion.addEventListener('change', motion);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      cancel();
      for (const event of ['wheel', 'pointerdown', 'touchstart', 'keydown'])
        node.removeEventListener(event, cancel);
      node.removeEventListener('scroll', scroll);
      reducedMotion.removeEventListener('change', motion);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, [compact]);
  return (
    <div
      className={`interview-preview-scene${interviewAlwaysDark ? ' dark' : ''}${compact ? ' login-interview-preview' : ''}`}
      role="region"
      aria-label={label}
    >
      {!compact && (
        <div
          ref={background}
          className="interview-preview-background"
          role="region"
          aria-label="预览背景，可上下滚动"
          tabIndex={0}
        >
          <section className="preview-backdrop-photo" aria-label="全图片背景">
            <img src={landscape} alt="群山与森林环绕的湖泊" loading="lazy" decoding="async" />
          </section>
          <section className="preview-backdrop-paper" aria-label="全文字背景">
            <div className="preview-backdrop-copy">
              <span>湖畔的一天</span>
              <h4>从一片湖水开始。</h4>
              <p>
                午后的风很轻，一片清澈的湖泊静静铺展在群山之间。远处的山峰还留着浅浅的积雪，阳光沿着岩壁缓缓移动，把山脊的轮廓照得明亮。我在湖岸边停下来，原本排得很满的行程，忽然也不那么着急了。
              </p>
              <p>
                两岸的针叶林一直延伸到水边，深绿色的树影与蓝色天空一同映入湖面。近处的水更浅，透过轻柔的波纹，可以看见水下层叠的石块。偶尔有一阵风掠过，倒影便散开，过一会儿，又慢慢聚成完整的山林。
              </p>
              <p>
                我把手机放回口袋，沿着湖岸向前走。脚下的碎石发出细小的声响，松针的气味混在空气里。那些刚才只在远处看见的颜色，此刻变成了身边的树叶、石头和水光，每走几步，都有一点新的发现。
              </p>
              <p>
                太阳渐渐落到树梢后面，湖面从明亮的蓝色变成柔和的青灰。林间有一条窄窄的小路，尽头透出暖黄的灯光。我顺着那束光走去，想找个地方坐一会儿，也想把这段没有计划的散步记下来。
              </p>
            </div>
          </section>
          <section className="preview-backdrop-night preview-story" aria-label="林间书屋，深色背景">
            <div className="preview-story-art">
              <img
                src={storyPath}
                alt="沿湖小路通向亮着暖灯的林间书屋"
                loading="lazy"
                decoding="async"
              />
            </div>
            <div className="preview-backdrop-copy">
              <span>顺着灯光走</span>
              <h4>林间有一家小书屋。</h4>
              <p>
                小路尽头是一间木屋，窗边堆着旧书，门口的灯刚刚亮起。暮色把森林染成深蓝，屋里的光却很温柔。我推开门，风声留在身后，只听见书页翻动的声音。
              </p>
              <p>
                店主递来一杯热茶，指了指靠窗的位置。从那里仍能看见湖面，只是远山已经隐进夜色。我取出随身的小本子，终于有时间，把白天匆匆看见的风景重新想一遍。
              </p>
            </div>
          </section>
          <section className="preview-backdrop-color preview-story" aria-label="灯下记录，彩色背景">
            <div className="preview-backdrop-copy">
              <span>把今天留在纸上</span>
              <h4>一盏灯，一页新的故事。</h4>
              <p>
                台灯在桌面铺开一圈暖金色，茶杯里升起细细的热气。我先画下湖岸的线条，又补上树影与远山。纸上的颜色不必与眼前完全相同，只要能让我记起，当时为什么停下脚步。
              </p>
              <p>
                窗外的第一颗星亮了，湖水安静地接住夜空。我在画旁写下几句话，合上本子。明天还会继续赶路，而这一小段慢下来的时光，已经有了可以再次翻开的形状。
              </p>
            </div>
            <div className="preview-story-art">
              <img
                src={storyNotebook}
                alt="窗边台灯照亮茶杯与画着湖景的手帐"
                loading="lazy"
                decoding="async"
              />
            </div>
          </section>
        </div>
      )}
      {/* Use the real surface classes, so chrome, panels and bubbles retain
            their distinct opacity and accessibility contrast rules. */}
      <div className="interview-preview-shell">
        <div className="floating-toolbar">
          <span className="floating-brand" data-interview-preview-button>
            <ChevronUp size={16} />
            <AppLogo size={17} />
            <strong>VoxCue</strong>
          </span>
          <span className="interview-preview-tools">
            <span className="interview-preview-icon" data-interview-preview-button>
              <Settings size={19} />
            </span>
            <span className="interview-preview-icon" data-interview-preview-button>
              <ShieldCheck size={18} />
            </span>
            <span className="interview-preview-icon danger-text" data-interview-preview-button>
              <Square size={17} />
            </span>
            <span className="interview-preview-icon" data-interview-preview-button>
              <DragGrip size={18} />
            </span>
          </span>
        </div>
        <div className="interview-font-preview">
          <section className="floating-panel">
            <header>
              <h2>
                <Volume2 size={16} />
                转写
              </h2>
            </header>
            <div className="floating-scroll">
              <article className="transcript-item interviewer">
                <div className="transcript-meta">
                  <strong>面试官</strong>
                  <time>14:18</time>
                </div>
                <p className="interview-font-sample">请介绍一个你负责过的项目。</p>
              </article>
              <article className="transcript-item interviewee">
                <div className="transcript-meta">
                  <strong>面试者</strong>
                  <time>14:19</time>
                </div>
                <p className="interview-font-sample">我负责了项目的设计与交付。</p>
              </article>
            </div>
          </section>
          <section className="floating-panel floating-answer">
            {!compact && <InterviewChromeBase />}
            <header>
              <h2>
                <MessageSquare size={17} />
                回答
              </h2>
              <span
                className="floating-toggle interview-preview-tools interview-preview-capsule"
                data-interview-preview-button
              >
                <span className="toggle-dot" />
                <AudioLines size={14} />
                转写
              </span>
            </header>
            <div className="floating-scroll">
              <div className="floating-question interview-font-sample">
                请介绍一个你负责过的项目。
              </div>
              <div className="floating-answer-meta">
                <span className="provider-identity">
                  <ProviderIdentity provider="chatgpt" />
                </span>
                <Copy size={14} />
              </div>
              <div className="answer-text answer-bubble interview-font-sample">
                <MarkdownContent content="先说明**项目目标**，再介绍你的工作和结果。" />
              </div>
            </div>
            <div className="floating-composer">
              <textarea
                aria-label="预览输入框"
                tabIndex={-1}
                readOnly
                rows={2}
                placeholder="输入问题…"
              />
              <div className="floating-composer-toolbar">
                <span
                  className="floating-toggle interview-preview-tools interview-preview-capsule"
                  data-interview-preview-button
                >
                  <span className="toggle-dot" />
                  <Sparkles size={14} />
                  自动回答：开
                </span>
                <span className="floating-composer-actions">
                  <Screenshot size={18} />
                  <span className="send-button ui-button button-icon">
                    <ArrowUp size={18} />
                  </span>
                </span>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
