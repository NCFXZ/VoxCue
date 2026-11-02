import { t } from '../i18n';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { validImagePreview, type InterviewImage } from '../../electron/contracts/interviewImages';
import { Modal } from './ui/modal';
import { Button } from './ui/button';
import { ChevronLeft, ChevronRight, Download } from './icons';
import { InterviewImageCanvas } from './InterviewImageCanvas';

function Thumbnail({
  image,
  index,
  onOpen,
}: {
  image: InterviewImage;
  index: number;
  onOpen(): void;
}) {
  const [preview, setPreview] = useState(image.preview);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    setPreview(image.preview);
    setFailed(false);
    if (!image.preview)
      void (async () => {
        try {
          const result = await window.desktop?.interviewImage({ op: 'preview', id: image.id });
          if (!result?.ok || !validImagePreview(result.dataUrl)) throw Error('No preview');
          if (active) setPreview(result.dataUrl);
        } catch {
          if (active) setFailed(true);
        }
      })();
    return () => {
      active = false;
    };
  }, [image.id, image.preview]);
  return (
    <button
      type="button"
      className="interview-image-thumbnail"
      aria-label={t(`查看截图 ${index + 1} 原图`)}
      onClick={onOpen}
    >
      {preview && !failed ? (
        <img
          src={preview}
          alt={t(`已发送截图 ${index + 1}`)}
          loading="lazy"
          onError={() => setFailed(true)}
        />
      ) : (
        <span>{failed ? t('缩略图不可用') : t('正在读取…')}</span>
      )}
    </button>
  );
}

export function InterviewImages({
  images,
  inInterview = false,
}: {
  images?: InterviewImage[];
  inInterview?: boolean;
}) {
  const [selected, setSelected] = useState<number | null>(null);
  const [loaded, setLoaded] = useState<{ id: string; dataUrl: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<{ id: string; message: string } | null>(null);
  const image = selected === null ? undefined : images?.[selected];
  const original = loaded?.id === image?.id ? loaded?.dataUrl : undefined;
  useEffect(() => {
    let active = true;
    setLoaded(null);
    setError(null);
    setSaveError(null);
    if (image) {
      void (async () => {
        try {
          const result = await window.desktop?.interviewImage({ op: 'read', id: image.id });
          if (!result?.ok || !result.dataUrl)
            throw Error(result && !result.ok ? result.error.message : '无法读取原图。');
          if (active) setLoaded({ id: image.id, dataUrl: result.dataUrl });
        } catch (error) {
          if (active) setError(error instanceof Error ? error.message : '无法读取原图。');
        }
      })();
    }
    return () => {
      active = false;
    };
  }, [image?.id]);
  async function saveImage() {
    if (!image || savingId || inInterview) return;
    const id = image.id;
    setSavingId(id);
    setSaveError(null);
    try {
      const result = await window.desktop?.interviewImage({ op: 'save', id });
      if (!result?.ok) throw Error(result && !result.ok ? result.error.message : '无法保存图片。');
    } catch (error) {
      const message =
        error instanceof Error && !error.message.includes('Error invoking remote method')
          ? error.message
          : '保存接口尚未就绪，请完全退出并重新打开软件后重试。';
      setSaveError({ id, message });
    } finally {
      setSavingId(null);
    }
  }
  if (!images?.length) return null;
  return (
    <>
      <div className="interview-images" role="group" aria-label={t('已发送截图')}>
        {images.map((image, index) => (
          <Thumbnail key={image.id} image={image} index={index} onOpen={() => setSelected(index)} />
        ))}
      </div>
      {image &&
        createPortal(
          <Modal
            title={t('截图')}
            closeLabel={t('关闭截图')}
            initialFocus="close"
            className="interview-image-viewer"
            backdrop={inInterview ? 'transparent' : 'viewport'}
            action={
              !inInterview && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="interview-image-save"
                  aria-label={savingId ? t('正在保存图片') : t('保存图片')}
                  aria-busy={!!savingId}
                  disabled={!original || !!savingId}
                  onClick={saveImage}
                >
                  <Download size={17} />
                </Button>
              )
            }
            onKeyDown={(event) => {
              if (
                event.defaultPrevented ||
                event.altKey ||
                event.ctrlKey ||
                event.metaKey ||
                (event.target as HTMLElement).closest('input,textarea,[contenteditable="true"]')
              )
                return;
              const direction = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0;
              if (!direction) return;
              event.preventDefault();
              event.stopPropagation();
              setSelected((index) =>
                Math.min(images.length - 1, Math.max(0, (index ?? 0) + direction)),
              );
            }}
            onClose={() => setSelected(null)}
          >
            <div className="interview-image-stage">
              {images.length > 1 && (
                <Button
                  variant="outline"
                  size="icon"
                  className="interview-image-navigation is-previous"
                  aria-label={t('上一张截图')}
                  disabled={selected === 0}
                  onClick={() => setSelected((index) => index! - 1)}
                >
                  <ChevronLeft size={16} />
                </Button>
              )}
              {original ? (
                <InterviewImageCanvas
                  key={image.id}
                  src={original}
                  alt={t(`截图 ${selected! + 1} 原图`)}
                  onError={() => {
                    setLoaded(null);
                    setError('原图无法显示，文件可能已损坏。');
                  }}
                />
              ) : (
                <div className="interview-image-canvas" aria-busy={!error}>
                  {error ? (
                    <p role="alert">{t(error)}</p>
                  ) : (
                    <p role="status">{t('正在读取原图…')}</p>
                  )}
                </div>
              )}
              {images.length > 1 && (
                <Button
                  variant="outline"
                  size="icon"
                  className="interview-image-navigation is-next"
                  aria-label={t('下一张截图')}
                  disabled={selected === images.length - 1}
                  onClick={() => setSelected((index) => index! + 1)}
                >
                  <ChevronRight size={16} />
                </Button>
              )}
              {images.length > 1 && (
                <p className="interview-image-position" aria-live="polite">
                  {selected! + 1} / {images.length}
                </p>
              )}
            </div>
            {saveError?.id === image.id && (
              <p role="alert" className="danger-text">
                {t(saveError.message)}
              </p>
            )}
          </Modal>,
          document.body,
        )}
    </>
  );
}
