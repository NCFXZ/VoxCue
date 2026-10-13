import { useState } from 'react';
import { answerStyles } from '../services/answerStyle';
import { usePreparation } from '../stores/preparation';
import { Button } from './ui/button';
import { Check } from './icons';
export function AnswerStylePanel() {
  const { answerStyle, updateAnswerStyle } = usePreparation();
  const [draft, setDraft] = useState({ ...answerStyle });
  const [saved, setSaved] = useState(false);
  return (
    <section className="answer-style-section" aria-labelledby="answer-style-title">
      <h3 id="answer-style-title">回答风格</h3>
      <p>用于后续准备聊天，不改变模型或思考强度。</p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          setSaved(updateAnswerStyle(draft));
        }}
      >
        <div className="answer-style-options" role="group" aria-label="回答风格">
          {answerStyles.map((style) => (
            <button
              key={style.id}
              type="button"
              aria-pressed={draft.preset === style.id}
              onClick={() => {
                setDraft({ ...draft, preset: style.id });
                setSaved(false);
              }}
            >
              <span>
                <strong>{style.label}</strong>
              </span>
              <small>{style.description}</small>
              {draft.preset === style.id && <Check size={14} />}
            </button>
          ))}
        </div>
        <label className="field-label">
          补充要求（可选）
          <textarea
            aria-label="补充要求（可选）"
            rows={3}
            maxLength={1200}
            value={draft.custom}
            placeholder="例如：用自然口语，以第一人称回答，少用专业术语。"
            onChange={(event) => {
              setDraft({ ...draft, custom: event.target.value });
              setSaved(false);
            }}
          />
        </label>
        <Button type="submit" variant="outline">
          {saved ? (
            <>
              <Check size={14} />
              风格已保存
            </>
          ) : (
            '保存风格'
          )}
        </Button>
      </form>
    </section>
  );
}
