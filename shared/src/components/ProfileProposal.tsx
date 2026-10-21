import { useState } from 'react';
import { Button } from './ui/button';
import { Modal } from './ui/modal';
import type { ChatMessage } from '../services/preparation';
import { usePreparation } from '../stores/preparation';
import {
  profileFields,
  profileLabels,
  profileProposalStale,
  profileValue,
  type ProfileEntry,
  type InterviewSkill,
  type ProfileField,
  skillProposalEntries,
} from '../../electron/contracts/profile';
import { MarkdownContent } from './MarkdownContent';
import { PlainTextContent } from './PlainTextContent';
import { X, Edit, Globe, Check, History, ChevronDown, Loader } from './icons';
function ProposalLoading({ active, label }: { active: boolean; label: string }) {
  if (!active) return null;
  return (
    <span className="proposal-field-loading" role="status" aria-label={`${label}正在生成`}>
      <Loader size={14} />
    </span>
  );
}
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
            state.dismissSkillUpdate();
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
  const [reading, setReading] = useState<{ field: ProfileField; skillId?: string } | null>(null);
  const [skillsExpanded, setSkillsExpanded] = useState<boolean>();
  const generating = message.status === 'streaming';
  const complete = message.status === 'completed' && !!message.changes;
  const values = complete ? message.changes : message.profilePreview;
  if (!values || !Object.keys(values).length) return null;
  const fields = profileFields.filter((key) => values[key] !== undefined);
  const resolved = !!message.applied || !!message.dismissed;
  const pending = complete && !resolved;
  const skillEntries =
    complete && message.changes?.skills
      ? skillProposalEntries(message.profileBase?.skills ?? [], message.changes.skills)
      : (message.profilePreview?.skills ?? []).map((skill, index) => ({
          skill: { ...skill, id: skill.id ?? 'preview-' + index, sources: [] },
          kind: message.profileBase?.skills?.some((entry) => entry.id === skill.id)
            ? ('update' as const)
            : ('add' as const),
        }));
  let selected = message.selectedProfileFields ?? fields;
  const skillIds = selected.includes('skills')
    ? (message.selectedSkillIds ?? skillEntries.map((entry) => entry.skill.id))
    : [];
  if (skillEntries.length && !skillIds.length)
    selected = selected.filter((field) => field !== 'skills');
  const selectedChanges = Object.fromEntries(selected.map((field) => [field, values[field]]));
  const stale =
    pending &&
    (!message.profileBase ||
      profileProposalStale(state.info, message.profileBase, selectedChanges, skillIds));
  const units = fields.filter((field) => field !== 'skills').length + skillEntries.length;
  const chosen = selected.filter((field) => field !== 'skills').length + skillIds.length;
  const savedFields = message.appliedProfileFields ?? fields;
  const savedSkillIds = message.appliedSkillIds ?? skillEntries.map((entry) => entry.skill.id);
  const savedCount =
    savedFields.filter((field) => field !== 'skills').length +
    (savedFields.includes('skills') ? savedSkillIds.length : 0);
  const expanded = skillsExpanded ?? fields.length === 1;
  const operation = (kind: 'add' | 'update' | 'remove' | 'keep') =>
    !resolved && (
      <span className={`proposal-operation ${kind === 'remove' ? 'is-removal' : ''}`}>
        {{ add: '待新增', update: '待修改', remove: '待删除', keep: '保持原内容' }[kind]}
      </span>
    );
  const fieldOperation = (field: ProfileField): 'add' | 'update' | 'remove' | 'keep' => {
    const next = values[field];
    const previous = message.profileBase ? profileValue(message.profileBase, field) : undefined;
    const empty = (value: unknown) =>
      typeof value === 'string' ? !value.trim() : !Array.isArray(value) || !value.length;
    const inProgress = generating && !!message.profileGeneration?.fields.includes(field);
    // An empty streaming prefix does not yet mean the user is proposing a deletion.
    if (!inProgress && empty(next)) return empty(previous) ? 'keep' : 'remove';
    if (!message.profileBase) return 'update';
    if (empty(previous)) return 'add';
    return !inProgress && JSON.stringify(previous) === JSON.stringify(next) ? 'keep' : 'update';
  };
  const toggleField = (field: ProfileField, checked: boolean) =>
    field === 'skills'
      ? state.selectSkillIds(message.id, checked ? skillEntries.map((entry) => entry.skill.id) : [])
      : state.selectProfileFields(
          message.id,
          fields.filter((key) => (key === field ? checked : selected.includes(key))),
        );
  const toggleSkill = (id: string, checked: boolean) =>
    state.selectSkillIds(
      message.id,
      skillEntries
        .filter((entry) => (entry.skill.id === id ? checked : skillIds.includes(entry.skill.id)))
        .map((entry) => entry.skill.id),
    );
  const choice = (field: ProfileField, title: string, id?: string, compact = false) => (
    <label className="profile-field-choice">
      <input
        type="checkbox"
        aria-label={
          id
            ? `${skillEntries.find((entry) => entry.skill.id === id)?.kind === 'remove' ? '删除' : '保存'}技能：${title}`
            : `保存${profileLabels[field]}`
        }
        checked={
          id
            ? skillIds.includes(id)
            : selected.includes(field) &&
              (field !== 'skills' || skillIds.length === skillEntries.length)
        }
        ref={(input) => {
          if (input && field === 'skills' && !id)
            input.indeterminate = skillIds.length > 0 && skillIds.length < skillEntries.length;
        }}
        onChange={(event) =>
          id ? toggleSkill(id, event.target.checked) : toggleField(field, event.target.checked)
        }
      />
      <PlainTextContent content={compact ? '保存此项' : title} inline />
    </label>
  );
  const status = (field: ProfileField, id?: string) => {
    if (!resolved) return null;
    const saved =
      !!message.applied && savedFields.includes(field) && (!id || savedSkillIds.includes(id));
    const kind = id ? skillEntries.find((entry) => entry.skill.id === id)?.kind : undefined;
    return (
      <span className={`proposal-status ${saved ? 'is-saved' : ''}`}>
        {saved
          ? kind
            ? { add: '已新增', update: '已修改', remove: '已删除', keep: '已保留' }[kind]
            : '已保存'
          : kind === 'add'
            ? '未添加'
            : '未采用'}
      </span>
    );
  };
  const readingSkill = reading?.skillId
    ? skillEntries.find((entry) => entry.skill.id === reading.skillId)
    : undefined;
  const readingTitle = readingSkill?.skill.title ?? (reading ? profileLabels[reading.field] : '');
  const heading = message.applied
    ? '已保存所选资料'
    : message.dismissed
      ? '已保留原资料'
      : complete
        ? '选择要保存的资料'
        : message.status === 'streaming'
          ? '正在生成资料提案…'
          : '资料提案未完成';
  return (
    <section
      className="profile-proposal"
      data-resolved={resolved || undefined}
      aria-label={complete ? '待确认的资料更新' : '正在生成的资料提案'}
      aria-busy={generating}
    >
      <header className="proposal-heading">
        <strong>{heading}</strong>
        <span>
          {message.applied
            ? `已保存 ${savedCount} 项`
            : pending
              ? `已选 ${chosen} / ${units} 项`
              : `共 ${units} 项`}
        </span>
      </header>
      <div className="proposal-rows">
        {fields.map((field) =>
          field === 'skills' ? (
            <div className="proposal-skills" key={field}>
              <div className="proposal-row">
                <div className="proposal-row-main">
                  <div className="proposal-row-title">
                    {pending ? choice(field, '技能') : <strong>技能</strong>}
                    <ProposalLoading
                      active={generating && !!message.profileGeneration?.fields.includes('skills')}
                      label="技能"
                    />
                    {operation(fieldOperation(field))}
                  </div>
                  <span className="proposal-excerpt">
                    {pending
                      ? `已选 ${skillIds.length} / ${skillEntries.length} 条，未选中的已有技能保持不变`
                      : `本次 ${skillEntries.length} 条技能${message.applied ? `，已应用 ${savedFields.includes('skills') ? savedSkillIds.length : 0} 条` : ''}`}
                  </span>
                </div>
                <Button
                  variant="ghost"
                  className="proposal-view"
                  aria-expanded={expanded}
                  aria-label={expanded ? '收起技能清单' : '展开技能清单'}
                  onClick={() => setSkillsExpanded(!expanded)}
                >
                  {expanded ? '收起' : '展开'}
                  <span className={expanded ? 'is-expanded' : ''}>
                    <ChevronDown size={14} />
                  </span>
                </Button>
              </div>
              {expanded && (
                <div className="proposal-skill-rows">
                  {skillEntries.map(({ skill, kind }, index) => (
                    <div className="proposal-row proposal-skill-row" key={skill.id}>
                      <div className="proposal-row-main">
                        <div className="proposal-row-title">
                          {pending ? (
                            choice('skills', skill.title, skill.id)
                          ) : (
                            <strong>
                              <PlainTextContent content={skill.title} inline />
                            </strong>
                          )}
                          <ProposalLoading
                            active={
                              generating &&
                              !!message.profileGeneration?.skillIndexes.includes(index)
                            }
                            label={skill.title || '技能'}
                          />
                          {(complete || message.profilePreview?.skills?.[index]?.id) &&
                            operation(kind)}
                          {status('skills', skill.id)}
                        </div>
                        {!resolved && (
                          <div className="proposal-excerpt">
                            <PlainTextContent content={skill.content || '清空内容'} inline />
                          </div>
                        )}
                      </div>
                      <Button
                        variant="ghost"
                        className="proposal-view"
                        aria-label={`查看技能：${skill.title}`}
                        onClick={() => setReading({ field: 'skills', skillId: skill.id })}
                      >
                        查看
                      </Button>
                    </div>
                  ))}
                  {!skillEntries.length && <span className="proposal-excerpt">没有技能条目</span>}
                </div>
              )}
            </div>
          ) : (
            <div className="proposal-row" key={field}>
              <div className="proposal-row-main">
                <div className="proposal-row-title">
                  {pending ? (
                    choice(field, profileLabels[field])
                  ) : (
                    <strong>{profileLabels[field]}</strong>
                  )}
                  <ProposalLoading
                    active={generating && !!message.profileGeneration?.fields.includes(field)}
                    label={profileLabels[field]}
                  />
                  {operation(fieldOperation(field))}
                  {status(field)}
                </div>
                {!resolved && (
                  <div
                    className={`proposal-excerpt ${field === 'name' || field === 'language' ? 'is-short' : ''}`}
                  >
                    <PlainTextContent content={values[field] || '清空内容'} inline />
                  </div>
                )}
              </div>
              {(resolved || (field !== 'name' && field !== 'language')) && (
                <Button
                  variant="ghost"
                  className="proposal-view"
                  aria-label={`查看${profileLabels[field]}`}
                  onClick={() => setReading({ field })}
                >
                  {resolved ? '查看提案' : '查看全文'}
                </Button>
              )}
            </div>
          ),
        )}
      </div>
      {pending ? (
        <footer className="proposal-footer">
          <div className="proposal-footer-note">
            <span>
              {stale
                ? '资料已变化，请重新生成提案后保存。'
                : !chosen
                  ? '请选择要保存的内容'
                  : '未选中的内容保持不变'}
            </span>
          </div>
          <div className="profile-proposal-actions">
            <Button variant="ghost" onClick={() => state.dismissProfile(message.id)}>
              <History size={16} />
              保留原资料
            </Button>
            <Button
              variant="outline"
              disabled={!!stale || !chosen}
              onClick={() => state.updateInfo(message.changes!, message.id)}
            >
              <Check size={16} />
              保存所选
            </Button>
          </div>
          {message.error && (
            <div className="danger-text" role="alert">
              {message.error}
            </div>
          )}
        </footer>
      ) : (
        <div className="proposal-footer-note proposal-result">
          {resolved
            ? '未保存的内容保持原值，可随时查看本次提案。'
            : message.status === 'streaming'
              ? '完整生成后即可勾选保存。'
              : '生成已中断，收到的内容保留供查看。请重试生成完整提案。'}
          {!complete && (
            <Button variant="outline" disabled>
              <Check size={16} />
              保存所选
            </Button>
          )}
        </div>
      )}
      {reading && (!reading.skillId || readingSkill) && (
        <Modal
          title={readingTitle}
          wide
          className="proposal-reader"
          subtitle={
            resolved
              ? message.applied &&
                savedFields.includes(reading.field) &&
                (!reading.skillId || savedSkillIds.includes(reading.skillId))
                ? readingSkill?.kind === 'remove'
                  ? '本次已删除的技能'
                  : '本次已保存的提案内容'
                : '未采用的提案内容，原资料保持不变。'
              : readingSkill?.kind === 'remove'
                ? '勾选此项将删除这条已有技能。'
                : '本次提案内容'
          }
          onClose={() => setReading(null)}
          action={
            pending
              ? choice(reading.field, readingTitle, reading.skillId, true)
              : status(reading.field, reading.skillId)
          }
        >
          <div className="proposal-reader-content">
            <ProfileValue
              value={readingSkill ? [readingSkill.skill] : (values[reading.field] as string)}
              hideTitle={!!readingSkill}
            />
          </div>
        </Modal>
      )}
    </section>
  );
}
