type TextPart = {
  output?: number;
  content?: number;
  refusal: boolean;
  text: string;
};

// Deltas may omit indices on compatible transports. Adjacent deltas from the
// same part stay in one run and may span several unindexed terminal parts.
export class ResponseText {
  private runs: TextPart[] = [];

  append(output: number | undefined, content: number | undefined, refusal: boolean, text: string) {
    if (!text) return;
    const last = this.runs.at(-1);
    if (last && last.output === output && last.content === content && last.refusal === refusal)
      last.text += text;
    else this.runs.push({ output, content, refusal, text });
  }

  reconcile(items: any[], streamedItems: Map<number, Record<string, any>>) {
    const outputItems = items.slice();
    const aliases = new Map<number, number>();
    const ids = new Map<string, number>();
    for (const [index, item] of items.entries())
      if (typeof item?.id === 'string') ids.set(item.id, ids.has(item.id) ? -1 : index);
    for (const [index, prior] of streamedItems) {
      const terminal = ids.get(prior.id);
      if (terminal !== undefined && terminal >= 0) aliases.set(index, terminal);
    }
    // Some gateways omit all leading tool calls from a one-message snapshot.
    // A missing or unknown slot cannot establish which message a delta belongs to.
    if (items.length === 1 && items[0]?.type === 'message') {
      let index = 0;
      while (streamedItems.get(index)?.type === 'web_search_call') index++;
      const prior = streamedItems.get(index);
      if (index > 0 && !aliases.has(index) && (!prior?.id || prior.id === items[0].id))
        aliases.set(index, 0);
    }
    for (const [original, prior] of streamedItems) {
      if (!prior.done || prior.type !== 'message' || prior.phase === 'commentary') continue;
      const index = aliases.get(original) ?? original;
      const terminal = outputItems[index];
      if (terminal && ((terminal.id && prior.id && terminal.id !== prior.id) ||
          terminal.phase === 'commentary' || (terminal.type && terminal.type !== 'message'))) continue;
      if (!terminal?.content?.some((part: any) => part?.type === 'output_text' || part?.type === 'refusal'))
        outputItems[index] = prior;
    }
    const parts: TextPart[] = [];
    const positions = new Map<string, number>();
    let size = 0;
    for (const [output, item] of outputItems.entries()) {
      if (item?.phase === 'commentary' || (item?.type && item.type !== 'message')) continue;
      for (const [content, part] of (item?.content ?? []).entries()) {
        const refusal = part?.type === 'refusal';
        const text = refusal ? part.refusal : part?.type === 'output_text' ? part.text : undefined;
        if (typeof text !== 'string') continue;
        size += text.length;
        if (size > 1000000) throw Error('回答过长，已停止接收。');
        if (!positions.has(String(output))) positions.set(String(output), parts.length);
        positions.set(output + ':' + content, parts.length);
        parts.push({ output, content, refusal, text });
      }
    }
    // A delayed item snapshot may identify an earlier delta as commentary.
    const runs = aliases.size ? this.runs.map(run => {
      const output = run.output === undefined ? undefined : aliases.get(run.output);
      return output === undefined || output === run.output ? run : { ...run, output };
    }) : this.runs;
    const visible = runs.filter((run, position) => {
      if (run.output === undefined) return true;
      const known = streamedItems.get(this.runs[position].output!);
      const item = outputItems[run.output] ?? known;
      if (known?.type === 'message' && known.id && item?.type === 'message' && item.id && known.id !== item.id)
        throw Error('回答未完整返回，已保留收到的内容，请重试。');
      return item?.phase !== 'commentary' && (!item?.type || item.type === 'message');
    });
    let replace = visible.length !== this.runs.length;
    // Some services send only usage, annotations or an empty output array at completion.
    if (!parts.length) return { replace, parts: replace ? visible : parts };
    const offsets = parts.map(() => 0);
    const advance = (index: number) => {
      while (index < parts.length && offsets[index] === parts[index].text.length) index++;
      return index;
    };
    let ordered = advance(0);
    const inconsistent = () => Error('回答未完整返回，已保留收到的内容，请重试。');
    for (const run of visible) {
      const key = run.content === undefined ? String(run.output) : run.output + ':' + run.content;
      let index = run.output === undefined ? ordered : positions.get(key);
      if (index === undefined) throw inconsistent();
      let matched = 0;
      while (matched < run.text.length) {
        index = advance(index);
        const part = parts[index];
        if (!part || (run.output !== undefined && run.output !== part.output) ||
            (run.content !== undefined && run.content !== part.content) ||
            run.refusal !== part.refusal) throw inconsistent();
        const count = Math.min(run.text.length - matched, part.text.length - offsets[index]);
        if (!part.text.startsWith(run.text.slice(matched, matched + count), offsets[index])) throw inconsistent();
        if (index !== ordered) replace = true;
        matched += count;
        offsets[index] += count;
        ordered = advance(ordered);
      }
      if (run.output !== undefined && run.content === undefined) positions.set(key, index);
    }
    if (replace) return { replace, parts };
    const tail = parts.slice(ordered);
    if (offsets[ordered]) tail[0] = { ...tail[0], text: tail[0].text.slice(offsets[ordered]) };
    return { replace, parts: tail };
  }
}
