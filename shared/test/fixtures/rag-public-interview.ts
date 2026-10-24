// Public-source evaluation, authored after the production implementation freeze.
// Oral follow-ups and Chinese reference notes are adaptations, not recorded real
// interviews or verbatim copies. Never tune production against this collection.
export const retrievedOn = '2026-10-24';
export const protocol = {
  implementation: 'local-v6-grounded-thread',
  thresholds: {
    explicitCoverage: 0.9,
    followupCoverage: 0.8,
    unrelatedInjection: 0.05,
    projectContamination: 0.05,
  },
  scoring:
    'Required fact in injected evidence, not merely candidate/root recall; no live answer scoring.',
  freeze:
    'Freeze questions, facts and thresholds before first retrieval; no production changes after observing results.',
  limitations:
    'Public question topics with author-adapted oral chains and concise public reference notes; not independently labelled live interview transcripts or a full-document ingestion benchmark.',
} as const;
export const sources = {
  java2:
    'https://github.com/Snailclimb/JavaGuide/blob/main/docs/java/concurrent/java-concurrent-questions-02.md',
  java3:
    'https://github.com/Snailclimb/JavaGuide/blob/main/docs/java/concurrent/java-concurrent-questions-03.md',
  mysql:
    'https://github.com/Snailclimb/JavaGuide/blob/main/docs/database/mysql/mysql-questions-01.md',
  redis:
    'https://github.com/Snailclimb/JavaGuide/blob/main/docs/database/redis/redis-questions-01.md',
  js: 'https://github.com/h5bp/Front-end-Developer-Interview-Questions/blob/main/src/questions/javascript-questions.md',
  css: 'https://github.com/h5bp/Front-end-Developer-Interview-Questions/blob/main/src/questions/css-questions.md',
  network:
    'https://github.com/h5bp/Front-end-Developer-Interview-Questions/blob/main/src/questions/network-questions.md',
  design: 'https://github.com/donnemartin/system-design-primer/blob/master/README.md',
  pastebin:
    'https://github.com/donnemartin/system-design-primer/blob/master/solutions/system_design/pastebin/README.md',
  twitter:
    'https://github.com/donnemartin/system-design-primer/blob/master/solutions/system_design/twitter/README.md',
} as const;
type Six = readonly [string, string, string, string, string, string];
type Topic = {
  id: string;
  title: string;
  bank: keyof typeof sources;
  original: string;
  references: string[];
  headings: Six;
  facts: Six;
  oral: Six;
  project?: boolean;
};
export const topics: Topic[] = [
  {
    id: 'reentrant',
    title: 'ReentrantLock显式锁',
    bank: 'java2',
    original: 'synchronized 与 ReentrantLock 的区别及锁公平性',
    references: [
      'https://docs.oracle.com/javase/8/docs/api/java/util/concurrent/locks/ReentrantLock.html',
    ],
    headings: [
      'ReentrantLock和内置监视器有哪些使用差异？',
      '同一线程能再次获取ReentrantLock吗？',
      '显式锁在哪个位置释放？',
      'ReentrantLock等待时如何中断或超时？',
      '公平锁的吞吐量有什么代价？',
      '无参tryLock遵循公平顺序吗？',
    ],
    facts: [
      'ReentrantLock由代码显式获取和释放，而synchronized代码块退出时由运行时释放监视器。',
      '重入允许持有锁的同一线程再次获取，持有计数随获取和释放增减。',
      '应在成功获取锁后用try/finally确保unlock执行，避免异常路径遗留锁。',
      'lockInterruptibly支持响应中断，带时限的tryLock允许等待一段时间后放弃。',
      '公平策略偏向等待较久的线程，但可能降低吞吐量，也不保证线程调度公平。',
      '不带超时的tryLock即使面对公平锁也可以立即抢到空闲锁，不严格排队。',
    ],
    oral: [
      'ReentrantLock跟直接写synchronized，平时你到底怎么选啊？',
      '同一个线程里头又调到一次，自己会不会把自己锁死？',
      '中间业务抛异常了，后面的人是不是就永远拿不到了？',
      '拿不到的时候我不想干等，想取消或者等两秒就走，怎么弄？',
      '那让大家排得公平一点，是不是就一定更快、更好？',
      '你说它公平，那个不带时间的尝试获取，也老老实实排队么？',
    ],
  },
  {
    id: 'volatile',
    title: 'volatile内存可见性',
    bank: 'java2',
    original: 'volatile 的可见性、有序性和原子性',
    references: ['https://docs.oracle.com/javase/tutorial/essential/concurrency/atomic.html'],
    headings: [
      'volatile对线程间发布有什么作用？',
      '写入标志前的普通字段能被看见吗？',
      '可见性等于复合操作互斥吗？',
      'volatile计数器为什么仍会丢失更新？',
      '原子计数应选择什么机制？',
      '多个变量之间的不变量如何维护？',
    ],
    facts: [
      '对同一volatile变量的写与后续读取建立happens-before关系，用于在线程间发布状态。',
      '读者通过volatile标志观察到发布时，也能看到写该标志之前的普通字段修改。',
      'volatile变量的可见性不能让一组读取、计算、写回动作自动成为互斥操作。',
      '自增包含读取旧值、加一、写回，两个线程可能基于同一个旧值覆盖彼此的更新。',
      '单个计数器可以使用AtomicInteger等原子操作，或通过同一把锁保护自增。',
      '跨多个字段维护一致约束时需要共同的同步协议，给每个字段加volatile并不能替代它。',
    ],
    oral: [
      'volatile是不是加上了，多个线程就不会互相看漏数据了？',
      '先改别的字段，最后把那个开关打开，对面看到开关了就能用前面的值？',
      '那既然都看得见，我同时读一下再改一下也就安全了吧？',
      '十个人一起加一，最后咋还是少了，具体少在哪一步？',
      '就一个数字往上加，你会用啥把它弄对？',
      '要同时管库存跟金额两个值呢，分别加上那个修饰就够了么？',
    ],
  },
  {
    id: 'threadlocal',
    title: 'ThreadLocal线程状态',
    bank: 'java3',
    original: 'ThreadLocal 用途、线程池复用和清理',
    references: [
      'https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/lang/ThreadLocal.html',
    ],
    headings: [
      'ThreadLocal如何隔离线程中的状态？',
      '另一个线程get能读取本线程的set吗？',
      '线程本地值何时初始化？',
      '线程池复用为什么要清理ThreadLocal？',
      '业务异常时如何保证remove？',
      'remove之后再次get会发生什么？',
    ],
    facts: [
      'ThreadLocal让访问同一个实例的各线程拥有独立初始化的线程本地值。',
      '普通ThreadLocal不会因为任务切换到另一个工作线程就自动传递当前线程的值。',
      '首次get且当前线程尚无值时调用initialValue，set可以直接提供该线程的值。',
      '工作线程长期复用时，本次任务遗留的本地值可能被下一次任务继续读到。',
      '任务使用结束后应在finally中调用remove，异常结束也要清理当前线程的值。',
      'remove删除当前线程的条目，再次get而没有set时会重新初始化。',
    ],
    oral: [
      'ThreadLocal是咋做到每个线程拿自己的那份东西的？',
      '我扔到另一个线程干活，还能直接拿到刚才放进去的用户吗？',
      '一开始压根没放过，直接取的话，那个值从哪来？',
      '线程池里跑完一个请求没擦干净，下一个人会不会读到上一个人的？',
      '半路报错也要擦，那清理得写在哪儿比较稳？',
      '擦掉以后我又取一次，它是一直空着，还是会再弄一份？',
    ],
  },
  {
    id: 'pool',
    title: 'ThreadPoolExecutor任务接收',
    bank: 'java3',
    original: '线程池参数、排队流程与拒绝策略',
    references: [
      'https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/util/concurrent/ThreadPoolExecutor.html',
    ],
    headings: [
      'ThreadPoolExecutor先创建线程还是入队？',
      '核心线程繁忙后先走哪个分支？',
      '队列满和最大线程数的关系？',
      '无界队列为何让maximumPoolSize不起作用？',
      'CallerRunsPolicy怎样反馈压力？',
      'AbortPolicy如何报告拒绝？',
    ],
    facts: [
      '工作线程少于corePoolSize时，提交任务会优先创建线程执行。',
      '达到核心线程数后优先尝试把任务放进工作队列，不会立即扩到最大线程数。',
      '任务无法入队时才尝试在maximumPoolSize以内新增线程，再无法接收就执行拒绝策略。',
      '无界队列能够持续接收任务，通常不会触发超出核心数量的扩容，最大线程数因而不起作用。',
      'CallerRunsPolicy在未关闭时由提交任务的线程直接运行任务，从而减慢继续提交的速度。',
      '默认AbortPolicy在拒绝任务时抛出RejectedExecutionException，让调用方感知失败。',
    ],
    oral: [
      'Java线程池来了个活，先找人干还是先往队里放？',
      '最开始那几个人都忙着呢，会立刻再招到最大人数么？',
      '队也挤满了，再来一个到底走哪一步？',
      '我把最大值调得老大，可就是不增人，是不是队列选得不对？',
      '忙不过来让交活的人自己干，这是怎么把压力压回去的？',
      '我不想悄悄丢活，默认那种处理会怎么告诉我？',
    ],
  },
  {
    id: 'composite',
    title: 'MySQL联合索引',
    bank: 'mysql',
    original: '联合索引最左前缀与查询优化',
    references: ['https://dev.mysql.com/doc/refman/8.4/en/multiple-column-indexes.html'],
    headings: [
      'MySQL多列索引的最左前缀是什么？',
      '只有第二列条件能按此前缀定位吗？',
      'SQL条件书写顺序决定索引列顺序吗？',
      'MySQL索引被优化器使用是必然的吗？',
      '多个独立索引等于一个联合索引吗？',
      '联合索引还要付出什么成本？',
    ],
    facts: [
      '索引(a,b,c)按列的组合值组织，可利用的最左前缀包括a、a和b、以及a和b和c。',
      '只有b条件不构成(a,b,c)的最左前缀，不能据此声称一定能用此前缀直接定位。',
      'WHERE中等值条件书写先后不改变已建索引的物理列顺序，不能仅靠交换SQL条件顺序修复索引设计。',
      '优化器基于成本选择访问路径，有可用索引不等于所有查询都会选择它。',
      '多个单列索引可能使用Index Merge，不能直接视作与一个多列索引完全相同。',
      '索引占用空间，插入更新删除也需要维护索引，不能为每种列组合都无代价建索引。',
    ],
    oral: [
      'MySQL那个联合索引，最左边开始用到底是啥意思？',
      '我只拿中间那一列来查，也能直接按你刚才那个顺序定位么？',
      '那我把where里面两个条件前后换一下，问题就解决了？',
      '建了以后就一定会选它吗，还是数据库自己也会算账？',
      '每一列各建一个，跟你说的把几列放一起，是一回事不？',
      '既然好用，干脆各种组合全建上，不就完了？',
    ],
  },
  {
    id: 'mvcc',
    title: 'InnoDB一致性读取',
    bank: 'mysql',
    original: 'MVCC 与事务隔离级别',
    references: [
      'https://dev.mysql.com/doc/refman/8.4/en/innodb-consistent-read.html',
      'https://dev.mysql.com/doc/refman/8.4/en/innodb-multi-versioning.html',
    ],
    headings: [
      'InnoDB可重复读的快照何时形成？',
      '读已提交何时产生新快照？',
      '一致性SELECT是否阻塞其他事务改行？',
      'InnoDB如何构造旧行版本？',
      '长时间快照为何阻碍清理？',
      '普通SELECT的快照是否支配全部DML？',
    ],
    facts: [
      'REPEATABLE READ事务中的一致性读取通常复用第一次此类读取所建立的快照。',
      'READ COMMITTED下每次一致性读取都创建并使用新的快照。',
      '一致性非锁定读取不会因为读取快照而给所读行加锁，其他会话仍可以并发修改。',
      'InnoDB借助undo记录重建旧版本，以满足一致性读取所需的历史状态。',
      '仍可能被活跃快照需要的update undo不能立即清理，长事务可能让历史版本持续积累。',
      '一致性SELECT的快照规则不能直接套给所有UPDATE和DELETE，后者可能影响快照中看不到的新提交行。',
    ],
    oral: [
      'InnoDB可重复读，说两次能读到一样的，是从事务一开始就拍照了么？',
      '换成读已提交以后，同一事务里再读一遍，照片还用原来那张？',
      '我一直看旧的，别人改那一行就得等着我吗？',
      '旧的内容都覆盖了，还从哪儿给我找回来？',
      '那我开着事务半天不关，后台是不是也有东西不敢扔？',
      '普通查是这么一套，更新删除也肯定只动我照片里看见的行？',
    ],
  },
  {
    id: 'persistence',
    title: 'Redis持久化',
    bank: 'redis',
    original: 'Redis RDB 与 AOF 的差异',
    references: ['https://redis.io/docs/latest/operate/oss_and_stack/management/persistence/'],
    headings: [
      'Redis的RDB保存了什么？',
      '两次RDB之间崩溃会怎样？',
      'AOF记录的对象是什么？',
      'AOF每秒fsync意味着零丢失吗？',
      'AOF重写是否简单复制旧文件？',
      'RDB与AOF同时启用时怎样恢复？',
    ],
    facts: [
      'RDB在某个时间点把内存数据生成紧凑快照，适合备份和较快恢复。',
      '只依赖RDB时，进程故障可能丢失最近一次成功快照之后的写入。',
      'AOF追加记录导致数据变化的写命令，恢复时通过重放重建状态。',
      '每秒fsync在性能和持久性间折中，灾难情况下仍可能丢失约一秒写入。',
      'AOF重写根据当前数据生成更精简的恢复表示，减少旧命令累积造成的体积。',
      '同时启用两种持久化时，Redis重启通常优先使用更完整的AOF数据恢复。',
    ],
    oral: [
      'Redis落盘，RDB那一份到底存的是啥？',
      '刚存完没多久机器挂了，后面刚写进去的还在不在？',
      '另一种一直往后追加的，是记最终结果，还是记做过哪些修改？',
      '每秒刷一次，是不是就敢保证一条也不丢了？',
      '文件越来越大，所谓重写就是换个地方照抄一遍吗？',
      '我两种都开着，重新起来先认哪一份啊？',
    ],
  },
  {
    id: 'eviction',
    title: 'Redis内存淘汰',
    bank: 'redis',
    original: 'Redis 内存淘汰策略与过期',
    references: ['https://redis.io/docs/latest/develop/reference/eviction/'],
    headings: [
      'Redis触及maxmemory后如何决策？',
      'LRU与LFU依据什么选择键？',
      'LRU候选是否通过全局精确排序产生？',
      'noeviction时读写分别如何表现？',
      'volatile淘汰策略没有TTL键会怎样？',
      '内存预算为何要给持久化复制留余量？',
    ],
    facts: [
      '达到maxmemory限制后，Redis根据配置的淘汰策略决定删除候选键或拒绝需要更多内存的写入。',
      'LRU偏向移除较久未用的键，LFU偏向移除使用频率低的键。',
      'Redis的LRU使用采样形成近似结果，并不是维护所有键的严格全局访问顺序。',
      'noeviction不会为腾空间删除键，需要分配内存的写命令可能报错，但已有数据的读取仍可继续。',
      'volatile类策略只从有过期时间的键里选择，没有这类键时会表现得类似noeviction。',
      '复制和持久化的部分缓冲区不计入触发淘汰的内存量，设置上限时要给这些开销留下余量。',
    ],
    oral: [
      'Redis内存顶满了，它会先删点东西，还是直接不让写？',
      '最近用过跟用得次数多，是两套不同的选法吧？',
      '它真要把所有键按使用时间排个大队再挑？',
      '如果我选不删的那种，读也跟着全都报错么？',
      '只从有过期时间的里面挑，可我一个过期时间都没设呢？',
      '那我把上限定成机器全部内存，旁边那些缓冲不占地儿吗？',
    ],
  },
  {
    id: 'aside',
    title: 'Cache-Aside旁路缓存',
    bank: 'design',
    original: 'Cache-aside 的读取、更新与一致性取舍',
    references: ['https://learn.microsoft.com/en-us/azure/architecture/patterns/cache-aside'],
    headings: [
      'Cache-Aside未命中后由谁装载数据？',
      '数据库修改后怎么处理缓存副本？',
      'Cache-Aside能否保证严格一致？',
      '缓存存活时间怎么权衡？',
      '多实例本地缓存有什么额外差异？',
      '什么场景不适合旁路缓存？',
    ],
    facts: [
      'Cache-Aside由应用先读缓存，未命中时访问原始数据存储，再把结果填入缓存。',
      '修改原始数据后需要使缓存对应条目失效，后续读取再重新装载。',
      'Cache-Aside本身不保证数据存储与缓存严格一致，外部修改和并发都可能留下旧副本。',
      '过短存活时间会反复从数据源装载，过长则增加读到过时内容的机会。',
      '各应用实例单独使用本地缓存时，副本之间可能不同步，要考虑共享缓存或相应一致性措施。',
      '缓存命中率低或数据变化频繁时，旁路缓存的装载和维护成本可能不值得。',
    ],
    oral: [
      'Cache-Aside是业务自己管缓存那种吧，没找到接下来谁去查库？',
      '数据改完了，那份旧的你会怎么处理？',
      '按你这个做，就能保证任何时候都不读到旧值了？',
      '有效期设特别短就绝对好，还是也得付点代价？',
      '起了好几个实例，每个肚子里都留一份，它们会自动一样吗？',
      '那有没有那种场景，干脆别用这招更省心？',
    ],
  },
  {
    id: 'httpcache',
    title: 'HTTP缓存验证',
    bank: 'network',
    original: 'Cache-Control、ETag 与条件请求',
    references: ['https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Caching'],
    headings: [
      'HTTP强缓存的新鲜度由什么控制？',
      'ETag怎样配合条件请求？',
      '304响应代表重新传输完整实体吗？',
      'no-cache能否保存响应？',
      'no-store与旧缓存删除有什么区别？',
      '个性化响应如何限制共享缓存？',
    ],
    facts: [
      'Cache-Control的max-age描述响应的新鲜时长，新鲜副本通常可以直接复用而不访问源站。',
      '客户端可把ETag放入If-None-Match验证请求，服务端据此判断所持版本是否仍有效。',
      '资源未改变时可以返回304让客户端复用已有实体，无需再次传送完整响应体。',
      'no-cache允许存储响应，但再次复用前要求向服务端验证。',
      'no-store要求不存储这次响应，并不负责删除同一地址过去已经存下的副本。',
      'private限定响应只由私有缓存存储，避免个性化内容进入共享缓存。',
    ],
    oral: [
      'HTTP强缓存那个时间没过，是不是压根就不问服务器了？',
      '过了以后总不能每次整份重下吧，那个版本标记咋拿来问？',
      '对面回个304，文件内容又是从哪儿来的？',
      '名字叫no-cache，我就理解成一点都不许存，没毛病吧？',
      '换成不准保存那种，以前存的也会顺便给我删干净？',
      '这是用户自己的页面，不能让公共那份给别人看，该加哪种限制？',
    ],
  },
  {
    id: 'closure',
    title: 'JavaScript闭包',
    bank: 'js',
    original: '闭包定义、用途与循环变量捕获',
    references: ['https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Closures'],
    headings: [
      'JavaScript闭包保留的是什么环境？',
      '外层调用结束后变量为何还能访问？',
      '多个回调捕获同一个绑定会怎样？',
      'var循环创建回调为何常取到末值？',
      'let循环绑定如何避免共用？',
      '函数工厂怎样为每次调用隔离状态？',
    ],
    facts: [
      '闭包由函数及其创建时可访问的词法环境组成，使函数之后仍能访问外层绑定。',
      '只要闭包仍可达并需要该环境，外层函数返回不意味着相关绑定立刻消失。',
      '多个函数若共享同一个词法环境，会观察到同一个可变绑定的后续变化。',
      'var循环中的多个回调通常共享函数作用域的循环变量，执行时会读取循环结束后的值。',
      'let在循环迭代中提供各次迭代的绑定，让回调保留对应迭代的值。',
      '函数工厂每次调用都创建新的词法环境，可以得到互不干扰的独立计数状态。',
    ],
    oral: [
      'JavaScript闭包你别背定义，外层都跑完了，为啥里头还拿得到那个变量？',
      '所以函数返回了，也不代表那份东西马上就消失，对吧？',
      '我造了俩函数，都改同一个外面的数，它们会各记各的吗？',
      'for里用var绑几个回调，怎么点哪个都出来最后那个数？',
      '换成let就好了，它每一轮到底变了啥？',
      '要做两个互不干扰的小计数器，用那个返回函数的办法怎么隔开？',
    ],
  },
  {
    id: 'eventloop',
    title: 'JavaScript事件循环',
    bank: 'js',
    original: '事件循环、调用栈与任务队列',
    references: [
      'https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Execution_model',
    ],
    headings: [
      'JavaScript任务的run-to-completion是什么？',
      'Promise回调与定时器回调谁先被调度？',
      '微任务处理是否每次只取一个？',
      '不断追加微任务会产生什么后果？',
      '定时器零延迟等于立即执行吗？',
      '避免长计算阻塞有什么方向？',
    ],
    facts: [
      '一个任务运行时先把当前调用栈执行完，其他排队任务不会在任意语句中途插入执行。',
      '同一轮同步代码之后，Promise等微任务通常先于下一项定时器任务处理。',
      '微任务检查点会继续清空队列，期间新增的微任务也可能在进入下一个任务前运行。',
      '不断产生微任务可能让普通任务长期得不到执行，影响界面的响应。',
      '定时器延迟不是立即执行保证，回调仍要等待当前工作结束及其任务被调度。',
      '缩短单次同步工作、拆分任务或把合适计算放到独立Worker，可以降低主线程阻塞。',
    ],
    oral: [
      'JavaScript事件循环里，一段同步代码没完，会被另一个回调突然插进来吗？',
      'Promise跟setTimeout都等着，先轮到哪一个啊？',
      '那个小队列处理一个就换别的吗，还是得先一直处理完？',
      '它自己又往里塞新的，一直塞，会不会把外面的事饿死？',
      '那我延迟写零，也不能保证立刻就跑到，对吧？',
      '页面被一大段计算卡死，你会往哪几个方向拆？',
    ],
  },
  {
    id: 'delegation',
    title: 'DOM事件委托',
    bank: 'js',
    original: '事件委托、冒泡与target/currentTarget',
    references: [
      'https://developer.mozilla.org/en-US/docs/Learn_web_development/Core/Scripting/Event_bubbling',
    ],
    headings: [
      '事件委托为什么可以在父节点监听？',
      'target和currentTarget分别指哪里？',
      '动态新增子节点如何参与委托？',
      'stopPropagation会阻断什么？',
      '阻止传播是否等于阻止默认行为？',
      '捕获阶段与冒泡阶段顺序如何？',
    ],
    facts: [
      '会冒泡的事件从目标向祖先传播，因此父节点上的监听器可以集中处理多个后代的事件。',
      'target表示事件起始目标，currentTarget表示当前正在执行监听器的节点。',
      '后续插入的后代事件仍可沿父链传播，父级委托不必为每个新节点再逐个绑定。',
      'stopPropagation停止事件继续沿传播路径传递，可能使祖先委托监听器收不到该事件。',
      '阻止事件传播不等于取消默认动作，取消可取消的默认动作需要preventDefault。',
      '捕获阶段从祖先向目标推进，冒泡阶段再从目标方向返回祖先。',
    ],
    oral: [
      '一长串按钮，事件委托为啥只给外面绑一个也能管到里头？',
      '点的是按钮里那个小图标，target跟currentTarget各指谁？',
      '后头又加进来十个按钮，也不用再挨个绑一遍？',
      '里面有个人把传播给停了，外面那个还听得见不？',
      '不让它往外传，就等于链接也不会跳走了吧？',
      '还有捕获那一趟，跟往外冒这趟，是先走谁呀？',
    ],
  },
  {
    id: 'jsthis',
    title: 'JavaScript this绑定',
    bank: 'js',
    original: 'this、箭头函数和bind',
    references: [
      'https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/this',
    ],
    headings: [
      '普通JavaScript函数的this怎样确定？',
      '方法取出后单独调用保留接收者吗？',
      '严格模式下直接调用this是什么？',
      '箭头函数的this来自哪里？',
      'bind能重绑箭头函数this吗？',
      '普通函数使用bind后如何保留接收者？',
    ],
    facts: [
      '普通函数的this主要由调用方式决定，作为对象方法调用时通常指向该接收对象。',
      '把方法赋给独立变量后直接调用不会自动记住所属对象，需要重新提供或绑定接收者。',
      '严格模式下不带接收者直接调用普通函数，其this为undefined。',
      '箭头函数不创建自己的this，而是捕获外围词法作用域的this。',
      '对箭头函数使用call、apply或bind不能改变它已经捕获的this。',
      'bind可为普通函数创建绑定指定this的新函数，适合把方法作为回调传递。',
    ],
    oral: [
      'JavaScript的this，主要看函数写在哪儿，还是看它怎么被叫起来？',
      '对象的方法我拿出来单独传走了，它还记得原来那个对象吗？',
      '严格模式里就这么直接叫，那个值到底是什么？',
      '换成箭头函数呢，里头也会临时认调用它的人？',
      '那我硬给箭头函数bind一下，能把它拽到另一个对象上不？',
      '普通方法做回调时还得认原来的对象，你一般咋处理？',
    ],
  },
  {
    id: 'box',
    title: 'CSS盒模型',
    bank: 'css',
    original: '盒模型与box-sizing',
    references: ['https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Box_model/Introduction'],
    headings: [
      'CSS标准盒模型的width覆盖什么？',
      '内容宽度加padding和border后多宽？',
      'border-box怎样解释width？',
      'margin是否包含在border-box宽度内？',
      '内容区会因内边距变化而怎样？',
      '尺寸排查应区分哪些区域？',
    ],
    facts: [
      '标准content-box中设置的width对应内容区，内边距和边框在该宽度之外。',
      'content-box的边框盒宽度需要把左右padding及border加到内容宽度上。',
      'border-box让声明宽度包含内容、padding和border，便于控制组件整体边框盒尺寸。',
      'margin位于边框之外，不被box-sizing:border-box纳入声明宽度。',
      '固定border-box宽度时增加内边距或边框通常会压缩可供内容使用的宽度。',
      '定位尺寸问题要分别检查content、padding、border和margin，不能把外边距当成内容区。',
    ],
    oral: [
      'CSS盒模型那个width，默认说的是里面内容，还是连边框一块算？',
      '我写二百宽，两边再垫二十，怎么最后比二百胖了？',
      '想整块边框以内就二百，得换成哪个算法？',
      '那外面留的margin也能一起包进这二百里吗？',
      '整体不许变宽，我再加厚内边距，文字能待的地方会咋变？',
      '看到页面多出来一块空，你会把哪几层分开量一下？',
    ],
  },
  {
    id: 'stacking',
    title: 'CSS层叠上下文',
    bank: 'css',
    original: 'z-index 与层叠上下文',
    references: [
      'https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Positioned_layout/Stacking_context',
    ],
    headings: [
      'CSS层叠上下文怎样参与父级排序？',
      '子节点的巨大z-index能穿透父上下文吗？',
      'transform对层叠上下文有什么影响？',
      'opacity小于1会形成什么边界？',
      '上下文内部排序会直接与叔辈竞争吗？',
      '遮挡问题为什么要先查祖先？',
    ],
    facts: [
      '一个层叠上下文在父级排序时作为一个整体参与，内部层级先在自己的范围内决定。',
      '子节点再大的z-index也不能单靠数值越过所属上下文在父级中的整体位置。',
      '非none的transform能够建立新的层叠上下文。',
      'opacity小于1的元素会建立新的层叠上下文，其后代被包含在这个排序单位里。',
      '不同上下文的后代不能直接按各自z-index数值全局竞争，需要先比较其上下文层级。',
      '排查遮挡应沿祖先检查上下文的形成与父级排序，不能只不断增大目标元素的z-index。',
    ],
    oral: [
      'CSS层叠上下文说自成一层，到外面排队时到底按谁算？',
      '我把里面z-index写到九个九，咋还是压不过旁边那个？',
      '外面那层只是加了个transform，也会把里头圈住么？',
      '透明度调成一点九，啊不是，零点九，也会有这种影响？',
      '所以它跟叔叔家的孩子，不是拿各自那个数字直接比大小？',
      '碰到遮挡，你会一路往上找啥，而不是继续往后添九？',
    ],
  },
  {
    id: 'balancer',
    title: '负载均衡分流',
    bank: 'design',
    original: '负载均衡、L4/L7及单点故障',
    references: [
      'https://github.com/donnemartin/system-design-primer/blob/master/README.md#load-balancer',
    ],
    headings: [
      '负载均衡如何减少故障实例接流量？',
      '四层分流主要看什么信息？',
      '七层分流能根据路径和cookie吗？',
      '只有一台均衡器为何仍有单点？',
      '会话黏性带来什么状态约束？',
      '多台均衡器是否没有额外复杂度？',
    ],
    facts: [
      '负载均衡可借助健康检查识别不可用后端，避免继续把正常流量送给故障实例。',
      '四层均衡依据传输层信息，例如源和目标IP及端口进行分流。',
      '七层均衡理解应用消息，可基于HTTP路径、头部或cookie等内容选择后端。',
      '只有一台负载均衡器时，它自身故障仍会让整个入口不可用。',
      '黏性会话让用户倾向回到同一后端，但增加对该实例及其会话状态的依赖。',
      '为入口部署冗余实例可以降低单点风险，同时增加故障切换和运维复杂度。',
    ],
    oral: [
      '前面加个负载均衡，它咋知道后面某台已经不行了？',
      '四层那个，只看地址端口就分了，是吧？',
      '想按接口路径把人送到不同地方，得让它看到哪一层？',
      '所有请求都先过这一台，那它自己挂了不也全完？',
      '把同一个人老送回同一台，省事是省事，坏处在哪？',
      '多摆两台就万事大吉了，还是又多了些切换的麻烦？',
    ],
  },
  {
    id: 'cap',
    title: 'CAP网络分区取舍',
    bank: 'design',
    original: 'CAP 与一致性模式',
    references: [
      'https://github.com/donnemartin/system-design-primer/blob/master/README.md#cap-theorem',
    ],
    headings: [
      'CAP中的分区发生时要做什么取舍？',
      'CAP一致性中的读取要求是什么？',
      'CAP可用性是否等于任意返回成功？',
      'CP如何面对不能保证新鲜的数据？',
      'AP如何面对副本暂时分歧？',
      '最终一致性附带什么前提？',
    ],
    facts: [
      '发生网络分区时，分布式系统无法同时保证线性一致性与每个非故障节点请求都可完成的可用性。',
      'CAP的一致性要求读取表现为看到最近的写入或相应错误，不是业务字段符合约束的泛称。',
      'CAP可用性要求非故障节点收到的请求能获得有效响应，不能简单用随意报错冒充成功服务。',
      '选择CP时，为了避免读写不一致，分区期间部分请求可能被拒绝或等待。',
      '选择AP时继续处理请求，分区期间不同副本可能暂时看到不同数据。',
      '最终一致性依赖后续更新停止且通信及收敛机制能够推进，不能解释成所有读都立即最新。',
    ],
    oral: [
      'CAP老说只能选两样，网断成两边以后，真正逼你选的是哪两样？',
      '这里一致，指字段不能乱，还是每次都要像看到最新那样？',
      '来一个请求我就报个错，也能算它说的可用吗？',
      '要是我宁愿别给旧的，也得保证不乱，这会牺牲啥？',
      '反过来先让两边都能干活，那两边看到的能暂时不一样吧？',
      '说最后总会一样，也得后面不再改、网络恢复这些条件吧？',
    ],
  },
  {
    id: 'pastebin',
    title: 'Pastebin公开设计案例',
    bank: 'pastebin',
    original: 'Design Pastebin.com (or Bit.ly)',
    project: true,
    references: [sources.pastebin],
    headings: [
      'Pastebin项目在公开题中包含哪些功能？',
      'Pastebin项目的原文存在哪里？',
      'Pastebin项目如何处理短标识碰撞？',
      'Pastebin项目读取时怎样取得内容？',
      'Pastebin项目的访问统计需要实时吗？',
      'Pastebin项目的七位Base62是实际线上事实吗？',
    ],
    facts: [
      'Pastebin公开设计题要求匿名提交文本并获得链接，支持可选过期时间及过期清理。',
      'Pastebin示例把短标识和内容路径放在SQL元数据表，文本正文可放入对象存储。',
      'Pastebin示例创建短标识时检查数据库唯一性，碰撞后重新生成，并利用主键约束唯一。',
      'Pastebin示例读取先按短标识查询元数据，再依据路径到对象存储获取文本。',
      'Pastebin题设不要求实时访问分析，可以离线处理Web日志得到按月访问次数。',
      '七位Base62等数值属于Pastebin这道公开设计题的假设方案，不代表真实公司的线上架构。',
    ],
    oral: [
      '让你按公开题做个Pastebin，最开始到底需要支持哪些事？',
      '用户贴的那一大段，你全塞进那张短链接表里吗？',
      '生成的短码跟别人撞了咋办，不能把老内容顶掉吧？',
      '用户拿着链接回来，查找链路给我顺一遍。',
      '有人要看访问次数，你每点一下都同步算报表吗？',
      '你说的七位短码，是这道题设的，还是敢说人家公司生产就这么干？',
    ],
  },
  {
    id: 'twitter',
    title: 'Twitter公开设计案例',
    bank: 'twitter',
    original: 'Design the Twitter timeline and search',
    project: true,
    references: [sources.twitter],
    headings: [
      'Twitter项目的fanout写入链路是什么？',
      'Twitter项目的首页时间线缓存哪些内容？',
      'Twitter项目如何补全时间线详情？',
      'Twitter项目的名人扇出有什么问题？',
      'Twitter项目为何对名人使用读时合并？',
      'Twitter项目的用户时间线读哪个来源？',
    ],
    facts: [
      'Twitter公开设计示例把发帖写入送入fanout服务，更新持久化数据、搜索索引及关注者首页时间线缓存。',
      'Twitter示例的首页缓存保存tweet id、user id等紧凑信息，而不是每个收件人都复制完整媒体。',
      'Twitter示例读取首页时先获取缓存中的标识，再通过批量查询补齐帖子和用户详情。',
      'Twitter示例中粉丝极多的账号会导致写时扇出昂贵，需要处理高扇出带来的压力。',
      'Twitter示例可对高粉丝账号改为读时拉取并合并，普通账号继续使用预计算时间线。',
      'Twitter示例的个人用户时间线从SQL读取该用户发布的帖子，与首页缓存读取路径不同。',
    ],
    oral: [
      '公开题里让你设计Twitter时间线，发一条以后怎么送到大家首页啊？',
      '每个人那份缓存，都把整段文字和大图片复制一遍吗？',
      '光拿到一堆编号怎么展示，后面的详情又怎么补？',
      '来个几千万粉丝的，每发一次就挨个推，顶得住么？',
      '那这种大号改成读的时候再合，普通人还提前算，是这意思？',
      '看某一个人自己发过的，跟我首页那份也走完全一样的地方？',
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
  text: `## ${t.headings[0]}\n\n${t.facts[0]}\n\n### ${t.headings[1]}\n\n${t.facts[1]}\n\n### ${t.headings[2]}\n\n${t.facts[2]}\n\n## ${t.headings[3]}\n\n${t.facts[3]}\n\n### ${t.headings[4]}\n\n${t.facts[4]}\n\n### ${t.headings[5]}\n\n${t.facts[5]}`,
}));
export const cases: Case[] = [];
const q = (text: string): History => ({ kind: 'question', text });
const target = (t: Topic, i: number): Target => ({
  documentId: t.id,
  root: i < 3 ? 1 : 2,
  fact: t.facts[i],
});
function add(value: Omit<Case, 'id'>) {
  cases.push({
    id: 'public-' + String(cases.length + 1).padStart(3, '0'),
    ...value,
    history: value.history.map((v) => ({ ...v })),
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
topics.forEach((t, i) => {
  const before = topics[(i + 7) % topics.length];
  add({
    group: 'public_topic_switch',
    query: `刚才那个先放一下，现在说${t.title}。${t.oral[3]}`,
    history: [q(before.oral[0]), { kind: 'interviewee', text: before.facts[0] }, q(before.oral[1])],
    targets: [target(t, 3)],
    kind: 'answerable',
    projects: t.project ? [t.id] : [],
    sourceUrls: [sources[t.bank], ...t.references],
  });
});
const comparisons: [number, number, string, number, number][] = [
  [0, 1, 'synchronized护住一段代码，跟volatile让标志可见，在复合操作上到底差在哪？', 0, 2],
  [
    2,
    3,
    'ThreadLocal的每线程值，遇到线程池反复用那些人，哪里容易串到下一单？再说线程池为什么先排队。',
    3,
    1,
  ],
  [4, 5, 'MySQL联合索引那一套，跟InnoDB借旧版本读快照那一套，各自解决啥问题？', 0, 3],
  [6, 7, 'Redis持久化没落下的写会丢，和内存顶满选键淘汰，这两件事分开讲讲。', 1, 0],
  [8, 9, 'Cache-Aside数据库改完得动旧副本，跟HTTP的no-cache，是不是都等于完全不能保存？', 1, 3],
  [10, 11, '闭包里面几个函数共用那个变量，和事件循环一口气执行完一个任务，是两回事吧？', 2, 0],
  [12, 13, 'DOM委托回调的currentTarget，跟JavaScript箭头函数的this，分别由谁决定？', 1, 3],
  [14, 15, 'CSS盒模型算尺寸和层叠上下文管遮挡，别混着讲，各自最要紧的规则是啥？', 2, 1],
  [
    18,
    19,
    'Pastebin跟Twitter这两道公开设计题，一个按链接取正文，一个首页拿编号再补详情，分别咋读？',
    3,
    2,
  ],
  [18, 19, 'Twitter那份缓存存什么，Pastebin那份SQL表又存什么，给我分清楚。', 1, 1],
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
  '新买的眼镜老往下滑，是鼻托太松了吗？',
  '煮面时老黏一团，水开了再下会好些不？',
  '跑鞋湿透以后怎么晾，能不能直接放暖气上？',
  '周末去看展，拍照怎么避免玻璃反光？',
  '窗台种的薄荷叶子发黄，是晒太久了？',
  '背包肩带老往外滑，怎么调舒服点？',
  '做纸模型，胶水干了边缘翘起来怎么办？',
  '家里木门吱吱响，哪个位置抹一点润滑？',
  '鸡蛋羹里面全是小孔，是火开太大了？',
  '画水彩老把纸蹭起毛，换笔会有用吗？',
];
unrelated.forEach((query, i) => {
  for (const withHistory of [false, true])
    add({
      group: withHistory ? 'public_unrelated_after_topic' : 'public_unrelated',
      query,
      history: withHistory ? [q(topics[i].oral[0]), q(topics[i].oral[1])] : [],
      targets: [],
      kind: 'unrelated',
      projects: [],
      sourceUrls: [],
    });
});
const vague = [
  '当时这个怎么定下来的，能再讲一下不？',
  '你那个后来又怎么收尾的？',
  '它要是反过来，是不是也一样？',
  '再具体点儿，到底卡在哪一步啊？',
  '我没听清那几个数，你重说一遍呗。',
  '那最后怎么证明这个结果对？',
  '所以为啥一开始不选另外那种？',
  '它出事以后，你们是怎么找回来的？',
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
    history: [
      q(topics[18 + (i % 2)].oral[0]),
      { kind: 'gap', text: '合成录入暂停，后续指代没有已知主题' },
    ],
    targets: [],
    kind: 'ambiguous',
    projects: [],
    sourceUrls: [],
  });
  add({
    group: 'public_ai_only',
    query: vague[i + 4],
    history: [{ kind: 'suggestion', text: topics[18 + (i % 2)].facts.join('') }],
    targets: [],
    kind: 'ambiguous',
    projects: [],
    sourceUrls: [],
  });
}
['YouTube', 'Messenger', 'Uber', 'Dropbox'].forEach((name) =>
  add({
    group: 'public_absent_project',
    query: `不是Twitter，我现在问${name}项目，读写链路跟那个指标再说说。`,
    history: [q(topics[19].oral[0])],
    targets: [],
    kind: 'ambiguous',
    projects: [name],
    sourceUrls: [sources.design],
  }),
);
const missing = [
  '这个ReentrantLock在你们公司线上公平锁的真实吞吐压测是多少？',
  '你们那台机器上volatile加一具体跑了多少纳秒？',
  'ThreadLocal当时泄漏的真实用户编号有哪些？',
  '线程池在你们生产的corePoolSize具体配置几？',
  '那张MySQL表在你们生产有多少行，索引名字叫什么？',
  'InnoDB那次慢事务的真实事务ID是多少？',
  'Redis持久化当时线上丢的具体订单号有哪些？',
  'HTTP缓存那份生产页面今天的ETag真实字符串是什么？',
  'Pastebin实际公司的机房地址和机器台数是多少？',
  'Twitter真实线上名人扇出切换阈值究竟是多少？',
];
missing.forEach((query) =>
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
export const expectedCaseCount = 200;
export const expectedDocumentCount = 20;
if (cases.length !== expectedCaseCount || documents.length !== expectedDocumentCount)
  throw Error('Public corpus size mismatch');
