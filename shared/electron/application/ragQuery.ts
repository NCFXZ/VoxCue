// Deterministic local query preparation only. The generation question and
// transcript remain verbatim; no model call, index write or invented topic.
export function retrievalFocus(query: string) {
  return query.includes('\n当前追问：') ? query.split('\n当前追问：').at(-1)! : query;
}

export function normalizeRetrievalQuery(query: string) {
  return query
    .replace(/(?:先不聊|不再聊|不说|不聊|不谈)[^，,；;。\n]{1,100}[，,；;。]/g, '')
    .replace(/不是[^，,；;。\n]{1,100}[，,；;。](?=(?:我(?:现在)?问|现在(?:问|说|聊)|而是))/g, '')
    .replace(/(?:有啥|有什么|有哪些|有何)(?:坑|毛病|不足|缺点)(?:啊|呀|呢)?/g, '有什么局限')
    .replace(/(?:还(?:能|可以))?(?:咋|怎么)(?:改进|优化|改)(?:[，,\s]*让它好点儿)?/g, '如何优化')
    .replace(/咋回事儿?/g, '为什么')
    .replace(/咋(?:办|整)/g, '怎么办');
}

export function isUnresolvedReference(query: string) {
  if (query.includes('\n当前追问：')) return false;
  const text = normalizeRetrievalQuery(query).trim();
  if (!/^(?:那|那么|它|这个|后来|当时|你们)/.test(text)) return false;
  // Pronouns plus generic requests for a parameter/result/action do not name a
  // subject. A technical noun or an explicit project leaves text remaining.
  return !text
    .replace(/(?:怎么|咋)(?:弄|做|处理)(?:好|完|了|的)?/g, '')
    .replace(
      /你能再|能不能|你们|咱们|他们|那边|那么|这个|后来|当时|最后|具体|啥时候|什么时候|参数|到底|多少|来着|提升了?|重试|展开|说说|为啥|为什么|不行|老|它|那|你|能|再|是|的|不|了/g,
      '',
    )
    .replace(/[\s\p{P}啊呀吧呢呗嘛啦哦]+/gu, '');
}
