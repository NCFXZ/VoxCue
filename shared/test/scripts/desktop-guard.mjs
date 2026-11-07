// Callers supply their platform's fail-closed desktop check and an owned child.
export function watchTestDesktop(child, requireDesktop) {
  let failure;
  function release() {
    clearInterval(timer);
    child.off('exit', release);
    child.off('error', release);
  }
  const timer = setInterval(() => {
    try {
      requireDesktop();
    } catch (error) {
      failure = error instanceof Error ? error : new Error(String(error));
      release();
      try {
        child.kill('SIGTERM');
      } catch (error) {
        failure = new AggregateError(
          [failure, error],
          'Desktop verification failed and its owned test child could not be stopped',
        );
      }
    }
  }, 2000);
  timer.unref();
  child.once('exit', release);
  child.once('error', release);
  return {
    release,
    get failure() {
      return failure;
    },
  };
}
