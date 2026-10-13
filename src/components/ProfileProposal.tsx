import { Button } from './ui/button';
import type { ChatMessage } from '../services/preparation';
import { usePreparation } from '../stores/preparation';
import { profileFields, type ProfileField } from '../../electron/contracts/profile';
const labels: Record<ProfileField, string> = {
  name: '姓名',
  role: '目标岗位',
  jobDescription: '岗位描述',
  background: '个人背景',
};
export function ProfileProposal({ message }: { message: ChatMessage }) {
  const state = usePreparation();
  if (message.status !== 'completed' || !message.changes || !Object.keys(message.changes).length)
    return null;
  const fields = profileFields.filter((key) => message.changes?.[key] !== undefined);
  const stale = fields.some((key) => state.info[key] !== message.profileBase?.[key]);
  return (
    <section className="profile-proposal" aria-label="待确认的资料更新">
      <strong>
        {message.applied ? '个人信息已更新' : message.dismissed ? '已保留旧版' : '待确认的资料更新'}
      </strong>
      {fields.map((key) => (
        <div className="profile-change" key={key}>
          <h4>{labels[key]}</h4>
          <div className="profile-diff">
            <div>
              <span>修改前</span>
              <p>{message.profileBase?.[key] || '未填写'}</p>
            </div>
            <div>
              <span>建议修改为</span>
              <p>{message.changes![key]}</p>
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
              保留旧版
            </Button>
            <Button
              variant="outline"
              disabled={stale}
              onClick={() => state.updateInfo(message.changes!, message.id)}
            >
              确认更新
            </Button>
          </div>
        </>
      )}
    </section>
  );
}
