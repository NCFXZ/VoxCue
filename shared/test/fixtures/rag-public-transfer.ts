// Authored after v7 source + compiled backend freeze; no imports from previous
// corpora. Public topics are adapted into oral chains and concise reference
// notes, not represented as real interview transcripts. Freeze before scoring.
export const retrievedOn = '2026-10-24';
export const protocol = {
  implementation: 'local-v7-current-source-first',
  thresholds: {
    explicitCoverage: 0.9,
    followupCoverage: 0.8,
    unrelatedInjection: 0.05,
    projectContamination: 0.05,
  },
  scoring:
    'Required fact in injected evidence; all expected comparison sources required. No live answer scoring.',
  freeze:
    'No changes to production, labels or thresholds after observing either public evaluation in this round.',
  limitations:
    'Different public question sources and new reference notes; oral follow-ups are author adaptations, not independently annotated real interviews. CPython GIL questions explicitly assume 3.12.',
};
export const sources = {
  go: 'https://github.com/Devinterview-io/golang-interview-questions',
  python:
    'https://devinterview.io/questions/web-and-mobile-development/python-interview-questions/',
  backend: 'https://github.com/arialdomartini/Back-End-Developer-Interview-Questions',
  design: 'https://github.com/karanpratapsingh/system-design',
  whatsapp: 'https://www.karanpratapsingh.com/courses/system-design/whatsapp',
  uber: 'https://www.karanpratapsingh.com/courses/system-design/uber',
};
type Six = readonly [string, string, string, string, string, string];
type Topic = {
  id: string;
  title: string;
  bank: keyof typeof sources;
  original: string;
  references: string[];
  heads: Six;
  facts: Six;
  oral: Six;
  project?: boolean;
};
export const topics: Topic[] = [
  {
    id: 'goslice',
    title: 'Go切片与底层数组',
    bank: 'go',
    original: 'Arrays versus slices; slice reference semantics',
    references: ['https://go.dev/doc/effective_go#slices'],
    heads: [
      'Go切片赋值复制了哪些东西？',
      '切片元素修改为何影响另一个视图？',
      '切片参数按值传递意味着什么？',
      'append超出容量时怎样处理？',
      'append结果为什么需要接收？',
      '如何得到独立的元素存储？',
    ],
    facts: [
      '切片描述符记录底层数组引用、长度和容量，赋值描述符不会自动复制全部元素。',
      '多个切片引用同一底层数组时，修改共享范围内的元素能被其他视图观察到。',
      '函数接收切片会得到描述符的副本，但通过它修改底层元素仍可影响调用方。',
      'append在原容量不足时分配新的底层数组，并把已有元素复制过去。',
      'append返回可能具有新地址和长度的切片，应使用返回值，不能假定旧描述符自行变化。',
      '要独立元素存储可创建新切片并copy内容，不能只把旧切片再赋给另一个变量。',
    ],
    oral: [
      'Go里数组跟切片先别背区别，我把一个切片赋给另一个，数据也拷一份了吗？',
      '那我改第二份里第一个数，第一份怎么也跟着变了？',
      '传进函数明明说按值传，怎么函数还能把外面的元素改掉？',
      '后面不断往上追加，原来那块塞不下了，会咋办？',
      '所以追加完为啥老让我把返回的那份接住？',
      '我就是不想两边再互相影响，怎么弄成真的两份？',
    ],
  },
  {
    id: 'gonil',
    title: 'Go接口与nil',
    bank: 'go',
    original: 'Interface values, nil and error handling',
    references: ['https://go.dev/doc/faq#nil_error'],
    heads: [
      'Go接口值包含哪两个部分？',
      '空接口值什么情况下等于nil？',
      'nil指针装入接口后为什么不空？',
      'error返回值如何避免typed nil？',
      '判断内部指针为空能替代接口判断吗？',
      '错误返回签名为什么用error？',
    ],
    facts: [
      '接口值可以理解为动态类型与动态值两个部分，接口中保存的具体类型参与其状态。',
      '接口只有动态类型和动态值都未设置时才是nil接口。',
      '把带具体类型的nil指针放入接口后，动态类型仍存在，因此接口本身不等于nil。',
      '函数没有错误时应显式return nil，而不要把一个类型明确的nil错误指针返回到error接口中。',
      '内部指针为空与接口整体为空不是同一个判断，不能用前者推出后者必为nil。',
      '返回error接口可统一表达不同具体错误类型，同时调用方仍需处理nil接口语义。',
    ],
    oral: [
      'Go那个接口你说里头还有类型，到底是两份啥东西？',
      '那它啥都没放的时候，才是真的等于nil，对不？',
      '我放进去的是个空指针啊，咋跟nil比还不相等？',
      '函数其实没错，我想老老实实让外面看出没错，该怎么返回？',
      '我看到里面那根指针是空的，也不能直接认定外面这整个盒子是空？',
      '所以对外返回一般写error，不直接绑死我自己那个错误结构，是吧？',
    ],
  },
  {
    id: 'channel',
    title: 'Go通道关闭',
    bank: 'go',
    original: 'Channels, concurrency and range over channels',
    references: ['https://go.dev/ref/spec#Close', 'https://go.dev/ref/spec#Receive_operators'],
    heads: [
      'Go通道关闭会丢弃已缓冲数据吗？',
      '关闭通道读尽后收到什么？',
      '怎样区分零值和已关闭？',
      '继续向关闭通道发送会怎样？',
      '关闭nil通道有什么结果？',
      'range通道什么时候退出？',
    ],
    facts: [
      '关闭通道不丢弃此前已发送的缓冲值，接收方仍可先取完这些值。',
      '已关闭且缓冲耗尽的通道接收会立即得到元素类型的零值。',
      '双返回接收v,ok中的ok表示是否收到关闭之前成功发送的值，耗尽后为false。',
      '向已经关闭的通道发送会触发运行时panic。',
      '对nil通道调用close也会触发运行时panic，不能把它当作无事发生。',
      'range遍历通道会持续接收，通道关闭且已有值取完后结束。',
    ],
    oral: [
      'Go的channel一关，里头还没领走的东西就全扔了么？',
      '领干净以后我还一直收，会一直堵着，还是拿到点啥？',
      '那如果原来就有人发了个零，我咋跟真的没了区分？',
      '已经关了还往里塞一条呢，安静失败还是直接炸？',
      '连那根通道都是nil，我先关一下试试也没事吧？',
      '用range一直领的那个循环，什么时候才能自己出来？',
    ],
  },
  {
    id: 'pydefault',
    title: 'Python默认参数对象',
    bank: 'python',
    original: 'Functions and mutable object behavior; adapted default-argument follow-up',
    references: ['https://docs.python.org/3/tutorial/controlflow.html#default-argument-values'],
    heads: [
      'Python默认参数在何时求值？',
      '可变默认列表为何跨调用积累？',
      '外部变量后来变化会重算默认值吗？',
      '如何避免复用可变默认对象？',
      '调用方主动传入列表如何处理？',
      '有意保留共享状态时还算默认重建吗？',
    ],
    facts: [
      '默认参数表达式在执行函数定义时求值，不是每次调用函数都重新计算。',
      '默认列表只创建一次，后续省略该参数的调用共享同一个对象，修改会累积。',
      '函数定义后外部变量改变，不会自动重算已经捕获的默认参数值。',
      '可使用None作为默认值，在函数内部检测后为本次调用新建列表。',
      '调用方显式提供列表时应使用所传对象，不能把所有非空与空列表都擅自当成未传。',
      '如果有意使用持久默认对象保存状态，应明确它在多次调用间共享，而不是每次重新初始化。',
    ],
    oral: [
      'Python默认参数是每次进函数才算，还是定义的时候就算过了？',
      '我第二次没传列表，怎么第一次塞的东西还在啊？',
      '定义完以后外面那个变量又改了，默认那份也会自动跟着重算吗？',
      '不想它们互相污染，用None占位以后里头该怎么弄？',
      '别人主动传了个空列表来，我也一律给它换个新的，合适吗？',
      '那如果我就是想跨几次调用留点状态，也得清楚它是共用的那份吧？',
    ],
  },
  {
    id: 'generator',
    title: 'Python生成器暂停',
    bank: 'python',
    original: 'What are generators in Python, and how do you use them?',
    references: ['https://docs.python.org/3/howto/functional.html#generators'],
    heads: [
      '调用Python生成器函数会马上执行函数体吗？',
      'yield与return怎样影响后续执行？',
      '下一次next从哪里继续？',
      '生成器耗尽后怎样报告结束？',
      '生成器的惰性意味着没有状态吗？',
      '一次性迭代完还能从头再来吗？',
    ],
    facts: [
      '调用生成器函数返回生成器对象，函数体通常到首次推进迭代时才开始运行。',
      'yield产出一个值并暂停，后续推进可继续；return则结束该次生成器执行。',
      '生成器保留局部变量和执行位置，下次next从上次yield暂停处继续。',
      '生成器执行结束时通过StopIteration报告耗尽，for循环会处理这个结束信号。',
      '惰性避免预先建立全部结果，但生成器仍会保留完成后续计算所需的局部状态。',
      '生成器迭代器耗尽后不会自动回到起点，需要重新创建实例才能再遍历一次。',
    ],
    oral: [
      'Python生成器函数一调用，里面那些语句就都干完了吗？',
      '碰到yield是跟return一样彻底结束，还是先停在那儿？',
      '下一次再要一个，它还记得刚才干到哪儿了吗？',
      '最后一个都给完了，再伸手要，会告诉我什么？',
      '省内存也不代表它脑子里一点状态都没留，对吧？',
      '我把它整段走完，又想从头看一遍，直接再for一次就行么？',
    ],
  },
  {
    id: 'gil',
    title: 'CPython 3.12全局锁',
    bank: 'python',
    original: 'What is the Global Interpreter Lock (GIL)?',
    references: ['https://docs.python.org/3.12/library/threading.html'],
    heads: [
      'CPython 3.12的GIL约束哪种执行？',
      '多线程纯Python计算能自然多核加速吗？',
      '等待网络时线程仍有价值吗？',
      'CPU并行可采用什么隔离方式？',
      '原生扩展能否释放GIL？',
      '这个结论能概括所有Python版本和实现吗？',
    ],
    facts: [
      '在普通CPython 3.12进程中，GIL使同一时刻通常只有一个线程执行Python字节码。',
      '多个线程做纯Python的CPU密集计算，不能仅靠增加线程就获得相应多核并行。',
      '线程在网络等I/O等待期间仍可提高并发效率，不能把GIL理解成所有等待都必须串行。',
      'CPU密集工作可考虑多进程，让不同解释器进程使用不同CPU核心。',
      '某些原生库在计算期间可释放GIL，因此其并行行为不能只按纯Python循环判断。',
      '这里明确限定普通CPython 3.12，不能推广为所有实现及可选自由线程构建的永久规则。',
    ],
    oral: [
      '咱们先说CPython 3.12，那个GIL到底是拦住了什么？',
      '那我堆十几个线程跑纯Python计算，八个核就都能跑满了？',
      '可业务大部分时间等网络，这种多开线程还是有意义吧？',
      '真想让算东西这部分同时用几个核，你会换成啥方式？',
      '有些原生库好像又能并行，怎么跟你刚才说的不一样？',
      '所以你这结论得带版本和实现前提，不能说全世界Python永远都这样吧？',
    ],
  },
  {
    id: 'identity',
    title: 'Python身份与相等',
    bank: 'python',
    original: 'What is the difference between == and is operator in Python?',
    references: ['https://docs.python.org/3/reference/expressions.html#is-not'],
    heads: [
      'Python的is判断什么关系？',
      '两个内容相同的列表一定是同一对象吗？',
      '等号比较可由类型定制吗？',
      'None哨兵通常用什么方式判断？',
      '小整数缓存可作为一般业务规则吗？',
      '两个变量引用同一列表时修改有何影响？',
    ],
    facts: [
      'is比较对象身份，判断两个引用是否指向同一个对象，而不是比较对象内容。',
      '两个单独创建但内容相同的列表可能相等，却仍然是两个不同对象。',
      '相等比较可受类型的比较方法影响，对象身份比较不会被这种相等逻辑替代。',
      '判断一个引用是否是None哨兵通常使用is None，明确比较那个单例对象。',
      '某些不可变对象被复用属于实现细节，不能依赖偶然的身份相同推导一般相等规则。',
      '两个变量引用同一个可变列表时，通过一个引用修改内容会被另一个引用观察到。',
    ],
    oral: [
      'Python里is跟两个等号，你先说它俩分别在比啥？',
      '两份列表内容一模一样，也可能不是同一个东西吧？',
      '一个类自己写了相等逻辑，能把那个身份判断也改掉吗？',
      '我就想看它是不是None那个哨兵，通常怎么写？',
      '小数字试出来好像都指着同一份，能靠这个写业务吗？',
      '如果两个名字真指着同一份列表，我从这边改，那边也会看到吧？',
    ],
  },
  {
    id: 'pg',
    title: 'PostgreSQL事务快照',
    bank: 'backend',
    original: 'ACID and transaction isolation',
    references: ['https://www.postgresql.org/docs/18/transaction-iso.html'],
    heads: [
      'PostgreSQL读已提交何时建立读取视图？',
      '同事务两次SELECT可能看到不同提交吗？',
      '可重复读固定什么快照？',
      '可重复读并发更新是否总能成功？',
      'Serializable怎样处理不能串行化的执行？',
      '序列化失败时重试哪些内容？',
    ],
    facts: [
      'PostgreSQL默认读已提交中，一条命令看到的是该命令开始前已提交的数据快照。',
      '读已提交的同一事务中，两次SELECT之间其他事务提交后，后一次可能看到新的结果。',
      '可重复读使用事务中首个非事务控制语句所确定的快照，使后续读取保持一致视图。',
      '可重复读事务尝试修改在其快照后已被其他事务更改的行时，可能遭遇并发更新错误。',
      'Serializable会检测可能导致无法串行化的并发关系，并可能中止事务而不是保证所有提交成功。',
      '应用遇到序列化失败应重新执行整个事务及相关决策，不能只把最后一条SQL原地重放。',
    ],
    oral: [
      'PostgreSQL默认读已提交，一次查询开始时到底看哪张快照？',
      '一个事务里我查两遍，中间别人提交了，第二遍也能变吧？',
      '换成可重复读，是从哪条语句开始把那张图定住？',
      '我接着去改别人后来改过的那一行，也一定能顺顺当当改成吗？',
      '最严格那个级别，会替我把所有并发都安排得永远不失败？',
      '真报序列化失败，是只重来最后一条，还是连前面的判断一起再走？',
    ],
  },
  {
    id: 'rabbit',
    title: 'RabbitMQ确认边界',
    bank: 'backend',
    original: 'Message broker and message delivery questions',
    references: ['https://www.rabbitmq.com/docs/confirms'],
    heads: [
      'RabbitMQ消费者确认覆盖哪一段链路？',
      '发布确认能证明业务消费完成吗？',
      '自动确认为什么有丢失处理的风险？',
      '连接关闭后的未确认消息如何处理？',
      '重新投递为何要求业务考虑重复？',
      'prefetch限制的对象是什么？',
    ],
    facts: [
      '消费者ack告诉RabbitMQ该次投递已经处理，可以从未确认状态移除。',
      'Publisher confirm覆盖发布者到broker的接收过程，不证明某个消费者的业务已经成功完成。',
      '自动确认在发送后即视为成功，消费者尚未处理就故障时可能没有重新投递机会。',
      '手工确认模式下连接或通道关闭时，仍未确认的消息会被重新入队以便再次投递。',
      '业务已完成但ack未到达时可能再次投递，因此消费者应考虑幂等或去重。',
      'prefetch限制允许在确认前处于未确认状态的投递数量，用来控制消费者在途压力。',
    ],
    oral: [
      'RabbitMQ的消费者ack，确认的到底是哪一段已经办好了？',
      '发消息那边已经拿到confirm，也不能说对面的业务一定做完了，对吧？',
      '图省事自动确认，万一刚拿到就崩了，会少掉哪层保障？',
      '如果我没手动确认，连接突然断了，那条会怎么安排？',
      '业务其实已经做成功了，只是回执没过去，再来一遍不就重做了？',
      '一次别塞给我太多还没确认的，这个上限是拿啥管的？',
    ],
  },
  {
    id: 'kafka',
    title: 'Kafka分区消费',
    bank: 'design',
    original: 'Message queues, publish-subscribe and partitioned logs',
    references: ['https://kafka.apache.org/41/design/design/'],
    heads: [
      'Kafka的顺序保证范围是什么？',
      '相同业务key为什么通常发往同一分区？',
      '普通消费者组内如何分配分区？',
      '消费者数量超过分区数会怎样？',
      '提前提交offset有哪些后果？',
      '处理后提交offset就绝不重复吗？',
    ],
    facts: [
      'Kafka日志中的消息顺序以分区为范围，不自动提供整个多分区主题的全局顺序。',
      '按稳定key选择分区可以把同一业务实体的数据送到同一分区，便于依次处理。',
      '普通消费者组通过分区分配，让一个分区在同一时刻由组内一个消费者负责。',
      '在普通消费者组中消费者多于分区时，部分消费者可能暂时没有分区可处理。',
      '处理完成前先提交offset，故障恢复后可能跳过尚未完成处理的数据。',
      '处理完成后再提交offset，业务成功而提交前故障时仍可能重放，需要处理重复副作用。',
    ],
    oral: [
      'Kafka说有序，是整个topic都排好了，还是只管里面某一块？',
      '同一个订单老往同一块发，是为了让它那几次变化排得住吧？',
      '普通消费者组里，两个人会不会同时抢同一分区的活？',
      '只有四块，我起十个消费者，是不是有几个就没活可领？',
      '我先把位置报上去，再慢慢干，半路崩了会漏掉啥？',
      '那我干完再报，是不是又有可能成功过的活回来重干？',
    ],
  },
  {
    id: 'idempotent',
    title: 'HTTP幂等与重试',
    bank: 'backend',
    original: 'HTTP methods and API semantics',
    references: ['https://www.rfc-editor.org/rfc/rfc9110.html#name-idempotent-methods'],
    heads: [
      'HTTP幂等讨论的是哪种效果？',
      '重复DELETE的状态码必须相同吗？',
      'PUT通常具有什么幂等语义？',
      '所有POST能随便重试吗？',
      '响应丢失为何让重试产生疑问？',
      '幂等是否禁止记录多次访问日志？',
    ],
    facts: [
      '幂等指多个相同请求对服务器预期产生的效果，与只执行一次相同。',
      '幂等不要求每次响应状态码都相同，重复删除已不存在资源仍可能返回不同响应。',
      'PUT按目标资源替换状态的语义是幂等的，相同表示重复应用应具有相同预期效果。',
      'POST一般不自带幂等保证，自动重试需要已知请求语义或额外的应用层约束。',
      '连接断开丢失响应时，客户端可能不知道服务端是否已经完成操作，这让安全重试依赖幂等语义。',
      '幂等约束预期业务效果，不禁止服务器为每次请求分别记录日志等附带行为。',
    ],
    oral: [
      'HTTP里说幂等，你说的是结果状态一样，还是每次回包都长一样？',
      '删第一次成功，第二次说找不着，也能算它说的幂等吧？',
      'PUT同一份东西过去好几次，正常应该是什么样的效果？',
      '那POST我网络不好就多发两遍，也能一概认定没问题？',
      '服务端其实办完了，只是回包路上没了，客户端为啥就纠结重不重试？',
      '每次都记了条访问日志，所以它就不幂等了，这么说对么？',
    ],
  },
  {
    id: 'deadline',
    title: 'gRPC截止时间',
    bank: 'design',
    original: 'REST, GraphQL, gRPC and service calls',
    references: ['https://grpc.io/docs/guides/deadlines/'],
    heads: [
      'gRPC不设置deadline默认会怎样？',
      '超时后客户端通常看到什么状态？',
      '调用被取消会自动停止自建任务吗？',
      '下游调用如何尊重原始剩余预算？',
      '传递绝对时刻为何有时钟问题？',
      'deadline应该怎样确定？',
    ],
    facts: [
      'gRPC默认不为调用设置截止时间，调用方应显式给出合理预算以避免无限等待。',
      '客户端超过截止时间仍未完成调用时，通常以DEADLINE_EXCEEDED结束。',
      '框架取消RPC后，服务端应用仍负责检查取消并停止自己派生的长时间工作。',
      '下游RPC应继承原始调用尚余的时间预算，而不是每层重新获得完整时长。',
      '实现可把截止时间换成扣除已耗时后的相对超时，降低跨机器时钟偏差的影响。',
      '预算应基于业务要求和实际延迟测量设置，过短会浪费失败重试，过长会占用资源。',
    ],
    oral: [
      'gRPC我不写deadline，它会自己给我一个合适的等待上限吗？',
      '真超过那个点了，客户端通常收到啥状态？',
      '框架说取消了，服务端我自己开的计算也自动全都停了吗？',
      '它下面还得再调别人，总不能每一层都重新领一份完整预算吧？',
      '两台机器表不准，直接把那个绝对时刻扔过去不是会出偏差吗？',
      '那你实际会按什么定这个时间，不是随手拍个数吧？',
    ],
  },
  {
    id: 'pkce',
    title: 'OAuth授权码PKCE',
    bank: 'design',
    original: 'OAuth 2.0 and OpenID Connect; authorization-code follow-ups',
    references: ['https://www.rfc-editor.org/rfc/rfc7636'],
    heads: [
      'PKCE怎样绑定授权请求和换票请求？',
      '首次发出的code_challenge是什么？',
      '换取令牌时提交哪个秘密？',
      'S256怎样校验code_verifier？',
      '只偷到授权码为何仍无法换票？',
      'code_verifier应该长期固定吗？',
    ],
    facts: [
      'PKCE让客户端为一次授权生成随机code_verifier，并把其派生挑战绑定到授权码。',
      '授权请求发送code_challenge和所用变换方法，而不是直接公开code_verifier秘密。',
      '换取令牌时客户端提交原先保存的code_verifier，授权服务器核对它是否匹配。',
      'S256方法把verifier经SHA-256和base64url处理后，与之前记录的challenge比较。',
      '攻击者只有截获的授权码而没有相应verifier时，不能仅凭该码成功兑换令牌。',
      'verifier应为每次授权产生足够随机的秘密，不能把所有授权都绑定同一个固定值。',
    ],
    oral: [
      'OAuth授权码流程加PKCE，前后两次请求是怎么证明同一个人发的？',
      '第一步给服务器的那个challenge，跟秘密本身是一回事吗？',
      '后面真要换票了，才把哪一个拿出来核对？',
      '说用S256，不是拿两串原文直接比吧，具体怎么变一下？',
      '有人只在半路偷走了授权码，为啥还是领不到令牌？',
      '那这个秘密为了省事一直固定用同一个，也没什么影响吧？',
    ],
  },
  {
    id: 'saga',
    title: 'Saga补偿事务',
    bank: 'backend',
    original: 'Difference between a transaction and a compensation operation in a saga',
    references: [
      'https://learn.microsoft.com/en-us/azure/architecture/patterns/compensating-transaction',
    ],
    heads: [
      'Saga补偿是否就是数据库物理回滚？',
      '补偿为何必须考虑后来发生的变化？',
      '工作流应保存什么恢复信息？',
      '补偿步骤自己也失败怎么办？',
      '补偿操作为何需要幂等？',
      '补偿顺序必须等于原步骤完全倒序吗？',
    ],
    facts: [
      '补偿通过新的业务操作撤销先前工作带来的效果，并不等同于数据库把历史状态物理回滚。',
      '补偿期间可能已有其他操作修改相关数据，恢复时需要尊重业务规则而非覆盖掉全部后续变化。',
      '工作流要保留完成过的步骤及恢复所需信息，才能定位失败并执行对应补偿。',
      '补偿过程本身也可能失败，需要记录进度、可恢复地继续执行，必要时告警人工处理。',
      '补偿应尽量设计为幂等，重复尝试不会再制造新的错误副作用。',
      '补偿不必严格按原操作的逆序，也可能按业务依赖调整或并行执行可独立步骤。',
    ],
    oral: [
      'Saga说补偿，跟数据库直接回滚到原来那一刻，是同一招吗？',
      '我处理失败这会儿，别人已经把相关数据又改过了，还能一把覆盖回去？',
      '那之前到底成功到哪儿、以后咋撤，你得留下些什么线索？',
      '撤到一半自己又失败了呢，不能就撒手不管吧？',
      '恢复的时候又跑同一个撤销动作，它最好得具备啥性质？',
      '原来123这么干，撤的时候必须永远321，一步都不能换吗？',
    ],
  },
  {
    id: 'whatsapp',
    title: 'WhatsApp练习方案',
    bank: 'whatsapp',
    original: 'Design a WhatsApp-like instant messaging service',
    project: true,
    references: [sources.whatsapp],
    heads: [
      'WhatsApp项目练习中实时连接怎样保持？',
      'WhatsApp项目的离线消息怎样暂存？',
      'WhatsApp项目为何给会话分配处理服务？',
      'WhatsApp项目媒体正文放在哪里？',
      'WhatsApp项目的已送达与已读是否相同？',
      'WhatsApp项目题设人数是否为真实产品上限？',
    ],
    facts: [
      'WhatsApp公开练习用WebSocket等持久连接支持客户端与聊天服务的实时双向通信。',
      'WhatsApp练习对暂时离线的接收者保留消息，待重新连接后再完成投递。',
      'WhatsApp练习需要维护用户到聊天服务实例的连接映射，以便把消息路由到当前连接所在位置。',
      'WhatsApp练习把图片视频等媒体文件放在对象存储，消息记录保存相关引用。',
      'WhatsApp练习把发送、送达和已读视作不同回执，客户端收到消息不等于用户已经阅读。',
      '题设群聊人数和流量是WhatsApp这道公开练习的范围假设，不能当成实际产品的当前限制。',
    ],
    oral: [
      '公开的WhatsApp设计练习，想让两边实时说话，会一直用什么连接？',
      '对方现在不在线，这条就丢了，还是先找地方留一下？',
      '起了好多台聊天服务，我咋知道那个人现在连在哪台？',
      '发个大视频，也跟那几行聊天文字原封不动塞一张表里？',
      '对面设备已经收到了，就能直接给我标成他看过了？',
      '练习里写群最多一百人，你敢拿这个当真实产品现在的上限吗？',
    ],
  },
  {
    id: 'uber',
    title: 'Uber练习方案',
    bank: 'uber',
    original: 'Design an Uber-like ride-hailing service',
    project: true,
    references: [sources.uber],
    heads: [
      'Uber项目练习中司机位置怎样进入系统？',
      'Uber项目如何查找附近司机？',
      'Uber项目的匹配是否只有最近距离？',
      'Uber项目的行程记录保存什么？',
      'Uber项目的支付为什么是独立环节？',
      'Uber项目题设规模代表真实线上吗？',
    ],
    facts: [
      'Uber公开练习让司机客户端持续发送位置更新，由位置服务维护可用于查询的空间状态。',
      'Uber练习通过空间索引和区域划分查询附近候选司机，避免每次扫描全部司机。',
      'Uber练习的匹配服务还需考虑司机状态、车型和请求等约束，而非只比较一个直线距离。',
      'Uber练习的行程数据记录乘客、司机、起终点及行程状态，以追踪一次出行的生命周期。',
      'Uber练习把支付交给专门服务处理结算，不把位置更新直接等同于已经完成扣款。',
      'Uber练习中的日活和请求量用于容量估算，是题目假设而不是当前真实公司的线上统计。',
    ],
    oral: [
      '设计Uber那道公开题，车的位置不停变，系统怎么知道司机现在在哪儿？',
      '每次有人叫车，都把全城司机拉出来挨个算一遍距离吗？',
      '最近那个就必须配给他？车型或者司机正忙着这些也得管吧？',
      '真的成了一单，你得把哪些关系跟状态串成一条行程记录？',
      '位置都发回来了，就等于这趟钱已经扣好了？',
      '题上写一亿日活，这是拿来估容量的，不是你查到人家公司今天的数据吧？',
    ],
  },
];
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
  chain?: string;
  turn?: number;
  sourceUrls: string[];
};
export const documents = topics.map((t) => ({
  id: t.id,
  title: t.title,
  project: !!t.project,
  roots: [t.facts[0], t.facts[3]],
  text: `## ${t.heads[0]}\n\n${t.facts[0]}\n\n### ${t.heads[1]}\n\n${t.facts[1]}\n\n### ${t.heads[2]}\n\n${t.facts[2]}\n\n## ${t.heads[3]}\n\n${t.facts[3]}\n\n### ${t.heads[4]}\n\n${t.facts[4]}\n\n### ${t.heads[5]}\n\n${t.facts[5]}`,
}));
export const cases: Case[] = [];
const q = (text: string): History => ({ kind: 'question', text });
const target = (t: Topic, i: number): Target => ({
  documentId: t.id,
  root: i < 3 ? 1 : 2,
  fact: t.facts[i],
});
function add(c: Omit<Case, 'id'>) {
  cases.push({
    id: 'external-' + String(cases.length + 1).padStart(3, '0'),
    ...c,
    history: c.history.map((v) => ({ ...v })),
  });
}
for (const t of topics) {
  const history: History[] = [];
  for (let i = 0; i < 6; i++) {
    add({
      group: i === 0 ? 'public_explicit' : i < 3 ? 'public_followup_early' : 'public_followup_late',
      query: t.oral[i],
      history,
      targets: [target(t, i)],
      kind: 'answerable',
      projects: t.project ? [t.id] : [],
      chain: t.id,
      turn: i + 1,
      sourceUrls: [sources[t.bank], ...t.references],
    });
    history.push(q(t.oral[i]), { kind: 'interviewee', text: t.facts[i] });
  }
}
topics.forEach((t, i) =>
  add({
    group: 'public_topic_switch',
    query: `前面那部分到这里，我另起一题：${t.title}。${t.oral[3]}`,
    history: [q(topics[(i + 5) % 16].oral[0]), q(topics[(i + 5) % 16].oral[1])],
    targets: [target(t, 3)],
    kind: 'answerable',
    projects: t.project ? [t.id] : [],
    sourceUrls: [sources[t.bank], ...t.references],
  }),
);
const comparisons: [number, number, string, number, number][] = [
  [0, 3, 'Go切片相互看到修改，跟Python可变默认列表跨调用积累，各自为什么会共用存储？', 1, 1],
  [1, 6, 'Go接口里放nil指针还不为空，Python的is又在比什么，两个问题分别解释一下。', 2, 0],
  [
    8,
    9,
    'RabbitMQ业务办成但ack没到，Kafka处理完但offset没提交，这两种恢复以后分别会不会重来？',
    4,
    5,
  ],
  [
    7,
    13,
    'PostgreSQL序列化失败要怎么重试，Saga已经做完的业务又怎么补偿？别把两种恢复混起来。',
    5,
    0,
  ],
  [
    11,
    10,
    'gRPC等待时间到了就不等了，HTTP那个请求响应丢了能不能重发，是两个不同问题吧，各说下依据。',
    1,
    4,
  ],
  [2, 5, 'Go关掉通道以后还能读到缓冲吗，CPython 3.12多开线程算字节码又是不是就能多核？', 0, 1],
  [14, 15, 'WhatsApp项目的媒体放哪，Uber项目的行程记录又存什么，分别讲。', 3, 3],
  [14, 15, 'WhatsApp收到了能算读过吗，Uber更新位置能算付过款吗？这两个边界别混了。', 4, 4],
];
for (const [a, b, query, fa, fb] of comparisons) {
  const x = topics[a],
    y = topics[b];
  add({
    group: 'public_comparison',
    query,
    history: [q(x.oral[0])],
    targets: [target(x, fa), target(y, fb)],
    kind: 'answerable',
    projects: [x, y].filter((t) => t.project).map((t) => t.id),
    sourceUrls: [sources[x.bank], sources[y.bank], ...x.references, ...y.references],
  });
}
const unrelated = [
  '床单洗完静电特别多，晾的时候能注意点啥？',
  '打羽毛球老打到拍框，是站得太近了？',
  '新杯子一倒热水就有味道，怎么洗比较合适？',
  '切洋葱眼睛受不了，有啥少流泪的办法？',
  '拍月亮总是一团亮点，曝光该怎么往回调？',
  '拼图剩最后一片找不着，是不是掉沙发底下了？',
  '吉他换了弦以后老跑音，得再调几次么？',
  '皮鞋鞋带总松，换个结会不会好点？',
  '蒸包子一掀盖就塌，是不是开盖太快？',
  '养的绿萝往一边长，要转转花盆吗？',
];
unrelated.forEach((query, i) => {
  for (const prior of [false, true])
    add({
      group: prior ? 'public_unrelated_after_topic' : 'public_unrelated',
      query,
      history: prior ? [q(topics[i].oral[0]), q(topics[i].oral[1])] : [],
      targets: [],
      kind: 'unrelated',
      projects: [],
      sourceUrls: [],
    });
});
const vague = [
  '刚那个过程你再顺一下行不？',
  '后头这块怎么又变了呢？',
  '照你前面那种，还有哪里得小心？',
  '当时选这个主要考虑什么呀？',
  '那个量到底是大了还是小了？',
  '换成另一套也会有一样的问题？',
  '真遇到它停了，你会先看哪里？',
  '刚说的两步是不是顺序不能反过来？',
];
vague.forEach((query) =>
  add({
    group: 'public_no_topic',
    query,
    history: [],
    targets: [],
    kind: 'ambiguous',
    projects: [],
    sourceUrls: [],
  }),
);
for (let i = 0; i < 4; i++) {
  add({
    group: 'public_gap',
    query: vague[i],
    history: [q(topics[14 + (i % 2)].oral[0]), { kind: 'gap', text: '合成转写暂停' }],
    targets: [],
    kind: 'ambiguous',
    projects: [],
    sourceUrls: [],
  });
  add({
    group: 'public_ai_only',
    query: vague[i + 4],
    history: [{ kind: 'suggestion', text: topics[14 + (i % 2)].facts.join('') }],
    targets: [],
    kind: 'ambiguous',
    projects: [],
    sourceUrls: [],
  });
}
['Instagram', 'TikTok', 'Dropbox', 'Trello', 'GitHub', 'Slack', 'Zoom', 'Airbnb'].forEach(
  (name, i) =>
    add({
      group: 'public_absent_project',
      query: `不是${topics[14 + (i % 2)].title}，我改问${name}项目，里面那条处理链路怎么走？`,
      history: [q(topics[14 + (i % 2)].oral[0]), q(topics[14 + (i % 2)].oral[1])],
      targets: [],
      kind: 'ambiguous',
      projects: [name],
      sourceUrls: [],
    }),
);
[
  'Go那次线上切片扩容具体多分了多少内存？',
  '你们生产的那个error里真实用户编号是什么？',
  'Python那个生成器在你们服务器上实际峰值内存多大？',
  'PostgreSQL上次序列化失败的真实订单号是什么？',
  'RabbitMQ生产账户密码具体是哪一串？',
  'Kafka这个业务现在线上的分区实际有几个？',
  'WhatsApp真实线上群聊人数上限今天是多少？',
  'Uber当前生产每秒真实位置更新量是多少？',
].forEach((query) =>
  add({
    group: 'public_missing_fact',
    query,
    history: [],
    targets: [],
    kind: 'missing_fact',
    projects: [],
    sourceUrls: [],
  }),
);
export const expectedCaseCount = 172;
export const expectedDocumentCount = 16;
if (cases.length !== expectedCaseCount || documents.length !== expectedDocumentCount)
  throw Error('Public transfer size mismatch');
