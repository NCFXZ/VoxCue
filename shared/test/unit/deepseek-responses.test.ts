import { describe, expect, it, vi } from 'vitest';
import {
  deepSeekProSearchModel,
  deepSeekResponsesEvents,
  prepareDeepSeekResponsesRequest,
} from '../../electron/backend/api/deepseekResponses';
import { DeepSeekWebResults } from '../../electron/backend/api/deepseekWeb';
import { DeepSeekProfileStream } from '../../electron/backend/api/deepseekProfile';

const messages = [
  { role: 'system', content: 'Answer in Markdown. Keep the profile proposal protocol.' },
  { role: 'user', content: 'Previous prompt' },
  { role: 'assistant', content: 'Previous visible answer' },
  { role: 'user', content: 'Find current public information' },
];
const compatibleBody = (fields: Record<string, unknown> = {}) => JSON.stringify({
  model: deepSeekProSearchModel,
  stream: true,
  stream_options: { include_usage: true },
  messages,
  ...fields,
});
const sse = (events: object[]) => new Response(
  events.map(event => 'data: ' + JSON.stringify(event) + '\n\n').join(''),
  { headers: { 'content-type': 'text/event-stream' } },
);
const collect = (events: object[]) =>
  Array.fromAsync(deepSeekResponsesEvents(sse(events), new AbortController().signal));

function answerDeltas(events: Awaited<ReturnType<typeof collect>>) {
  return events.flatMap(event => {
    const choice = 'choices' in event ? event.choices?.[0] : undefined;
    const delta = choice && 'delta' in choice ? choice.delta : undefined;
    return delta && 'content' in delta ? [delta.content] : [];
  });
}

describe('DeepSeek V4 Pro Responses web search', () => {
  it('keeps the selected model, effort and public text instructions/history', () => {
    const request = prepareDeepSeekResponsesRequest(compatibleBody({
      thinking: { type: 'enabled' }, reasoning_effort: 'low', response_format: { type: 'json_object' },
    }));
    expect(request?.url).toBe('https://api.deepseek.com/responses');
    expect(JSON.parse(request!.body)).toEqual({
      model: 'deepseek-v4-pro',
      instructions: messages[0].content,
      input: messages.slice(1).map(message => ({ type: 'message', ...message })),
      reasoning: { effort: 'low' },
      text: { format: { type: 'json_object' } },
      tools: [{ type: 'web_search' }],
      stream: true,
    });
    for (const effort of ['high', 'max']) {
      const request = prepareDeepSeekResponsesRequest(compatibleBody({
        thinking: { type: 'enabled' }, reasoning_effort: effort,
      }));
      expect(JSON.parse(request!.body)).toHaveProperty('reasoning.effort', effort);
    }
    const disabled = prepareDeepSeekResponsesRequest(compatibleBody({ thinking: { type: 'disabled' } }));
    expect(JSON.parse(disabled!.body)).toHaveProperty('reasoning.effort', 'none');
    expect(JSON.parse(prepareDeepSeekResponsesRequest(compatibleBody())!.body)).not.toHaveProperty('reasoning');
  });

  it('leaves Flash, unknown settings and attachment bodies outside this route', () => {
    expect(prepareDeepSeekResponsesRequest(compatibleBody({ model: 'deepseek-flash' }))).toBeUndefined();
    expect(prepareDeepSeekResponsesRequest(compatibleBody({
      thinking: { type: 'enabled' }, reasoning_effort: 'medium',
    }))).toBeUndefined();
    expect(prepareDeepSeekResponsesRequest(compatibleBody({ tools: [{ type: 'deepseek_web_search' }] })))
      .toBeUndefined();
    expect(prepareDeepSeekResponsesRequest(compatibleBody({ response_format: { type: 'json_schema' } })))
      .toBeUndefined();
    expect(prepareDeepSeekResponsesRequest(compatibleBody({
      messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url: 'data:image/png;base64,AA==' } }] }],
    }))).toBeUndefined();
    expect(prepareDeepSeekResponsesRequest(new Blob([compatibleBody()]))).toBeUndefined();
  });

  it('preserves streamed answer deltas, relevant source metadata and final usage', async () => {
    const call = {
      type: 'web_search_call', id: 'call-1', status: 'completed',
      action: { type: 'search', queries: ['DeepSeek API public documentation'], sources: [
        { type: 'url', url: 'https://example.com/correct', title: 'Result', snippet: 'synthetic private snippet' },
        { type: 'url', url: 'https://private:credential@example.com/path', title: 'Invalid link' },
        { type: 'url', url: 'javascript:alert(1)', title: 'Invalid link' },
      ] },
      signature: 'synthetic private signature',
    };
    const citation = { type: 'url_citation', url: 'https://example.com/cited', title: 'Citation' };
    const events = await collect([
      { type: 'response.output_item.added', output_index: 0, item: { type: 'message', phase: 'commentary' } },
      { type: 'response.output_text.delta', output_index: 0, delta: 'synthetic private commentary' },
      { type: 'response.reasoning_text.delta', output_index: 1, delta: 'synthetic private thinking' },
      { type: 'response.output_item.added', output_index: 2, item: { ...call, status: 'in_progress' } },
      { type: 'response.web_search_call.completed', output_index: 2, item_id: call.id, sequence_number: 4 },
      { type: 'response.output_item.done', output_index: 2, item: call },
      { type: 'response.output_text.delta', output_index: 3, delta: 'Hello' },
      { type: 'response.output_text.delta', output_index: 3, delta: ' world' },
      { type: 'response.output_text.annotation.added', output_index: 3, annotation: citation },
      {
        type: 'response.completed',
        response: {
          status: 'completed', id: 'native-pro-1',
          usage: { input_tokens: 10, output_tokens: 6, total_tokens: 16 },
          output: [call, { type: 'message', phase: 'final_answer', content: [
            { type: 'output_text', text: 'Hello world', annotations: [citation] },
          ] }],
        },
      },
    ]);
    const tracker = new DeepSeekWebResults();
    const publish = vi.fn();
    for (const event of events) {
      const choice = 'choices' in event ? event.choices?.[0] : undefined;
      tracker.ingest(choice, publish);
    }
    expect(answerDeltas(events)).toEqual(['Hello', ' world']);
    expect([...tracker.sources.values()]).toEqual([
      { url: 'https://example.com/correct', title: 'Result' },
      { url: 'https://example.com/cited', title: 'Citation' },
    ]);
    expect(tracker.completedSearch).toBe(true);
    expect(publish.mock.calls.map(([event]) => event.status)).toEqual(['in_progress', 'completed']);
    expect(publish.mock.calls.map(([event]) => event.detail)).toEqual([
      'DeepSeek API public documentation', 'DeepSeek API public documentation',
    ]);
    expect(events.at(-1)).toEqual({
      id: 'native-pro-1', choices: [{ finish_reason: 'stop' }],
      usage: { prompt_tokens: 10, completion_tokens: 6, total_tokens: 16 },
    });
    expect(JSON.stringify(events)).not.toContain('synthetic private');
    expect(JSON.stringify(events)).not.toContain('credential@');
  });

  it('completes a matching live search before final metadata while other calls remain active or fail', async () => {
    const search = { type: 'web_search_call', id: 'search-live', status: 'in_progress', action: { type: 'search' } };
    const page = { type: 'web_search_call', id: 'page-live', status: 'in_progress', action: { type: 'open_page' } };
    const failed = { type: 'web_search_call', id: 'search-failed', status: 'in_progress', action: { type: 'search' } };
    const events = await collect([
      { type: 'response.output_item.added', output_index: 0, item: search },
      { type: 'response.output_item.added', output_index: 1, item: page },
      { type: 'response.output_item.added', output_index: 2, item: failed },
      { type: 'response.output_item.added', output_index: 3, item: { type: 'function_call', id: 'other-tool' } },
      { type: 'response.web_search_call.in_progress', output_index: 0, item_id: search.id, sequence_number: 4 },
      { type: 'response.web_search_call.searching', output_index: 0, item_id: search.id, sequence_number: 5 },
      { type: 'response.web_search_call.completed', output_index: 1, item_id: search.id, sequence_number: 6 },
      { type: 'response.web_search_call.completed', output_index: 3, item_id: 'other-tool', sequence_number: 7 },
      { type: 'response.web_search_call.completed', output_index: 4, item_id: 'unknown', sequence_number: 8 },
      { type: 'response.web_search_call.searching', output_index: 1, item_id: page.id, sequence_number: 9 },
      { type: 'response.web_search_call.completed', output_index: 0, item_id: search.id, sequence_number: 10,
        action: { queries: ['private search query'], sources: [{ type: 'url', url: 'https://example.com/not-a-source' }] },
      },
      { type: 'response.output_item.done', output_index: 2, item: { ...failed, status: 'failed', error: { code: 'unavailable' } } },
      { type: 'response.web_search_call.completed', output_index: 2, item_id: failed.id, sequence_number: 12 },
      { type: 'response.web_search_call.searching', output_index: 0, item_id: search.id, sequence_number: 13 },
    ]);
    const tracker = new DeepSeekWebResults();
    const publish = vi.fn();
    for (const event of events) tracker.ingest('choices' in event ? event.choices?.[0] : undefined, publish);

    expect(publish.mock.calls.map(([event]) => [event.id, event.kind, event.status])).toEqual([
      ['deepseek-search-live', 'web_search', 'in_progress'],
      ['deepseek-page-live', 'open_page', 'in_progress'],
      ['deepseek-search-failed', 'web_search', 'in_progress'],
      ['deepseek-search-live', 'web_search', 'completed'],
      ['deepseek-search-failed', 'web_search', 'failed'],
    ]);
    expect(tracker.completedSearch).toBe(true);
    expect(tracker.sources.size).toBe(0);
    expect(JSON.stringify(events)).not.toMatch(/private search query|not-a-source/);
  });

  it('waits for actual web action metadata and reuses known actions for the same output item', async () => {
    const page = { type: 'web_search_call', id: 'read-page', status: 'in_progress' };
    const find = { type: 'web_search_call', id: 'find-in-page', status: 'in_progress' };
    const source = { url: 'https://example.com/manual', title: 'Manual' };
    const events = await collect([
      { type: 'response.output_item.added', output_index: 0, item: page },
      { type: 'response.web_search_call.searching', output_index: 0, item_id: page.id, sequence_number: 1 },
      { type: 'response.web_search_call.completed', output_index: 0, item_id: page.id, sequence_number: 2 },
      { type: 'response.output_item.added', output_index: 1, item: { ...find, action: { type: 'find_in_page' } } },
      { type: 'response.output_item.done', output_index: 0,
        item: { ...page, status: 'completed', action: { type: 'open_page' }, page: source } },
      { type: 'response.output_item.done', output_index: 1, item: { ...find, status: 'completed' } },
    ]);
    const tracker = new DeepSeekWebResults();
    const publish = vi.fn();
    for (const event of events) tracker.ingest('choices' in event ? event.choices?.[0] : undefined, publish);

    expect(publish.mock.calls.map(([event]) => [event.id, event.kind, event.status])).toEqual([
      ['deepseek-find-in-page', 'find_in_page', 'in_progress'],
      ['deepseek-read-page', 'open_page', 'completed'],
      ['deepseek-find-in-page', 'find_in_page', 'completed'],
    ]);
    expect([...tracker.sources.values()]).toEqual([source]);
    expect(tracker.completedSearch).toBe(false);
  });

  it.each(['text.done', 'item.done', 'completed'])('reconciles a split profile proposal from %s without replaying visible text', async source => {
    const stream = new DeepSeekProfileStream();
    const answer = '请确认清空职位描述。';
    const prefix = `<profile_intent>proposal</profile_intent>\n${answer}\n<profile_proposal>\n{"changes":`;
    const tail = '{"jobDescription":""},"skillScope":null}\n</profile_proposal>';
    const identity = { output_index: 2, content_index: 0, item_id: 'profile-answer' };
    const item = { type: 'message', id: identity.item_id, phase: 'final_answer' };
    const finalItem = { ...item, content: [{ type: 'output_text', text: prefix + tail }] };
    const events = await collect([
      { type: 'response.output_item.added', output_index: identity.output_index, item },
      { type: 'response.output_text.delta', ...identity, delta: prefix },
      ...(source === 'text.done' ? [{ type: 'response.output_text.done', ...identity, text: prefix + tail }] : []),
      ...(source === 'item.done' ? [{ type: 'response.output_item.done', output_index: identity.output_index, item: finalItem }] : []),
      { type: 'response.completed', response: { status: 'completed', id: 'profile-request',
        output: source === 'completed' ? [finalItem] : [],
        usage: { input_tokens: 7, output_tokens: 3, total_tokens: 10 },
      } },
    ]);

    const deltas = answerDeltas(events);
    expect(deltas).toEqual([prefix, tail]);
    expect(deltas.map(delta => stream.append(delta)).join('')).toBe(answer);
    const profile = { name: '', background: '', jobDescription: '合成职位描述' };
    expect(stream.finish(profile)).toEqual({ answerText: answer, changes: { jobDescription: '' }, skillScope: null, delta: '' });
    expect(profile.jobDescription).toBe('合成职位描述');
    expect(events.at(-1)).toEqual({ id: 'profile-request', choices: [{ finish_reason: 'stop' }],
      usage: { prompt_tokens: 7, completion_tokens: 3, total_tokens: 10 },
    });
  });

  it('does not complete a proposal when the authoritative text changes an emitted prefix', async () => {
    const identity = { output_index: 0, content_index: 0, item_id: 'profile-answer' };
    const prefix = '{"answer":"请确认清空职位描述。",';
    const events = await collect([
      { type: 'response.output_text.delta', ...identity, delta: prefix },
      { type: 'response.completed', response: { status: 'completed', id: 'inconsistent-request',
        output: [{ id: identity.item_id, type: 'message', content: [
          { type: 'output_text', text: '{"answer":"Different answer","changes":{}}' },
        ] }],
        usage: { input_tokens: 4, output_tokens: 2, total_tokens: 6 },
      } },
    ]);
    expect(answerDeltas(events)).toEqual([prefix]);
    expect(events.at(-1)).toEqual({ type: 'error', id: 'inconsistent-request',
      usage: { prompt_tokens: 4, completion_tokens: 2, total_tokens: 6 },
    });
  });

  it('omits known commentary even if its final snapshot omits the phase and changes order', async () => {
    const annotation = { type: 'url_citation', url: 'https://example.com/commentary', title: 'Commentary link' };
    const commentary = { type: 'message', id: 'commentary' };
    const events = await collect([
      { type: 'response.output_item.added', output_index: 2, item: { ...commentary, phase: 'commentary' } },
      { type: 'response.output_text.done', output_index: 2, item_id: commentary.id, content_index: 0, text: 'Hidden' },
      { type: 'response.completed', response: { status: 'completed', output: [
        { ...commentary, content: [{ type: 'output_text', text: 'Hidden', annotations: [annotation] }] },
        { type: 'message', id: 'final', content: [{ type: 'output_text', text: 'Visible' }] },
      ] } },
    ]);
    expect(answerDeltas(events)).toEqual(['Visible']);
    expect(JSON.stringify(events)).not.toContain('Hidden');
    expect(JSON.stringify(events)).not.toContain(annotation.url);
  });

  it('keeps incomplete and failed output distinguishable from success', async () => {
    const partial = { type: 'response.output_text.delta', delta: 'Partial' };
    const delta = { choices: [{ delta: { content: 'Partial' } }] };
    await expect(collect([partial])).resolves.toEqual([delta]);
    await expect(collect([partial, { type: 'response.incomplete', response: {
      status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' },
    } }])).resolves.toEqual([
      delta, { id: undefined, choices: [{ finish_reason: 'length' }], usage: undefined },
    ]);
    await expect(collect([{ type: 'response.incomplete', response: {
      status: 'incomplete', incomplete_details: { reason: 'content_filter' },
      output: [{ type: 'web_search_call', id: 'hidden', status: 'completed' }],
    } }])).resolves.toEqual([
      { id: undefined, choices: [{ finish_reason: 'content_filter' }], usage: undefined },
    ]);
    await expect(collect([partial, { type: 'response.failed', response: {
      status: 'failed', id: 'failed-id', error: { message: 'synthetic private upstream error' },
      usage: { input_tokens: 5, output_tokens: 3, total_tokens: 8 },
    } }])).resolves.toEqual([
      delta, { type: 'error', id: 'failed-id', usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 } },
    ]);
  });
});
