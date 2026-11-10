/** Fence main-process preparation before the coordinator acquires an audio operation. */
export class InterviewAudioIntent {
  private revision = 0;
  cancel() {
    ++this.revision;
  }
  begin(ownsWindow: () => boolean) {
    const revision = ++this.revision;
    const current = () => revision === this.revision && ownsWindow();
    const requireCurrent = () => {
      if (!current()) throw Error('语音切换已取消，仍使用原配置。');
    };
    return {
      current,
      async run<T>(prepare: () => Promise<void>, reconnect: () => Promise<T>): Promise<T> {
        try {
          requireCurrent();
          await prepare();
          requireCurrent();
          const status = await reconnect();
          requireCurrent();
          return status;
        } catch (error) {
          requireCurrent();
          throw error;
        }
      },
    };
  }
}
