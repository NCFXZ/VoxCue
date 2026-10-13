// Only public Responses summary_text is accepted. Raw reasoning_text and
// encrypted_content are never forwarded to the renderer.
export class ReasoningSummary {
  private parts = new Map<string, string>();
  get text() {
    return [...this.parts.values()].filter(Boolean).join('\n\n');
  }
  receive(event: any): boolean {
    const before = this.text;
    const put = (key: string, value: unknown, append = false) => {
      if (typeof value !== 'string' || value.length > 100000 || key.length > 250) return;
      if (!this.parts.has(key) && this.parts.size >= 100) return;
      const next = append ? (this.parts.get(key) ?? '') + value : value;
      if (next.length + this.text.length - (this.parts.get(key)?.length ?? 0) <= 100000)
        this.parts.set(key, next);
    };
    if (
      [
        'response.reasoning_summary_text.delta',
        'response.reasoning_summary_text.done',
        'response.reasoning_summary_part.done',
        'response.reasoning_summary_part.added',
      ].includes(event.type)
    ) {
      if (
        typeof event.item_id !== 'string' ||
        !Number.isInteger(event.summary_index) ||
        event.summary_index < 0
      )
        return false;
      const key = `${event.item_id}:${event.summary_index}`;
      if (event.type === 'response.reasoning_summary_text.delta') put(key, event.delta, true);
      else if (event.type === 'response.reasoning_summary_text.done') put(key, event.text);
      else if (
        event.part?.type === 'summary_text' &&
        (event.type.endsWith('.done') || !this.parts.has(key))
      )
        put(key, event.part.text);
    }
    const receiveItem = (item: any) => {
      if (item?.type !== 'reasoning' || typeof item.id !== 'string' || !Array.isArray(item.summary))
        return;
      item.summary.forEach((part: any, index: number) => {
        const key = `${item.id}:${index}`;
        if (
          part?.type === 'summary_text' &&
          (event.type !== 'response.output_item.added' || !this.parts.has(key))
        )
          put(key, part.text);
      });
    };
    if (['response.output_item.added', 'response.output_item.done'].includes(event.type))
      receiveItem(event.item);
    if (['response.completed', 'response.failed', 'response.incomplete'].includes(event.type)) {
      for (const item of event.response?.output ?? []) receiveItem(item);
    }
    return this.text !== before;
  }
}
