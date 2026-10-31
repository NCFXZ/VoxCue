// Match the opaque page behind chat controls locally, below scrolling content.
export function InterviewChromeBase() {
  return (
    <div className="floating-chrome-base" aria-hidden="true">
      <span className="floating-follow-base" />
    </div>
  );
}
