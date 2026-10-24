import { documents as technicalDocuments } from './rag-quality';

// Fixed synthetic facts and labels, authored before the run. These cases are an
// exploratory colloquial retrieval audit, not independent human-labelled data.
export const projects = [
  {
    id: 'xingqiao',
    name: '星桥',
    text: `## Q001. 星桥订单项目如何处理重复消息？

星桥是虚构的订单服务。Kafka 消费者可能收到重复的支付成功消息。我们以订单号和支付流水号组成业务唯一键，在同一个数据库事务内写入去重记录并修改订单状态，提交成功后再提交 offset。

### 追问 1：星桥项目的压测结果是什么？

在固定的合成压测条件下，星桥订单处理吞吐为每秒 2400 单，P99 延迟为 85 毫秒。这些数字只属于星桥，不能用于其他项目。

### 追问 2：星桥项目如何处理事务提交后的进程崩溃？

数据库已提交但 offset 未提交时会重复投递。消费者通过数据库唯一约束识别已处理流水，不再次扣款；事务性 outbox 用来可靠发送后续通知。`,
  },
  {
    id: 'qinghe',
    name: '青禾',
    text: `## Q001. 青禾传感器项目如何稳定探头距离？

青禾是虚构的检测平台。传感器测量探头与被测物之间的提离距离，PID 闭环根据距离误差控制直线执行器，避免探头距离波动。

### 追问 1：青禾项目使用的采样和控制参数是什么？

青禾的采样频率为 200 赫兹，目标提离距离为 2 毫米。此资料没有给出比例、积分和微分系数的具体数值。

### 追问 2：青禾如何防止执行器到达极限后继续积分？

执行器输出达到上限时暂停同方向积分，并限制积分累计量；微分项采用低通滤波，防止传感器噪声放大。`,
  },
  {
    id: 'yuanfan',
    name: '远帆',
    text: `## Q001. 远帆桌面项目如何避免界面卡顿？

远帆是虚构的 Qt 桌面监控程序。工作线程负责读取设备，queued connection 将刷新消息投递到 GUI 线程。工作线程不能直接修改 QWidget。

### 追问 1：远帆项目怎样合并高频刷新？

远帆把界面刷新限制为每秒 20 次，每批合并 50 条采集记录，超过的中间显示帧可丢弃，但原始数据不能丢弃。

### 追问 2：远帆如何验证卡顿改善？

在同一合成输入和硬件条件下，对比事件队列积压与界面刷新耗时；资料没有记录性能提升的百分比。`,
  },
  {
    id: 'beichen',
    name: '北辰',
    text: `## Q001. 北辰商品项目如何处理缓存一致性？

北辰是虚构的商品服务。更新商品时先提交 PostgreSQL 数据库事务，再删除 Redis 缓存；缓存采用 cache-aside，过期时间只用于兜底，不能保证强一致。

### 追问 1：北辰项目的缓存参数是什么？

北辰热点商品的缓存过期时间为 90 秒，并添加随机抖动，避免同一时刻集中失效。这个参数不属于星桥、青禾或远帆。

### 追问 2：北辰如何应对删除缓存失败？

删除失败后通过可靠消息补偿，并使用商品版本号识别旧值；定期检查补偿队列，不能仅靠过期时间判断数据一致。`,
  },
] as const;

export const documents = [
  ...technicalDocuments,
  ...projects.map((project) => ({
    id: project.id,
    title: project.name + '项目',
    text: project.text,
  })),
];

type Case = {
  id: string;
  group: string;
  query: string;
  documentId: string | null;
  previous?: string;
  requiredText?: string;
  kind: 'answerable' | 'unrelated' | 'missing_fact' | 'ambiguous';
};
const cases: Case[] = [];
function add(
  group: string,
  documentId: string | null,
  queries: string[],
  extra: Partial<Case> = {},
) {
  for (const query of queries)
    cases.push({
      id: `${group}-${cases.length + 1}`,
      group,
      query,
      documentId,
      kind: documentId ? 'answerable' : 'unrelated',
      ...extra,
    });
}

for (const [id, queries] of [
  [
    'pid',
    [
      'PID 这玩意儿到底咋把误差压下去的？',
      '能不能用大白话讲讲 PID 是怎么调的？',
      '那个 PID，为啥要把比例积分微分搁一块儿用？',
    ],
  ],
  [
    'qt',
    [
      'Qt 后台线程算完了，结果怎么丢到界面上呀？',
      '我在 Qt 的工作线程里直接改控件，不行吗？',
      'Qt 那个 queued connection，你通俗点说是干啥的？',
    ],
  ],
  [
    'kafka',
    [
      'Kafka 同一条消息来了两遍，咋办啊？',
      'Kafka 消费完了还没交 offset 就挂了，会咋样？',
      'Kafka 这边怎么保证别重复扣一笔钱？',
    ],
  ],
  [
    'postgres',
    [
      'Postgres 读数据的时候，怎么还能让别人接着改呀？',
      'PostgreSQL 的 MVCC，别太书面，给我讲讲呗。',
      'PostgreSQL 一个事务老不结束，是不是会拖住清理啊？',
    ],
  ],
  [
    'redis',
    [
      'Redis 里的值跟数据库对不上了，你一般咋整？',
      'Redis 是先删缓存，还是先改库啊？',
      'Redis 给个过期时间，就算强一致了？',
    ],
  ],
  [
    'tls',
    [
      'TLS 证书到底是在证明啥呀？',
      'TLS 为啥非得查那个域名和证书链？',
      'HTTPS 证书校验关掉省事儿不行吗？',
    ],
  ],
  [
    'transformer',
    [
      'Transformer 里的 Q、K、V，你能举个直白点的说法吗？',
      'self-attention 为啥句子一长就特别吃内存啊？',
      'Transformer 是怎么知道哪些词该互相看一眼的？',
    ],
  ],
  [
    'docker',
    [
      'Dockerfile 前面改一行，后头怎么全重跑了？',
      'Docker 那些一层一层的东西是咋复用的？',
      'Docker 构建的时候，依赖文件为啥要先拷进去？',
    ],
  ],
  [
    'kalman',
    [
      'Kalman 一会儿预测一会儿测量，到底怎么凑一块儿的？',
      '卡尔曼算出来老是飘，是不是噪声参数没弄对？',
      'Kalman 收到带噪声的测量值后，咋把状态修回来？',
    ],
  ],
  [
    'raft',
    [
      'Raft 是不是过半数点头就能交日志了？',
      'Raft 网络断成两块儿，小的那边还能接着写吗？',
      'Raft 老大换了，怎么认出来前任发的旧消息？',
    ],
  ],
] as [string, string[]][])
  add('oral_named', id, queries);

for (const [id, queries] of [
  [
    'pid',
    ['探头离工件忽远忽近的，反馈控制咋让它稳下来？', '比例、积分、微分这三部分，各自在忙啥呀？'],
  ],
  [
    'qt',
    [
      '后台干活儿的线程想改窗口上的控件，怎么弄才安全？',
      '把槽函数扔回主线程的事件循环里，这步有啥用？',
    ],
  ],
  [
    'kafka',
    ['消息又送了一遍，怎么让业务别再执行一遍？', '处理完消息到记下消费进度之间，程序崩了咋办？'],
  ],
  [
    'postgres',
    [
      '同一条数据留着好几个版本，读的时候到底看哪个？',
      '事务一直开着不关，旧的那些行是不是清不掉？',
    ],
  ],
  [
    'redis',
    [
      '库里更新成功了，可缓存里还是老的，咋避免啊？',
      '缓存到了时间自己失效，就能保证读到最新的吗？',
    ],
  ],
  [
    'tls',
    [
      '浏览器咋知道连上的真是那个网站，不是别人冒充的？',
      '证书过期了还照样信它，会不会有中间人风险啊？',
    ],
  ],
  [
    'transformer',
    ['注意力里查询、键和值到底怎么配合呀？', '句子长度翻倍，那个注意力矩阵会不会涨到四倍？'],
  ],
  [
    'docker',
    [
      '镜像前面的复制步骤变了，为啥后面的缓存也没了？',
      '镜像是只读的，那容器运行时往哪儿写文件呀？',
    ],
  ],
  [
    'kalman',
    [
      '先预测一下，再拿测量来修正，这个滤波怎么工作的呀？',
      '测量不太准的时候，状态估计该更信预测还是更信观测？',
    ],
  ],
  [
    'raft',
    [
      '少数机器连不上多数那边了，还能提交复制的日志吗？',
      '靠多数节点确认日志的那个协议，是怎么防止老领导捣乱的？',
    ],
  ],
] as [string, string[]][])
  add('oral_implicit', id, queries);

for (const [id, previous, limitation, improvement] of [
  ['pid', '刚才问的是 PID 闭环怎么稳住探头。', '积分累积', '抗积分饱和'],
  ['qt', '咱们先聊 Qt 工作线程通过 queued signal 刷新界面。', '事件积压', '降低信号频率'],
  ['kafka', '我想问 Kafka 消费者怎么做幂等。', '重复投递', '幂等键'],
  ['postgres', '刚才那个问题是 PostgreSQL 的 MVCC。', '表膨胀', '控制事务时长'],
  ['redis', '先说说 Redis 的 cache-aside 缓存方案。', '短暂不一致', '消息补偿'],
  ['tls', '我们刚才讨论的是 TLS 证书身份校验。', '握手失败', '自动续期'],
  ['kalman', '刚才说的是 Kalman 状态估计。', '发散', '残差'],
  ['raft', '我们接着说 Raft 多数派日志复制。', '无法提交', '选举超时'],
]) {
  add('oral_followup', id, ['那它有啥坑啊？'], { previous, requiredText: limitation });
  add('oral_followup', id, ['那还能咋改，让它好点儿？'], { previous, requiredText: improvement });
}

for (const [id, queries, previous, followups] of [
  [
    'xingqiao',
    [
      '星桥订单那块儿，消息重复来了咋办？',
      '星桥那个压测，一秒大概能扛多少单？',
      '星桥里库提交了但消费进度还没记下来就挂了，咋整？',
    ],
    '先聊星桥订单项目的支付消息处理。',
    ['那当时一秒能扛多少单来着？', '那 P99 大概多少呀？'],
  ],
  [
    'qinghe',
    [
      '青禾那个探头，离工件的距离怎么稳住的？',
      '青禾采样有多快呀？',
      '青禾执行器都顶到头了，积分还一直加咋办？',
    ],
    '先说说青禾的传感器提离控制项目。',
    ['那你们当时一秒采几次来着？', '那探头到底离工件多远呀？'],
  ],
  [
    'yuanfan',
    [
      '远帆界面老卡，后台算完了怎么刷上去呀？',
      '远帆一秒最多刷新多少回呀？',
      '远帆刷新跟不上了，中间帧能直接扔吗？',
    ],
    '刚才聊的是远帆的 Qt 桌面监控项目。',
    ['那你们一秒到底刷几次呀？', '那一批合多少条来着？'],
  ],
  [
    'beichen',
    [
      '北辰商品改完了，缓存还是老值咋办啊？',
      '北辰那个缓存大概多久过期呀？',
      '北辰删缓存没删掉，后面咋补救？',
    ],
    '刚才说的是北辰商品缓存项目。',
    ['那你们过期时间当时设了多少啊？', '那缓存删失败了，后面咋兜底呀？'],
  ],
] as [string, string[], string, string[]][]) {
  add('oral_project', id, queries);
  add('project_followup', id, followups, { previous });
}

for (const [id, query, previous] of [
  ['redis', '换个事儿，Redis 缓存跟数据库对不齐一般咋办？', '先讲一下 TLS 证书校验。'],
  ['docker', '先不聊那个了，Docker 缓存为啥突然全失效啊？', '刚才问的是 PID 控制。'],
  ['raft', '我问的不是缓存，我问 Raft 少数派能不能提交日志？', '刚才聊的是 Redis cache-aside。'],
  ['qt', '打断一下，Qt 工作线程直接碰界面会怎么样？', '之前讨论 Kafka 的 offset。'],
  ['kafka', '换个话题，Kafka 重复消费怎么不重复改库？', '先聊 Docker 镜像分层。'],
  ['xingqiao', '不是北辰，我现在问星桥一秒能处理多少单？', '北辰的缓存过期时间是多少？'],
  ['beichen', '不说星桥了，北辰的缓存到底设多久过期？', '星桥的 P99 延迟是多少？'],
  ['kalman', '前面那个先放放，Kalman 测量噪声参数怎么调呀？', '之前问 PostgreSQL 长事务。'],
])
  add('topic_switch', id, [query], { previous });

for (const [id, query] of [
  ['kafka', '卡夫卡消息重复消费了，咋让它别重复扣款啊？'],
  ['redis', '瑞迪斯跟数据库不一致的时候，一般先动哪边？'],
  ['pid', '皮艾迪控制里面那个积分，顶到头还一直加咋办？'],
  ['qt', '扣提那个工作线程，咋把结果更新到窗口上？'],
  ['postgres', '破斯特格瑞斯的长事务，咋就会把旧版本清理卡住呢？'],
  ['docker', '多克那个镜像，改了前头一层后面就不能复用了？'],
  ['kalman', '卡尔曼那块儿预测和测量有偏差，是咋纠正的？'],
  ['raft', '拉夫特网络分区了，少的那边还能交日志不？'],
])
  add('transcript_alias', id, [query]);

add('no_answer_far', null, [
  '哎，今晚下雨不，我要不要带伞啊？',
  '面包烤出来老塌，是我酵母放多了吗？',
  '明天英镑会涨还是跌呀？',
  '我家猫最近不爱吃饭，咋回事儿啊？',
  '土星那圈圈到底啥做的呀？',
  '帮我挑个周末能去的海边呗。',
]);
// Related evidence can be useful despite not containing the requested fact.
// These are reported separately, never counted as ordinary false positives.
add('missing_project_fact', 'qinghe', ['青禾那个 Kp 到底填了多少呀？'], { kind: 'missing_fact' });
add('missing_project_fact', 'xingqiao', ['星桥当时花了多少钱，团队几个人呀？'], {
  kind: 'missing_fact',
});
add('missing_project_fact', 'yuanfan', ['远帆优化后快了百分之多少啊？'], { kind: 'missing_fact' });
add('missing_project_fact', 'beichen', ['北辰上线后到底多赚了多少钱呀？'], {
  kind: 'missing_fact',
});
add('missing_technical_fact', 'tls', ['TLS 证书私钥具体是哪一串啊？'], { kind: 'missing_fact' });
add('missing_technical_fact', 'kafka', ['Kafka 集群那几台机器的 IP 是啥来着？'], {
  kind: 'missing_fact',
});
add(
  'ambiguous_no_context',
  null,
  [
    '那参数到底是多少呀？',
    '你们那边最后咋弄好的？',
    '它为啥老不行啊？',
    '后来提升了多少来着？',
    '这个你能再展开说说不？',
    '那具体啥时候重试呀？',
  ],
  { kind: 'ambiguous' },
);

export { cases };
