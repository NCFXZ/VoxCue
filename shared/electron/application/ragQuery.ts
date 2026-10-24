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

export function isTopicChange(text: string) {
  return /不是|并非|改为|现在(?:聊|谈|说|问)|接下来|换个|换一|切换|打断一下|先不聊|不说.+了|\b(?:instead|not\s+.+but|now\s+(?:talk|discuss))\b/i.test(
    text.replace(/是不是/g, '是否'),
  );
}

export function isDependentQuestion(text: string) {
  return (
    /(?:这种|这个)(?:方法|方案|项目|系统|算法|设计|机制|模型)|该(?:方法|方案|项目|系统)|刚才|上述|它|\b(?:this|that|it|those)\b/i.test(
      text,
    ) ||
    /^(?:那|那么)\s*(?:你们|咱们|他们|当时|后来|还能|还可以|一(?:秒|批)|具体|.{2,12}?(?:到底|当时)|.{2,20}?[，,](?:后面|后来)|P\d{1,3}\b)/i.test(
      text,
    ) ||
    /^(?:那么|那|还有|然后)?(?:有什么局限|有哪些局限|有何局限|有什么缺点|如何优化|怎么改进|为什么这样|为什么呢|还有呢|然后呢)[？?。\s]*$/.test(
      text,
    )
  );
}

export function explicitPriorTopic(text: string) {
  // A restatement can contain 刚才 and still name a concrete topic. It must not
  // be skipped as though it were an unresolved pronoun-only follow-up.
  return text
    .trim()
    .replace(
      /^(?:(?:我们|咱们)\s*)?(?:刚才|之前|前面)(?:(?:那个)?问题|问的?|说的?|聊的?|讨论的?)?(?:的?是|讨论的是|说的是|聊的是)?\s*/,
      '',
    );
}

export function hasIndependentSubject(question: string, previous: string) {
  const project = question.match(/^(?:那|那么|这个)?([\u4e00-\u9fff]{2,20})项目/)?.[1];
  if (project && !/^(?:这个|那个|你们|咱们)/.test(project) && !previous.includes(project))
    return true;
  const terms = question.match(/[A-Za-z][A-Za-z0-9_+-]{2,}/g) ?? [];
  if (
    terms.some(
      (term) =>
        !/^(?:this|that|those|the|how|why|what|does|can|are|p\d{1,3}|qps|tps)$/i.test(term) &&
        !previous.toLowerCase().includes(term.toLowerCase()),
    )
  )
    return true;
  const subject = question.match(
    /^(?:那|那么)?([\u4e00-\u9fff]{2,16}?)(?:是怎么|怎么|如何|为啥|为什么)/,
  )?.[1];
  return (
    !!subject && !/^(?:你们|咱们|他们|这个|这种|它|还)/.test(subject) && !previous.includes(subject)
  );
}
