// Authored only after local-v6 source/compiled backend was frozen. Fresh facts,
// names and oral conversations; no imports from earlier evaluation datasets.
// Once observed, this is a known evaluation set, not a future blind holdout.
type History = {
  kind: 'question' | 'interviewee' | 'interviewer' | 'gap' | 'suggestion';
  text: string;
};
type Target = { documentId: string; root: number; fact: string };
type Case = {
  id: string;
  group: string;
  query: string;
  history: History[];
  targets: Target[];
  kind: 'answerable' | 'unrelated' | 'ambiguous' | 'missing_fact';
  projects: string[];
};

const topics = [
  {
    id: 'dns',
    title: 'DNS缓存时效',
    body: 'DNS解析器根据TTL缓存资源记录，到期后重新查询。修改权威记录不会主动收回各地已经缓存的旧记录，迁移要提前降低TTL并安排新旧服务共存。',
    risk: 'NXDOMAIN负缓存也有有效期，先查到域名不存在的客户端可能在建好记录后仍继续返回旧的不存在结果。',
    fix: '迁移前预留旧TTL传播时间，确认权威与递归解析结果，并检查负缓存时效；不把本机刷新成功当作全网已更新。',
    verify:
      '在受控权威和递归解析器上记录TTL剩余值，修改记录并重复查询，分别观察旧记录与负缓存到期的行为。',
    limit: 'TTL只能约束正常遵守协议的缓存，客户端自身缓存和异常解析器可能导致额外延迟。',
    seed: 'DNS换了新地址，咋还有人连着旧机器呢？',
    follow: [
      '缓存多久再问一遍，是谁说了算啊？',
      '域名还没建好就有人查了，后来建好了咋还说没有？',
      '真要搬机器，你会提前做哪几步，讲实际点儿。',
      '我本地已经好了，怎么证明别处也按预期变了？',
      '所以那个时间一到，就能保证所有人立刻都变过来？',
    ],
  },
  {
    id: 'quic',
    title: 'QUIC流独立传输',
    body: 'QUIC在UDP上实现可靠传输，不同流各自维护有序字节。一个流丢包不会因为统一TCP字节序列阻塞另一个流交付，但连接级拥塞控制仍共享网络容量。',
    risk: '某个流持续丢包仍会触发连接级拥塞控制，不能把流之间避免队头阻塞说成完全互不影响。',
    fix: '区分流内重传与整条连接拥塞，监控各流完成时间和网络丢包，合理设置流量控制窗口。',
    verify: '对同一批并发流注入单流丢包，比较各流交付时间并观察整条连接的拥塞窗口变化。',
    limit: 'QUIC的流独立性不消除带宽竞争、服务器排队或应用层等待。',
    seed: 'QUIC说一个请求掉包别的不用等，真就一点也不影响别人了？',
    follow: [
      '它把每条数据分开管顺序，是这个意思吧？',
      '那一条拼命丢包，会不会把整根连接也拖慢？',
      '真慢下来了，怎么分清是哪一层卡的？',
      '想专门验证这个说法，该往哪儿塞点故障？',
      '业务自己还排着队，那换了这个也不会凭空变快吧？',
    ],
  },
  {
    id: 'probe',
    title: 'Kubernetes健康探针',
    body: 'Kubernetes的readiness探针决定实例能否接收服务流量，liveness探针判断是否需要重启容器，startup探针为启动较慢的程序预留初始化时间。',
    risk: '把依赖服务暂时不可用写进liveness检查，可能导致所有实例反复重启，反而放大故障。',
    fix: 'readiness表达是否适合接流量，liveness只覆盖自身不可恢复故障，慢启动使用startup探针，阈值要考虑真实初始化耗时。',
    verify:
      '分别注入应用僵死、依赖服务中断和慢启动，核对流量摘除、容器重启及启动等待是否符合预期。',
    limit: '探针成功不代表业务所有路径正常，还需要端到端可用性观测。',
    seed: 'Kubernetes里程序进程还在，就能让它接请求了么？',
    follow: [
      '一个管接不接活，一个管要不要重开，对吧？',
      '后面那个依赖临时挂了，就一直重启自己合适吗？',
      '初始化特别慢那种，你咋给它留点时间？',
      '不是看它变绿就完了吧，具体得试哪几种坏法？',
      '灯都是绿的，就能说整条业务链路都好了？',
    ],
  },
  {
    id: 'lsm',
    title: 'LSM有序合并',
    body: 'LSM先把更新写到内存表和日志，再生成有序不可变文件，通过后台compaction合并文件并回收过时版本，以顺序写换取后台整理成本。',
    risk: 'compaction可能产生写放大并争抢磁盘带宽，墓碑在旧文件仍可能包含被删键时不能直接丢弃。',
    fix: '限制后台合并并发和带宽，根据层级与工作负载选择整理策略，结合快照存活情况判断墓碑何时可以回收。',
    verify:
      '用固定读写比例持续压测，记录前台延迟、后台写入字节以及逻辑写入字节，单独测试删除键是否复活。',
    limit: '降低写放大可能增加读取要查的文件数，合并策略需要在读取、写入和空间之间折中。',
    seed: 'LSM明明前面顺着写挺快，为啥后来磁盘一直忙？',
    follow: [
      '等于先落一批小的，后面再慢慢整理，是不是？',
      '删完了那个标记，干脆扔掉能省地方吗？',
      '后台跟前台抢盘，你会先管住什么？',
      '想看写放大到底多大，要拿哪两份写入量比？',
      '那我少整理点，会不会反过来让读取更累？',
    ],
  },
  {
    id: 'seqlock',
    title: 'seqlock乐观读取',
    body: 'seqlock用序列计数保护读取：写入前后更新计数，读者发现计数为奇数或读取前后变化就重读，写者之间仍需要互斥。',
    risk: '持续写入会让读者反复重试甚至饥饿，包含失效指针的结构也不能只靠计数安全读取。',
    fix: '限定适用的数据结构，避免读者解引用可被释放的对象，必要时为过多重试提供带锁回退，并监控重试次数。',
    verify: '制造高频写入和并发读者，检测读出的字段是否来自一致快照，同时统计重试和尾延迟。',
    limit: 'seqlock更适合读多写少且复制代价小的数据，不适合无限重试或复杂对象生命周期。',
    seed: 'seqlock读的人不加普通锁，咋知道读到一半没被改呢？',
    follow: [
      '读之前和读之后看一眼那个数，是这个逻辑吧？',
      '写的人根本停不下来，读的人不是白忙活么？',
      '里面还有指针呢，被别人释放了可咋办？',
      '要抓读出来前后不一致的问题，怎么故意把它弄出来？',
      '所以不是啥结构都能这么读，适合什么样的场景？',
    ],
  },
  {
    id: 'websocket',
    title: 'WebSocket恢复会话',
    body: 'WebSocket提供长连接上的双向消息，连接恢复不自动补齐断线期间的业务消息。客户端保存最后确认序号，服务端按保留日志重放，收端按消息标识去重。',
    risk: '网络看似连接着但对端已经失联，或者重连期间错过消息，单靠连接成功事件不能证明业务状态完整。',
    fix: '应用心跳设置合理超时，重连使用带随机抖动的退避，基于序号补发并在日志超出保留范围时获取完整快照。',
    verify: '注入半开连接、断网和重复消息，对比重连后的消息序号连续性以及最终业务快照。',
    limit: '心跳过于频繁会增加耗电和网络负担，重放日志也不能无限期保留。',
    seed: 'WebSocket重新连上了，刚才断掉那段消息会自己补回来吗？',
    follow: [
      '所以还得自己记住最后收到了哪一条？',
      '连接图标还亮着，可对面已经没反应了，怎么发现？',
      '好多人一起掉线又一起连回来，咋别把服务冲垮？',
      '想看看漏了没、重了没，你会怎么断一下试试？',
      '那心跳是不是越勤越稳，记录是不是一直留着就行？',
    ],
  },
  {
    id: 'events',
    title: 'EventSourcing状态重放',
    body: 'EventSourcing把业务事件作为事实记录，通过按序重放构建当前状态。快照保存某个版本的状态和对应事件位置，恢复时从该位置之后继续重放。',
    risk: '事件格式变化或投影处理逻辑不兼容，可能让旧事件无法重放；重新投影时也不应再次执行外部扣款。',
    fix: '为事件维护明确版本并提供兼容转换，投影与外部副作用分离，使用幂等标识控制必须执行的副作用。',
    verify:
      '从同一事件日志分别全量重放和快照续放，对比最终状态与事件位置，检查没有重复外部副作用。',
    limit: '事件日志不直接等于方便的查询视图，需要独立投影，修正历史事实通常追加补偿事件。',
    seed: 'EventSourcing存一堆事件，真要恢复现在的状态咋弄？',
    follow: [
      '有个中途存下来的快照，就不用从第一条开始了吧？',
      '以前的格式和现在的不一样，重放会不会直接炸？',
      '重跑一回投影，可别又扣一回钱啊，这咋隔开？',
      '有快照和没快照算出来一样，你怎么验证？',
      '那要查报表或者改以前的错误，直接改日志就完了？',
    ],
  },
  {
    id: 'ring',
    title: '一致性哈希分布',
    body: '一致性哈希把节点与键映射到环上，键交给顺时针遇到的节点。增减节点只迁移相邻范围，虚拟节点可以缓和节点数量较少造成的分布不均。',
    risk: '虚拟节点不能消除单个超热键的压力，物理节点失效时也会使其负责的范围转移给其他节点。',
    fix: '为节点配置合理的虚拟节点数量并监控负载，热键单独做复制或拆分，节点变更时有序迁移并限制迁移流量。',
    verify:
      '固定同一批键，逐次增减节点，统计需要迁移的键比例、各物理节点负载和迁移期间的请求延迟。',
    limit: '分布均衡与迁移开销取决于节点权重和键分布，不能承诺每个节点承担完全一样的流量。',
    seed: '一致性哈希加一台机器，为啥不用把所有键都重新分一遍？',
    follow: [
      '就是顺着那个圈找下一个节点，是这意思吗？',
      '有一个键特别烫，弄很多虚拟节点也没用吧？',
      '真加减机器时，怎么别让迁移把正常请求挤没了？',
      '想证明少搬东西又没分歪，测试要固定什么？',
      '那最后每台机器就一定一样忙了？',
    ],
  },
] as const;

const projects = [
  {
    id: 'paperboat',
    name: '纸舟',
    body: '纸舟是合成的订阅续费任务服务，按订阅标识和账期创建唯一续费任务，调度器从持久化任务表领取到期任务。',
    params: '纸舟每20秒扫描一次到期任务，失败任务最长保留5天。',
    failure: '纸舟把账期唯一键传给支付侧作为幂等标识，状态未知时先查询支付结果，不能立即再次扣款。',
    metrics: '纸舟合成回放中任务准时触发率为98.7%，重复扣款次数为0。',
    verify: '纸舟固定同一批账期事件，注入调度器重启和支付超时，核对任务表与模拟支付流水。',
    limit: '纸舟只使用模拟支付服务，没有真实银行结算成功率或退款时效的结论。',
    seed: '纸舟那个到期自动续费，调度器怎么知道该干哪一笔？',
    oral: [
      '隔多长看一遍，失败的先放多久？',
      '钱扣没扣上都不知道，总不能再扣一遍吧？',
      '最后及时不及时，有没有数字说得上来？',
      '这个零重复，是怎么故意折腾出来验证的？',
      '所以这不是实际银行结算的数据，对吧？',
    ],
  },
  {
    id: 'wangshu',
    name: '望舒',
    body: '望舒是合成的设备固件升级系统，新固件写到未运行的A/B分区，校验摘要和签名后重启试运行。',
    params: '望舒试运行观察期为150秒，连续失败2次后恢复旧分区。',
    failure:
      '望舒在试运行期间要求设备回报健康状态，断电后保留旧分区可启动，未确认健康不能把新分区标记为永久生效。',
    metrics: '望舒合成设备集升级完成率为99.0%，故障回退恢复中位时间为38秒。',
    verify: '望舒在下载、写入和首次启动各阶段注入断电，对比固件摘要及设备最终可启动分区。',
    limit: '望舒测试只覆盖两种合成设备配置，不包含所有厂商引导程序和现场供电条件。',
    seed: '望舒固件升级到一半断电，设备会不会直接变砖？',
    oral: [
      '新版本先看多久，失败几回才退回去？',
      '重启起来但没真跑好，能马上认定升级成功么？',
      '最后成功多少，真坏了多久能回到旧的？',
      '不是挑个顺利的升级看一眼吧，在哪些地方断过电？',
      '测了哪些设备，能说换啥硬件都稳吗？',
    ],
  },
  {
    id: 'chengye',
    name: '澄野',
    body: '澄野是合成的仓库拣货路径服务，把通道表示为带权图，用A星搜索规划路径，临时封闭通道从可通行图中移除。',
    params: '澄野每次最多合并9张拣货单，地图版本保留最近7版。',
    failure:
      '澄野遇到通道封闭后重新规划，不把旧路线当作仍可走的路线，规划失败时保留任务并提示人工安排。',
    metrics: '澄野合成仓库样本中平均行走距离减少17%，规划P95耗时为64毫秒。',
    verify: '澄野在同一订单和地图版本下对比逐单规划与合单规划，加入随机通道封闭并核对路径可达性。',
    limit: '澄野结果只对应二维静态通道图，没有动态人群避让和多机器人碰撞保证。',
    seed: '澄野把几张拣货单凑一起，路线是怎么找的？',
    oral: [
      '一回能凑几张，地图改了旧版还留几份？',
      '走一半发现路封了，原来的路线咋处理？',
      '这么合着走，最后少走了多少，算得快不快？',
      '是不是拿同一堆单子比的，路不通也试过？',
      '仓库里人来人往，这结果也管避开人么？',
    ],
  },
  {
    id: 'yanqing',
    name: '砚青',
    body: '砚青是合成的表格公式服务，公式依赖表示为有向图，修改单元格后只重新计算受影响的后继，工作线程负责计算。',
    params: '砚青把连续编辑合并到35毫秒批次，每批最多重算600个单元格。',
    failure:
      '砚青先检测循环依赖并返回明确错误，工作线程结果带编辑版本号，旧版本计算结果不能覆盖新版本。',
    metrics: '砚青合成大表编辑中主线程P95阻塞为8毫秒，公式结果错误数为0。',
    verify: '砚青用固定编辑序列对比增量计算与全量重算，故意乱序交付工作线程结果并比较最终单元格。',
    limit: '砚青只覆盖内置纯函数，不支持把有外部副作用的自定义函数当作可重复计算公式。',
    seed: '砚青那个大表一改格子，难道每次把整张表都算一遍？',
    oral: [
      '连着敲的时候攒多久再算，一批重算几个？',
      '前一回慢吞吞算完才回来，会不会把新的给盖了？',
      '这回界面堵多久，正确性怎么说的？',
      '增量那份和全量算出来一样，咋对的？',
      '用户塞个会发请求的自定义函数，也能随便重算么？',
    ],
  },
  {
    id: 'yinkui',
    name: '银葵',
    body: '银葵是合成的日志脱敏流水线，按结构字段识别敏感值，在进入落盘与上传队列前替换，并记录脱敏规则版本。',
    params: '银葵单批处理256条日志，规则更新最多延迟12秒生效。',
    failure:
      '银葵无法解析的日志只保留受控错误码，脱敏失败时拒绝上传原文，错误报告也不能夹带被拒绝的内容。',
    metrics: '银葵合成标注日志中敏感字段漏脱敏率为0.2%，处理吞吐为每秒42000条。',
    verify: '银葵固定带标签的合成敏感字段集，比较输出与预期掩码，并注入畸形结构和规则热更新。',
    limit: '银葵没有覆盖任意自然语言里的全部敏感信息，结构字段指标不能推广为所有文本的隐私保证。',
    seed: '银葵脱敏是在上传之前做，还是先发出去再清？',
    oral: [
      '一批跑多少，改了规则要等多久才起作用？',
      '解析都失败了，要不直接把原文发出去排查？',
      '最后漏掉多少、跑多少条一秒，有记录吗？',
      '怎么知道真遮住了，坏格式的也试过没？',
      '所以藏在随便一句话里的隐私，也全都能认出来？',
    ],
  },
  {
    id: 'saffron',
    name: 'Saffron',
    body: 'Saffron是合成的缩略图服务，按原图内容摘要、尺寸和处理版本生成缓存键，输出写入不可变对象后再发布引用。',
    params: 'Saffron默认生成3种尺寸，失败任务最多尝试3次。',
    failure:
      'Saffron在同一缓存键上合并并发生成，失败对象不发布引用，处理版本变化后使用新键而不是覆盖旧引用。',
    metrics: 'Saffron合成图片集缓存命中率为92.4%，首次生成P95延迟为135毫秒。',
    verify: 'Saffron固定原图和尺寸清单，比较冷缓存与暖缓存，重复提交同图并核对输出摘要。',
    limit: 'Saffron只测静态图片，不包含动画多帧、恶意图片解码安全性或任意颜色配置的结论。',
    seed: 'Saffron同一张图让一堆人同时来要缩略图，会不会白算好多遍？',
    oral: [
      '默认出几种大小，失败了还来几回？',
      '老的处理程序生成的，升级以后直接拿来顶着用吗？',
      '最后缓存吃掉多少请求，第一次等多久？',
      '冷热两种情况怎么比的，同图一直来有没有核对？',
      '动图或者乱七八糟的文件，这批测试也都管了？',
    ],
  },
] as const;

type Document = {
  id: string;
  title: string;
  project: boolean;
  roots: readonly string[];
  text: string;
  rootProjects?: readonly string[];
};
export const documents: Document[] = [
  ...topics.map((t) => ({
    id: t.id,
    title: t.title,
    project: false,
    roots: [t.body, t.verify],
    text: `## Q001. ${t.title}的工作方式是什么？\n\n${t.body}\n\n### 追问 1：什么情况下会出问题？\n\n${t.risk}\n\n### 追问 2：工程上应该怎样处理？\n\n${t.fix}\n\n## Q002. ${t.title}如何验证及权衡？\n\n${t.verify}\n\n### 追问 1：哪些结论不能推广？\n\n${t.limit}`,
  })),
  ...projects.map((p, i) => ({
    id: p.id,
    title: p.name + '实施记录',
    project: true,
    roots: [p.body, p.metrics],
    text: `## Q001. ${i % 2 ? '关于' + p.name + '项目的实现方式？' : p.name + '项目怎样运作？'}\n\n${p.body}\n\n### 追问 1：当时的配置是什么？\n\n${p.params}\n\n### 追问 2：不顺利时如何处理？\n\n${p.failure}\n\n## Q002. ${i % 2 ? p.name + '项目的实验结论是什么？' : '请说说' + p.name + '项目的实际结果？'}\n\n${p.metrics}\n\n### 追问 1：验证过程是怎样的？\n\n${p.verify}\n\n### 追问 2：哪些条件尚未验证？\n\n${p.limit}`,
  })),
];
const mixed = [
  {
    id: 'lingchuan',
    a: '绫川北',
    b: '绫川南',
    methodA: '绫川北采用边缘节点本地汇总后按时间戳上传，断网时保留待传队列。',
    methodB: '绫川南采用中心节点主动轮询，不在设备端保留长时队列。',
    paramA: '绫川北每11秒汇总一次，待传队列最多保留26小时。',
    paramB: '绫川南每7秒轮询一次，中心待处理队列上限为350条。',
    failureA: '绫川北重连后按批次编号补传，收端对重复批次去重。',
    failureB: '绫川南轮询超时跳过当前设备并记录缺口，不用前一个读数伪装为新数据。',
  },
  {
    id: 'voyager',
    a: 'Voyager-East',
    b: 'Voyager-West',
    methodA: 'Voyager-East在客户端按块计算内容摘要，服务端校验完成后允许发布文件。',
    methodB: 'Voyager-West由服务端接收完整文件后统一计算摘要，再写入发布记录。',
    paramA: 'Voyager-East块大小为10 MiB，上传凭证有效期为22分钟。',
    paramB: 'Voyager-West完整文件大小上限为700 MiB，上传凭证有效期为13分钟。',
    failureA: 'Voyager-East摘要不符时只要求重传失败块，不得发布未验证文件。',
    failureB: 'Voyager-West摘要不符时删除未发布的临时文件并返回校验错误。',
  },
] as const;
for (const m of mixed)
  documents.push({
    id: m.id,
    title: '多项目对照记录',
    project: true,
    roots: [m.methodA, m.methodB],
    rootProjects: [m.a, m.b],
    text: `## Q001. 请介绍${m.a}项目的处理方式？\n\n${m.methodA}\n\n### 追问 1：相关参数是什么？\n\n${m.paramA}\n\n### 追问 2：异常怎么收尾？\n\n${m.failureA}\n\n## Q002. 在${m.b}项目中怎么做？\n\n${m.methodB}\n\n### 追问 1：相关参数是什么？\n\n${m.paramB}\n\n### 追问 2：异常怎么收尾？\n\n${m.failureB}`,
  });

export const cases: Case[] = [];
const q = (text: string): History => ({ kind: 'question', text });
const target = (documentId: string, root: number, fact: string): Target => ({
  documentId,
  root,
  fact,
});
function add(
  group: string,
  query: string,
  history: History[],
  targets: Target[],
  kind: Case['kind'] = 'answerable',
  names: string[] = [],
) {
  cases.push({
    id: 'transfer-' + String(cases.length + 1).padStart(3, '0'),
    group,
    query,
    history: history.map((v) => ({ ...v })),
    targets,
    kind,
    projects: names,
  });
}
for (const t of topics) {
  add('fresh_technical_seed', t.seed, [], [target(t.id, 1, t.body)]);
  const history: History[] = [q(t.seed), { kind: 'interviewee', text: t.body }];
  [t.body, t.risk, t.fix, t.verify, t.limit].forEach((fact, i) => {
    add('fresh_technical_followup', t.follow[i], history, [target(t.id, i >= 3 ? 2 : 1, fact)]);
    history.push(q(t.follow[i]), { kind: 'interviewee', text: fact });
  });
}
for (const p of projects) {
  add('fresh_project_seed', p.seed, [], [target(p.id, 1, p.body)], 'answerable', [p.id]);
  const history: History[] = [q(p.seed), { kind: 'interviewee', text: p.body }];
  [p.params, p.failure, p.metrics, p.verify, p.limit].forEach((fact, i) => {
    add(
      'fresh_project_followup',
      p.oral[i],
      history,
      [target(p.id, i >= 2 ? 2 : 1, fact)],
      'answerable',
      [p.id],
    );
    history.push(q(p.oral[i]), { kind: 'interviewee', text: fact });
  });
}
for (const m of mixed) {
  add(
    'same_file_projects',
    `先说${m.a}，当时的参数再报一遍呗。`,
    [q(`刚才聊的是${m.b}项目。`)],
    [target(m.id, 1, m.paramA)],
    'answerable',
    [m.a],
  );
  add(
    'same_file_projects',
    '万一中途出岔子，后面怎么接着干？',
    [q(`咱们现在讨论${m.a}项目的实现。`)],
    [target(m.id, 1, m.failureA)],
    'answerable',
    [m.a],
  );
  add(
    'same_file_projects',
    `${m.b}具体怎么做的，你从头捋捋。`,
    [],
    [target(m.id, 2, m.methodB)],
    'answerable',
    [m.b],
  );
  add(
    'same_file_projects',
    `我纠正一下，问的是${m.b}，参数是多少？`,
    [q(`${m.a}项目用了什么参数？`)],
    [target(m.id, 2, m.paramB)],
    'answerable',
    [m.b],
  );
  add(
    'same_file_comparison',
    `${m.a}跟${m.b}的参数分别说一下，别讲混了。`,
    [],
    [target(m.id, 1, m.paramA), target(m.id, 2, m.paramB)],
    'answerable',
    [m.a, m.b],
  );
  add(
    'same_file_projects',
    `再回到${m.a}，最开始这条链路怎么走？`,
    [q(`${m.b}项目刚介绍完。`)],
    [target(m.id, 1, m.methodA)],
    'answerable',
    [m.a],
  );
}
projects.forEach((p, i) => {
  const before = projects[(i + 1) % projects.length];
  add(
    'fresh_switch',
    `先放下${before.name}，${p.name}碰上异常到底怎么收尾？`,
    [q(before.seed)],
    [target(p.id, 1, p.failure)],
    'answerable',
    [p.id],
  );
  add(
    'fresh_switch',
    '嗯，后来结果到底怎么样，有数字就报数字。',
    [q(before.seed), q(p.seed)],
    [target(p.id, 2, p.metrics)],
    'answerable',
    [p.id],
  );
});
['镜岚', '霜砚', '鹿澜', '苍岫', 'Juniper', 'Cobalt', 'Rivermark', 'Silverleaf'].forEach(
  (name, i) =>
    add(
      'unknown_project',
      `${name}项目具体多久跑一批，有没有准确参数？`,
      [q(projects[i % 6].seed)],
      [],
      'ambiguous',
      [name],
    ),
);
const unrelated = [
  '围巾洗完变形了，晾的时候怎么放好点？',
  '手冲咖啡总有点涩，粗细是不是得调一调？',
  '补自行车轮胎，怎么找漏气的那个小口？',
  '围棋刚开始下，先占角还是先冲中间呀？',
  '旧书被雨淋皱了，怎么压平一点？',
  '收拾行李老是装不下，衣服怎么叠省地方？',
  '烤饼外面焦了里面没熟，是火太大了？',
  '鱼缸水看起来浑浑的，过滤棉该洗了吗？',
  '学吹口琴嘴总对不准孔，有什么练法？',
  '毛衣起了很多小球，怎么处理不容易勾坏？',
];
unrelated.forEach((query, i) => {
  add('fresh_unrelated', query, [], [], 'unrelated');
  add(
    'fresh_unrelated_after_topic',
    '岔开说个生活里的事，' + query,
    [q(topics[i % 8].seed), q(topics[i % 8].follow[0])],
    [],
    'unrelated',
  );
});
const ambiguous = [
  '嗯，后面这一步该怎么接呢？',
  '你刚说那套，放大了还能行么？',
  '那几个值我没记住，再报一遍。',
  '真的坏掉以后还会怎么样？',
  '再往深里说点儿呗。',
  '所以刚开始干吗偏要选那种？',
  '这个数字是在哪测出来的？',
  '有更省事儿的招没有？',
  '它到底是快了多少啊？',
  '两边这样弄，结果还会一样不？',
  '那你当时咋证明没丢呢？',
  '照前面那个思路，边界在哪里？',
];
ambiguous.forEach((query) => add('fresh_ambiguous', query, [], [], 'ambiguous'));
for (let i = 0; i < 4; i++) {
  add(
    'fresh_gap',
    ambiguous[i],
    [q(projects[i].seed), { kind: 'gap', text: '合成录入中断' }],
    [],
    'ambiguous',
  );
  add(
    'fresh_ai_only',
    ambiguous[i + 4],
    [{ kind: 'suggestion', text: projects[i].body + projects[i].params }],
    [],
    'ambiguous',
  );
}
[
  '纸舟实际用了哪家银行、哪种商户套餐？',
  '望舒固件那个签名私钥的真实内容给我看看。',
  '澄野项目雇了几个人，一个月工资多少？',
  'Saffron生产服务器是哪家云的什么型号？',
].forEach((query) => add('fresh_missing_fact', query, [], [], 'missing_fact'));
export const expectedCaseCount = 160;
export const expectedDocumentCount = 16;
if (cases.length !== expectedCaseCount || documents.length !== expectedDocumentCount)
  throw Error('Frozen transfer corpus size mismatch');
