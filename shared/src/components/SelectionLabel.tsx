export function SelectionLabel({ children }: { children: string }) {
  return (
    <span className="selection-label">
      <span className="selection-label-normal">{children}</span>
      <span className="selection-label-bold" aria-hidden="true" data-label={children} />
    </span>
  );
}
