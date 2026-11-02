import { t } from '../i18n';
import { useEffect, useRef } from 'react';
import storyMeeting from '../assets/interview-story-meeting.jpg';
import storyDistance from '../assets/interview-story-distance.jpg';
import storyHome from '../assets/interview-story-home.jpg';
import easterEgg from '../assets/interview-easter-egg.jpg';
import { interviewAlwaysDark } from './ui/appearance-control';
import { MarkdownContent } from './MarkdownContent';
import { AppLogo } from './AppLogo';
import { ProviderIdentity } from './ProviderIdentity';
import { InterviewChromeBase } from './InterviewChromeBase';
import { installPreviewScroll } from './ui/preview-scroll';
import { installPreviewTranscript } from './ui/preview-transcript';
import { interviewPanelAnimation } from './ui/interview-panel-animation';
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
  const toggle = useRef<HTMLButtonElement>(null);
  const TranscriptControl = compact ? 'span' : 'button';
  useEffect(() => {
    const node = background.current;
    if (!node || compact) return;
    const shell = node.parentElement!.querySelector<HTMLElement>('.interview-preview-shell')!;
    const panels = shell.querySelector<HTMLElement>('.interview-font-preview')!;
    const chevron = shell.querySelector<SVGElement>('.floating-brand > svg')!;
    const photo = node.querySelector<HTMLElement>('.preview-backdrop-easter-egg')!;
    const disposeTranscript = installPreviewTranscript(
      panels,
      panels.querySelector<HTMLButtonElement>('button.floating-toggle')!,
    );
    // Decode offscreen so the first reveal only changes layout and scroll position.
    void photo
      .querySelector<HTMLImageElement>('img')!
      .decode()
      .catch(() => {});
    const players: Animation[] = [];
    let scrubbing = false;
    const clearPlayers = () => {
      for (const player of players) player.cancel();
      players.length = 0;
      scrubbing = false;
    };
    const disposeScroll = installPreviewScroll(
      node,
      {
        fold(progress, reducedMotion, animate) {
          toggle.current?.setAttribute('aria-expanded', String(progress < 0.5));
          toggle.current?.setAttribute(
            'aria-label',
            t(progress < 0.5 ? '收起预览窗口' : '展开预览窗口'),
          );
          panels.setAttribute('aria-hidden', String(progress === 1));
          panels.inert = progress === 1;
          if (reducedMotion) {
            clearPlayers();
            panels.style.visibility = progress === 1 ? 'hidden' : '';
            chevron.style.transform = progress === 1 ? 'rotate(180deg)' : '';
            return;
          }
          panels.style.visibility = '';
          chevron.style.transform = '';
          const snapshot = () => {
            const style = getComputedStyle(panels);
            return {
              panel: { opacity: style.opacity, transform: style.transform },
              arrow: { transform: getComputedStyle(chevron).transform },
            };
          };
          const from = animate ? snapshot() : undefined;
          if (animate || !scrubbing) clearPlayers();
          if (!players.length && progress > 0) {
            const { open, fold, collapseDuration, easing } = interviewPanelAnimation;
            const options = { duration: collapseDuration, easing, fill: 'both' as const };
            players.push(
              panels.animate([open, fold], options),
              chevron.animate(
                [{ transform: 'rotate(0deg)' }, { transform: 'rotate(180deg)' }],
                options,
              ),
            );
            for (const player of players) player.pause();
            scrubbing = true;
          }
          for (const player of players)
            player.currentTime = progress * interviewPanelAnimation.collapseDuration;
          if (progress === 0) clearPlayers();
          if (from) {
            // Resolve even a partial scroll fold from the shared keyframes, then
            // animate there from the current frame so rapid clicks stay continuous.
            const to = snapshot();
            clearPlayers();
            const { collapseDuration, expandDuration, easing } = interviewPanelAnimation;
            const options = {
              duration:
                Number(to.panel.opacity) < Number(from.panel.opacity)
                  ? collapseDuration
                  : expandDuration,
              easing,
              fill: 'both' as const,
            };
            players.push(
              panels.animate([from.panel, to.panel], options),
              chevron.animate([from.arrow, to.arrow], options),
            );
          }
        },
        reveal() {
          photo.hidden = false;
        },
        reset() {
          clearPlayers();
          panels.style.visibility = '';
          panels.removeAttribute('aria-hidden');
          panels.inert = false;
          chevron.style.transform = '';
          photo.hidden = true;
          node.scrollTop = 0;
        },
      },
      toggle.current,
      shell,
    );
    return () => {
      disposeTranscript();
      disposeScroll();
    };
  }, [compact]);
  return (
    <div
      className={`interview-preview-scene${interviewAlwaysDark ? ' dark' : ''}${compact ? ' login-interview-preview' : ''}`}
      role="region"
      aria-label={t(label)}
    >
      {!compact && (
        <div
          ref={background}
          className="interview-preview-background"
          role="region"
          aria-label={t('预览背景，可上下滚动')}
          tabIndex={0}
        >
          <section className="preview-backdrop-photo" aria-label={t('校园初见，全图片背景')}>
            <img
              src={storyMeeting}
              alt={t('两位学生在校园旁的现代奶茶店门口碰面，手里没有饮品')}
              loading="lazy"
              decoding="async"
            />
          </section>
          <section className="preview-backdrop-paper" aria-label={t('约好的地方，全文字背景')}>
            <div className="preview-backdrop-copy">
              <span>{t('01 · 约好的地方')}</span>
              <h4>{t('初次见面')}</h4>
              <p>
                {t(
                  '那家奶茶店，是我们约好见面的地方。那天谁也没有买喝的，碰面以后，就一起出去走了走。 ',
                )}
              </p>
              <p>
                {t(
                  '后来，我们开始一起吃晚饭，下课后等对方，回宿舍时多走一段路。每天都有些小事，想留到见面时再说。 ',
                )}
              </p>
              <p>{t('毕业的时候，我们去了不同的城市。')}</p>
            </div>
          </section>
          <section
            className="preview-backdrop-night preview-story"
            aria-label={t('异地视频通话，深色背景')}
          >
            <div className="preview-story-art">
              <img
                src={storyDistance}
                alt={t('两个人在不同城市的房间里用笔记本电脑视频通话')}
                loading="lazy"
                decoding="async"
              />
            </div>
            <div className="preview-backdrop-copy">
              <span>{t('02 · 电话那头')}</span>
              <h4>{t('每天见一面')}</h4>
              <p>
                {t(
                  '我们一起去旅行，去看喜欢的歌手开演唱会。出发前会安排很久，见面后却总觉得，刚到就又要走了。 ',
                )}
              </p>
              <p>
                {t('返程的车上，翻着这几天拍的照片。到家以后，再开视频，把路上没说完的话接着说。')}
              </p>
              <p>
                {t('有时聊工作，有时只是各自做着手里的事。视频一直开着，偶尔叫一声，对方就会应。')}
              </p>
              <p>{t('后来，我们开始认真找同一座城市的工作。')}</p>
            </div>
          </section>
          <section
            className="preview-backdrop-color preview-story"
            aria-label={t('共同生活，彩色背景')}
          >
            <div className="preview-backdrop-copy">
              <span>{t('03 · 下一次见面')}</span>
              <h4>{t('这次，留下来')}</h4>
              <p>
                {t(
                  '视频里多了些新的内容：最近投了哪些岗位，面试约在什么时候，还有那段练了几遍的自我介绍。 ',
                )}
              </p>
              <p>
                {t(
                  '我们开始用 VoxCue 准备面试。放进简历和岗位要求，梳理做过的项目，提前准备可能被问到的问题。 ',
                )}
              </p>
              <p>
                {t(
                  '电话那头，我们轮流听对方讲，把含糊的地方重新理顺。面试结束，再翻翻记录，看看下次还能改好哪里。 ',
                )}
              </p>
              <p>{t('有些机会没有等到结果，我们就继续准备。几个月后，终于搬进了同一间屋子。')}</p>
              <p>
                {t('纸箱还没拆完，两张工作桌先摆好了。晚上各忙各的，想说什么，抬头就能看见对方。')}
              </p>
              <p>
                <strong>{t('VoxCue，把经历讲清楚，把下一步准备好。')}</strong>
              </p>
            </div>
            <div className="preview-story-art">
              <img
                src={storyHome}
                alt={t('两个人在新家各自的工作桌前相视而笑，地上还有搬家纸箱')}
                loading="lazy"
                decoding="async"
              />
            </div>
          </section>
          <section className="preview-backdrop-easter-egg" aria-label={t('隐藏的风景')} hidden>
            <img
              src={easterEgg}
              alt={t('两只小动物坐在开着花的绿色草地上')}
              loading="eager"
              decoding="async"
            />
          </section>
        </div>
      )}
      {/* Use the real surface classes, so chrome, panels and bubbles retain
            their distinct opacity and accessibility contrast rules. */}
      <div className="interview-preview-shell">
        <div className="floating-toolbar">
          {compact ? (
            <span className="floating-brand" data-interview-preview-button>
              <ChevronUp size={16} />
              <AppLogo size={17} />
              <strong>VoxCue</strong>
            </span>
          ) : (
            <button
              ref={toggle}
              type="button"
              className="floating-brand"
              aria-label={t('收起预览窗口')}
              aria-expanded="true"
              data-interview-preview-button
            >
              <ChevronUp size={16} />
              <AppLogo size={17} />
              <strong>VoxCue</strong>
            </button>
          )}
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
          <section className="floating-panel floating-transcript">
            <header>
              <h2>
                <Volume2 size={16} />
                {t('转写')}
              </h2>
            </header>
            <div className="floating-scroll">
              <article className="transcript-item interviewer">
                <div className="transcript-meta">
                  <strong>{t('面试官')}</strong>
                  <time>14:18</time>
                </div>
                <p className="interview-font-sample">{t('请介绍一个你负责过的项目。')}</p>
              </article>
              <article className="transcript-item interviewee">
                <div className="transcript-meta">
                  <strong>{t('面试者')}</strong>
                  <time>14:19</time>
                </div>
                <p className="interview-font-sample">{t('我负责了项目的设计与交付。')}</p>
              </article>
            </div>
          </section>
          <section className="floating-panel floating-answer">
            {!compact && <InterviewChromeBase />}
            <header>
              <h2>
                <MessageSquare size={17} />
                {t('回答')}
              </h2>
              <TranscriptControl
                className="floating-toggle ui-button interview-preview-tools interview-preview-capsule"
                type={compact ? undefined : 'button'}
                role={compact ? 'button' : undefined}
                aria-label={t('转写面板')}
                aria-pressed="true"
                aria-disabled={compact}
                data-interview-preview-button
              >
                <span className="toggle-dot" />
                <AudioLines size={14} />
                {t('转写')}
              </TranscriptControl>
            </header>
            <div className="floating-scroll">
              <div className="floating-question interview-font-sample">
                {t('请介绍一个你负责过的项目。')}
              </div>
              <div className="floating-answer-meta">
                <span className="provider-identity">
                  <ProviderIdentity provider="chatgpt" />
                </span>
                <Copy size={14} />
              </div>
              <div className="answer-text answer-bubble interview-font-sample">
                <MarkdownContent content={t('先说明**项目目标**，再介绍你的工作和结果。')} />
              </div>
            </div>
            <div className="floating-composer">
              <textarea
                aria-label={t('预览输入框')}
                tabIndex={-1}
                readOnly
                rows={2}
                placeholder={t('输入问题…')}
              />
              <div className="floating-composer-toolbar">
                <span
                  className="floating-toggle interview-preview-tools interview-preview-capsule"
                  data-interview-preview-button
                >
                  <span className="toggle-dot" />
                  <Sparkles size={14} />
                  {t('自动回答：开')}
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
