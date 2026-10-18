import { Button } from './ui/button';
import type { ChatMessage } from '../services/preparation';
import { usePreparation } from '../stores/preparation';
import {
  profileFields,
  profileLabels,
  profileProposalStale,
  type ProfileEntry,
  type InterviewSkill,
} from '../../electron/contracts/profile';
import { MarkdownContent } from './MarkdownContent';
import { PlainTextContent } from './PlainTextContent';
import { X, Edit, Globe, Check, History } from './icons';
export function ProfileValue({
  value,
  hideTitle = false,
}: {
  value: string | ProfileEntry[] | InterviewSkill[] | undefined;
  hideTitle?: boolean;
}) {
  if (!value || (Array.isArray(value) && !value.length))
    return <p className="empty-inline">未填写 / 清空</p>;
  if (typeof value === 'string') return <MarkdownContent content={value} />;
  return (
    <div className="profile-value-list">
      {value.map((item) => (
        <article key={item.id}>
          {!hideTitle && (
            <strong>
              <PlainTextContent content={item.title} inline />
            </strong>
          )}
          <PlainTextContent content={item.content} />
        </article>
      ))}
    </div>
  );
}
export function SkillUpdatePrompt() {
  const state = usePreparation();
  if (!state.skillsNeedUpdate) return null;
  const missing = [
    !state.info.background.trim() && '简历',
    !state.info.jobDescription.trim() && '职位描述',
  ]
    .filter(Boolean)
    .join('和');
  return (
    <div className="skill-update-prompt" role="status">
      <p>
        {missing
          ? '资料已保存，补齐摘要后可联网更新面试技能。'
          : '简历或职位描述已更新，是否联网更新面试技能？'}
      </p>
      {(missing || state.streaming) && (
        <p className="profile-consent-note">
          {state.streaming
            ? '正在完成当前回复，完成后即可继续。'
            : `还缺少${missing}摘要，请先提供并确认后再生成技能。`}
        </p>
      )}
      <div>
        <Button variant="ghost" onClick={state.dismissSkillUpdate}>
          <X size={16} />
          暂不更新
        </Button>
        <Button
          variant="outline"
          disabled={state.streaming}
          onClick={() => {
            if (!missing) {
              void state.generateSkills();
              return;
            }
            state.setDraft(
              [
                state.draft,
                `请根据以下内容整理${missing}摘要。简历保留个人经历、职责、项目、技术和成果；职位描述保留岗位定位、职责、任职要求及明确的优先条件。合并重复表述，保留事实和条件边界，不把岗位要求写成个人经历。仅补充缺少的摘要并展示待确认提案，不修改其他资料，也不生成技能。\n\n以下是${missing}内容：\n`,
              ]
                .filter(Boolean)
                .join('\n\n'),
            );
            requestAnimationFrame(() =>
              document.querySelector<HTMLTextAreaElement>('[aria-label="聊天消息"]')?.focus(),
            );
          }}
        >
          {missing ? <Edit size={16} /> : <Globe size={16} />}
          {missing ? `补充${missing}` : '联网更新技能'}
        </Button>
      </div>
    </div>
  );
}
export function ProfileProposal({ message }: { message: ChatMessage }) {
  const state = usePreparation();
  if (message.status !== 'completed' && message.profilePreview)
    return (
      <section
        className="profile-proposal"
        aria-label="正在生成的资料提案"
        aria-busy={message.status === 'streaming'}
      >
        <strong>
          {message.status === 'streaming'
            ? '正在生成资料提案…'
            : message.errorCode?.startsWith('skill_')
              ? '资料提案未通过来源校验'
              : '资料提案未完成'}
        </strong>
        {profileFields
          .filter((key) => message.profilePreview?.[key] !== undefined)
          .map((key) => (
            <div className="profile-change" key={key}>
              <h4>{profileLabels[key]}</h4>
              <div className="profile-preview">
                <div>
                  {key === 'skills' ? (
                    <div className="profile-value-list">
                      {message.profilePreview!.skills!.map((skill, index) => (
                        <article key={index}>
                          <h4>
                            <PlainTextContent content={skill.title || `技能 ${index + 1}`} inline />
                          </h4>
                          <PlainTextContent content={skill.content} />
                        </article>
                      ))}
                    </div>
                  ) : (
                    <ProfileValue value={message.profilePreview![key]} />
                  )}
                </div>
              </div>
            </div>
          ))}
        <p className="profile-consent-note">
          {message.status === 'streaming'
            ? '内容实时更新，完整生成并校验后才可确认保存。'
            : message.errorCode?.startsWith('skill_')
              ? '内容已收到，但来源未通过校验，以上仅供查看，尚未保存。请重试。'
              : '生成已中断，以上内容仅供查看，尚未保存。请重试生成完整提案。'}
        </p>
        <div className="profile-proposal-actions">
          <Button variant="outline" disabled>
            <Check size={16} />
            确认更新
          </Button>
        </div>
      </section>
    );
  if (message.status !== 'completed' || !message.changes || !Object.keys(message.changes).length)
    return null;
  const fields = profileFields.filter((key) => message.changes?.[key] !== undefined);
  const stale =
    !message.profileBase || profileProposalStale(state.info, message.profileBase, message.changes);
  const deleting = fields.some(
    (key) =>
      message.changes![key] === '' ||
      (Array.isArray(message.changes![key]) && !(message.changes![key] as unknown[]).length),
  );
  const latestSummary = [...state.messages]
    .reverse()
    .find(
      (item) =>
        item.applied &&
        (item.changes?.background !== undefined || item.changes?.jobDescription !== undefined),
    );
  return (
    <section className="profile-proposal" aria-label="待确认的资料更新">
      <strong>
        {message.applied ? '个人信息已更新' : message.dismissed ? '已保留旧版' : '待确认的资料更新'}
      </strong>
      {fields.map((key) => (
        <div className="profile-change" key={key}>
          <h4>{profileLabels[key]}</h4>
          <div className="profile-preview">
            <div>
              <span>待保存内容</span>
              <ProfileValue value={message.changes![key]} />
            </div>
          </div>
        </div>
      ))}
      {!message.applied && !message.dismissed && (
        <>
          <p className="profile-consent-note">
            {stale
              ? '个人信息已变化，请重新生成提案，避免覆盖较新的修改。'
              : '点击“确认更新”或在聊天中发送“确认更新”，即可保存以上字段到个人信息。'}
          </p>
          <div className="profile-proposal-actions">
            <Button variant="ghost" onClick={() => state.dismissProfile(message.id)}>
              <History size={16} />
              保留旧版
            </Button>
            <Button
              variant={deleting ? 'destructive' : 'outline'}
              disabled={stale}
              onClick={() => state.updateInfo(message.changes!, message.id)}
            >
              <Check size={16} />
              确认更新
            </Button>
          </div>
          {message.error && (
            <p className="danger-text" role="alert">
              {message.error}
            </p>
          )}
        </>
      )}
      {message.applied &&
        latestSummary?.id === message.id &&
        (message.changes.background !== undefined ||
          message.changes.jobDescription !== undefined) && <SkillUpdatePrompt />}
    </section>
  );
}
