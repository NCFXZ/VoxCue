// A fresh, synthetic holdout authored after local-v5 was frozen. Nothing is
// imported from either earlier evaluation corpus. Labels are fixed before the
// first run; do not tune production rules against this set and call it unseen.
export type History = { kind: 'question' | 'interviewer' | 'interviewee' | 'suggestion' | 'gap'; text: string };
export type OralCase = {
  id: string;
  group: string;
  query: string;
  history: History[];
  targets: { documentId: string; root: 1 | 2; fact: string }[];
  kind: 'answerable' | 'unrelated' | 'ambiguous' | 'missing_fact';
  projects: string[];
};

const topics = [
  {
    id: 'bplus', title: 'B+树磁盘索引',
    question: 'B+树为什么适合磁盘范围查询？',
    body: 'B+树非叶子节点只保存分隔键和子页指针，叶子保存记录入口并按键有序链接。较大的扇出减少树高，范围扫描定位起点后沿叶子链顺序读。',
    risk: '随机主键会使插入分散到许多叶子页，引起页分裂和随机写放大。',
    fix: '评估递增主键或合理填充因子，批量导入按键排序，同时观察写入热点，不能只靠增加树的阶数。',
    verify: '固定数据量和查询区间，对比逻辑读页数、物理读和插入时的页分裂次数。',
    questions: ['索引那个B+树，为啥查一整段还挺快的呀？', 'B+树要是老往里塞随机的编号，会不会越写越费劲？', 'B+树这块真变好了，你拿啥证明？'],
    followups: ['叶子挨着连起来，这么干图啥呢？', '可写入的编号东一个西一个，会出啥岔子？', '已经老裂页了，有没有实在点的处理办法？', '改完咋知道不是数据少了才显得快？', '呃，我还是没捋顺，为啥树不用长那么高？', '这么弄之后写热点是不是也得盯着呀？'],
  },
  {
    id: 'http2', title: 'HTTP/2多路复用',
    question: 'HTTP/2怎样让多个请求共用连接？',
    body: 'HTTP/2将消息拆成带流编号的二进制帧，在同一条TCP连接内交错传输。各流独立组织消息，不需要为每个请求单独建立连接。',
    risk: '底层TCP发生丢包时，后到字节要等待重传，多个HTTP/2流仍可能一起受传输层队头阻塞影响。',
    fix: '区分应用层排队与传输层丢包，检查丢包率和拥塞；对高丢包链路可评估基于QUIC的HTTP/3。',
    verify: '使用相同并发请求和模拟丢包率，记录各流完成时间以及TCP重传次数。',
    questions: ['HTTP/2就一根连接，一堆请求咋挤进去的？', '都说HTTP/2不排队了，怎么掉个包还是一起卡？', 'HTTP/2的队头阻塞要复现，你会怎么试？'],
    followups: ['一条线上来回穿插，咋知道每段是谁的？', '那掉了一小包，别的请求跟着等是为啥呀？', '别光说原理，遇上这种卡住你会从哪儿下手？', '我想看实测，怎么把这个现象弄出来？', '所以多个请求真不用一个个新连了，对吧？', '如果只是网络丢包多，下一步换啥试试？'],
  },
  {
    id: 'gochan', title: 'Go协程取消',
    question: 'Go的生产者消费者如何停止并释放协程？',
    body: 'Go生产者通过channel传递任务，消费者处理任务。退出路径用context取消信号，发送和接收都用select监听取消，关闭channel由唯一发送方负责。',
    risk: '下游提前返回后，上游仍向无人接收的channel发送，会永久阻塞并造成goroutine泄漏。',
    fix: '把取消信号传到整个流水线，select同时等待发送和ctx.Done，使用WaitGroup确认所有工作协程退出。',
    verify: '重复启动并取消流水线，观察goroutine数量能否回到基线，并用阻塞栈定位未退出的发送者。',
    questions: ['Go里下游不接活儿了，上游那个协程咋收回来？', 'Go往channel发东西一直堵住，这会泄漏吗？', 'Go协程到底退干净没有，咋查靠谱？'],
    followups: ['谁负责关这条通道啊，接收的人能关吗？', '接的人先跑路了，发的人是不是就挂那儿了？', '那别让它干等，退出那段你会咋写？', '嘴上说没泄漏，实际怎么验一下？', '取消是每一段都得知道，还是告诉最后一段就行？', '一直发不出去的那个，到底怎么被唤醒退出？'],
  },
  {
    id: 'epoll', title: 'epoll边缘触发',
    question: 'epoll的ET模式为什么要配合非阻塞读取？',
    body: 'epoll边缘触发在就绪状态发生变化时通知。套接字设置非阻塞，每次通知后循环读取，直到read返回EAGAIN，表示当前数据已经取尽。',
    risk: '一次通知只读一小段就返回，剩余数据可能不再产生新边沿，连接看起来像再也收不到数据。',
    fix: '读到EAGAIN再回到事件循环；为防止单连接占满CPU，可采用有界读取预算并显式重新调度未完成连接。',
    verify: '构造一次写入大于读取缓冲区的请求，检查所有字节被读完，同时统计其他连接的等待时间。',
    questions: ['epoll那个ET，为啥一有通知就得读到底？', 'epoll只读了一点，后面就不喊我了，这咋回事？', 'epoll的ET写对没有，有啥办法测出来？'],
    followups: ['读到什么程度才算这次能回去了？', '偷个懒只拿一点，会发生啥？', '要一直读的话，会不会把别人饿着，怎么兼顾？', '别只看跑没跑，怎么专门抓这个漏读问题？', '等于没数据的时候立马回来，不能堵在那里，是这意思吗？', '有个连接一直灌数据，怎么让其他人也轮上？'],
  },
  {
    id: 'snowflake', title: 'Snowflake发号',
    question: 'Snowflake怎样在多节点生成唯一编号？',
    body: 'Snowflake编号组合时间戳、机器编号和毫秒内序列。机器编号必须在同一发号域唯一，序列用尽要等到下一毫秒，不能直接从零重复。',
    risk: '系统时钟回拨会重用过去的时间片，若继续按旧逻辑生成可能出现重复编号。',
    fix: '检测回拨后停止发号或等待时钟追平，较大回拨切换受控逻辑时钟；持久化租约和机器编号分配状态。',
    verify: '注入时钟回拨和同毫秒高并发，检查全量编号无重复并验证停发策略，而不只比较平均吞吐。',
    questions: ['Snowflake好多机器一起发号，咋保证不撞呢？', 'Snowflake碰到系统时间往回跳，会出事儿吗？', 'Snowflake别光说唯一，怎么真测不重复？'],
    followups: ['同一毫秒里挤满了，就又从零开始吗？', '机器时间被拨回去了，这号还能接着发不？', '碰上这种倒退，你会让服务怎么处理？', '想人为折腾它一下，测试该造什么情况？', '不同机器的那一段，是不是也得有人管着？', '回拨得特别多，还傻等着靠谱么？'],
  },
  {
    id: 'bloom', title: '布隆过滤器',
    question: '布隆过滤器如何判断一个元素是否出现过？',
    body: '布隆过滤器用多个哈希把元素映射到位数组。任一对应位为零可确定元素未加入，所有位为一只表示可能出现过，标准插入型结构不会漏掉已加入元素。',
    risk: '多个元素共享位会产生假阳性，直接清零删除一个元素可能误伤其他元素而产生假阴性。',
    fix: '按容量和目标误判率设置位数与哈希数量，需要删除时评估计数布隆过滤器，阳性结果仍回查权威数据。',
    verify: '使用已知未插入集合测量假阳性率，再检查所有已插入元素不会被判定为不存在。',
    questions: ['布隆过滤器说有就真有吗？我有点没懂。', '布隆过滤器删个东西，直接把那几位擦掉行不行？', '布隆过滤器到底误判了多少，咋量？'],
    followups: ['它说没有的时候，能直接信吗？', '好几个人占了一样的位置，删的时候不就串了嘛？', '我确实得支持删除，有没有替代的做法？', '别拿一堆已经有的东西去测，误判率该怎么算？', '所以它判断有之后，还得再找真正的数据确认一下？', '数据越塞越多，开始定的那些参数还顶得住么？'],
  },
  {
    id: 'jwt', title: 'JWT退出与撤销',
    question: 'JWT签名验证和用户退出有什么关系？',
    body: 'JWT由签发方签名，服务端校验签名、受众和有效期后接受令牌。签名验证说明令牌未被篡改，不等于能知道用户是否刚刚退出。',
    risk: '客户端删除令牌只清除了本机副本，被盗的访问令牌在到期前仍可能被接受。',
    fix: '缩短访问令牌有效期并轮换刷新令牌，需要立即撤销时使用jti拒绝列表或用户令牌版本号，并检查服务端状态。',
    verify: '退出后重放旧访问令牌和旧刷新令牌，分别验证即时撤销、到期失效以及轮换重用检测。',
    questions: ['JWT签名都验过了，人退出之后它就不能用了吧？', 'JWT我从浏览器删了，别人偷走的那份还管用？', 'JWT退出做没做好，你会重放啥试试？'],
    followups: ['有签名只是没被改过，不代表人还在线，对吗？', '用户这边点退出，坏人手里那份会跟着没吗？', '想当场让它作废，你这边怎么做啊？', '那我怎么确认旧的确实用不了了？', '光靠有效期这一条，能知道刚才退出了吗？', '刷新那份被别人再用一次，也能查出来不？'],
  },
  {
    id: 'orset', title: 'OR-Set合并',
    question: 'OR-Set如何合并并发添加和删除？',
    body: 'OR-Set给每次添加附唯一标签，删除只移除已经观察到的添加标签。副本合并保留尚未被删除的标签，因此未观察到的并发添加可以保留下来。',
    risk: '删除标记和唯一标签长期增长会占用存储，不能在副本尚未同步时随意丢弃墓碑。',
    fix: '通过版本向量或因果稳定性证明全部相关副本已观察删除，再安全回收墓碑；离线副本要纳入策略。',
    verify: '打乱添加删除和消息到达顺序，多次重复合并，检查最终收敛以及幂等、交换和结合性质。',
    questions: ['OR-Set一个人在加另一个在删，最后听谁的？', 'OR-Set那些删除标记越攒越多，能直接扔吗？', 'OR-Set合并真能收敛，怎么试比较像样？'],
    followups: ['删的时候为啥只能删自己看见过的那份？', '标记一直不清，会不会占一大堆地方？', '想腾空间，又怕老副本复活旧数据，该怎么办？', '故意把消息次序搞乱，最后应该看什么？', '没见过的那个新增，是不是不能顺手给人抹掉？', '有台机器一直离线，清理是不是就麻烦了？'],
  },
  {
    id: 'hnsw', title: 'HNSW近邻图',
    question: 'HNSW如何在图里寻找近似近邻？',
    body: 'HNSW建立多层近邻图，从稀疏高层快速导航，到底层扩展候选搜索。efSearch控制查询候选宽度，M控制图连接数量。',
    risk: '候选宽度过小可能遗漏真正近邻；增加图连接和搜索宽度会增加内存或查询耗时，不保证精确最近邻。',
    fix: '固定向量和查询集，分别调整efSearch与M，根据召回率、内存和延迟选择折中，不把相似度当成校准概率。',
    verify: '用同一距离度量的暴力精确结果作真值，测量Recall@k及高分位延迟，保持查询集和k不变。',
    questions: ['HNSW这个图，找东西咋不用把所有向量扫一遍？', 'HNSW调得特快，但是漏答案了，会是哪块太小？', 'HNSW召回率怎么测，跟谁比才算数？'],
    followups: ['上面那几层稀稀拉拉的，有啥用呀？', '只顾快少看几个，会不会把真邻居漏了？', '我愿意慢点换准点，先试哪个参数？', '你说准了，总得有个标准答案吧，怎么来？', '连的边更多是不是也要多吃内存？', '别只给个平均数，验证时还得看啥？'],
  },
  {
    id: 'wal', title: 'WAL持久化',
    question: '数据库为什么先写WAL再改数据页？',
    body: 'WAL先记录可用于重做的日志，提交按持久性策略等待日志落盘，再延后刷脏数据页。崩溃恢复重放已持久化日志，避免每次提交同步写全部数据页。',
    risk: '仅写入操作系统页缓存而没有完成持久化同步，突然断电时仍可能丢失已经向客户端确认的提交。',
    fix: '明确fsync和存储写缓存保证，通过group commit合并多事务同步，权衡批次等待与持久化延迟。',
    verify: '记录已确认提交编号，在受控故障注入后恢复并核对这些编号，区分进程崩溃与断电的持久化边界。',
    questions: ['WAL为啥要先记一笔，不能直接把数据页改了？', 'WAL写到系统缓存里就说提交成功，断电也没事儿吗？', 'WAL持久化怎么验，杀进程够不够？'],
    followups: ['日志先落下来了，数据页晚点写也能救回来？', '只是丢进系统缓存，这会不会还不算稳？', '每笔都刷又慢，有没有攒一小批的办法？', '那怎么验证，说成功的那几笔真没丢？', '所以不用每次把所有脏页都刷完才回复？', '杀掉进程和直接掉电，验证的边界一样吗？'],
  },
  {
    id: 'bucket', title: '令牌桶限流',
    question: '令牌桶如何允许短时突发而控制平均速率？',
    body: '令牌桶按固定速率补充令牌，上限为桶容量，请求消耗令牌。空闲时积攒的令牌允许短时突发，长期通过速率由补充速率约束。',
    risk: '多节点各自维护完整额度会让总限额按节点数放大；非原子读改也可能在并发下超发。',
    fix: '需要全局额度时在统一存储原子扣减或分配受控子配额，同时定义存储故障时放行还是拒绝。',
    verify: '分别发送平稳流量、瞬时突发和多节点并发，统计被接受的总数及每个时间窗口内的通过量。',
    questions: ['令牌桶平时限着速，为啥突然来一堆还能过？', '令牌桶每台机器各放一份，全局是不是就超了？', '令牌桶限住没限住，拿哪几种流量试？'],
    followups: ['闲着的时候能攒多少，谁说了算？', '扩成四台以后还是每台那么多，会出啥问题？', '想大家共用一份额度，扣的时候怎么别打架？', '光匀速打流量是不是测不出问题？', '一下涌进来多少能放过，跟桶多大有关吧？', '存额度的地方挂了，是不是还得先定个策略？'],
  },
  {
    id: 'saga', title: 'Saga业务补偿',
    question: 'Saga如何处理跨服务长事务失败？',
    body: 'Saga把业务拆成本地事务序列，每一步成功后推进下一步；后续失败时执行已成功步骤对应的业务补偿。补偿不是数据库物理回滚，需要按业务定义可逆动作。',
    risk: '补偿本身也可能失败或被重复调用，已经发出的实物和外部不可逆动作不能靠反向SQL自动撤销。',
    fix: '补偿操作做幂等并持久化进度，对可重试失败重试，超出策略后转人工处理，不可逆步骤放在合适的业务边界。',
    verify: '在每个步骤以及每次补偿中注入故障，重复投递补偿命令，检查最终业务状态和待人工处理记录。',
    questions: ['Saga做到一半挂了，它咋把前面的事儿撤回来？', 'Saga补偿也失败了，难道一直卡着？', 'Saga真不怕重复补偿？你怎么验证？'],
    followups: ['这个撤回，跟数据库回滚是一回事儿吗？', '撤回的动作自己又挂了，咋收场呀？', '同一个撤回再来两遍，怎么别退两次钱？', '想把这套流程测透，你会在哪儿故意弄坏？', '东西都寄出去了，还能靠反着执行语句撤销吗？', '自动折腾很多次还不行，最后谁来接这个事？'],
  },
] as const;

export const projects = [
  { id: 'lanlu', name: '岚鹿', title: '岚鹿项目上传链路复盘',
    approach: '岚鹿是合成的文件上传服务，文件分片写入对象存储，完成后校验摘要并合并，上传会话保存已成功分片编号。',
    params: '岚鹿分片大小是6 MiB，会话保留18小时。',
    failure: '岚鹿断线重连后只补传未确认分片，同一分片以会话号和序号幂等覆盖，合并前校验整文件摘要。',
    metrics: '岚鹿合成基准里上传成功率为99.3%，恢复传输平均少传72%的字节。',
    boundary: '岚鹿基准只包含200 MiB到2 GiB的文件，没有测移动网络和超过2 GiB的文件。',
    verify: '岚鹿在相同文件和链路上对比全量重传与续传，注入中途断线，核对最终文件摘要。',
    seed: '先说说岚鹿那个大文件上传吧，怎么做的？',
    followups: ['切成一块块的，一块多大，记录又留多久啊？', '传半截网没了，回来不是又得从头传吧？', '做完到底好在哪儿，给个实际数字呗。', '这个少传的结论，你们是拿什么比出来的？', '啥样的文件和网络测过了，别把没测的也算上啊。', '我再捋一下，一块块传完，最后怎么确认整个文件没坏？'],
  },
  { id: 'mosha', name: '墨砂', title: '关于墨砂项目的离线批注记录',
    approach: '墨砂是合成的离线批注工具，每条批注使用独立标识和版本，离线修改记入操作日志，上线后同步到服务器。',
    params: '墨砂每45秒尝试同步一批，单批最多80条批注。',
    failure: '墨砂遇到同一批注的冲突时保留两个版本并提示人工合并，不使用最后写入覆盖来悄悄丢掉内容。',
    metrics: '墨砂合成回放中同步队列的P95清空时间为11秒，人工合并冲突比例为0.7%。',
    boundary: '墨砂测试使用最多4个副本，最长离线36小时，没有无限离线时长的结论。',
    verify: '墨砂固定同一组编辑操作，打乱同步顺序并加入断网，比较服务器最终批注与保留的冲突版本。',
    seed: '我想听墨砂离线批注那段，断网的时候怎么改？',
    followups: ['联网了多久发一回，一回塞多少？', '两个人都改同一条，咋办，总不能悄悄盖掉吧？', '最后队列多久能消完，冲突多不多啊？', '这两个结果是怎么回放验证的？', '离线多长、多少台一起改，这个测试有边界吧？', '回到开头，离线时那些改动先放在哪儿？'],
  },
  { id: 'tangyu', name: '棠屿', title: '项目：棠屿的图像质检方案',
    approach: '棠屿是合成的图像质检服务，图片先统一缩放和归一化，再按相机编号分队列，推理服务动态组批。',
    params: '棠屿一批最多12张图片，凑批最长等待16毫秒。',
    failure: '棠屿把无法解码的图片放入隔离队列并返回可定位的错误，推理超时只重试一次且记录原请求标识。',
    metrics: '棠屿在合成固定图片集上吞吐为每秒310张，单张端到端P95延迟为47毫秒。',
    boundary: '棠屿结果仅针对固定960像素输入和单张合成显卡环境，没有多卡扩展结论。',
    verify: '棠屿固定图片顺序和总数，对比逐张推理与动态组批，并分别统计预处理和排队耗时。',
    seed: '棠屿做图像质检，用的什么处理链路？',
    followups: ['攒几张一起跑啊，总不能一直等着凑满吧？', '图片坏了或者跑超时呢，怎么接住？', '这么攒着跑，最后一秒多少张、等多久？', '怎么知道快的是推理，而不是预处理换了条件？', '这些数字在哪个输入大小、几张卡上跑的？', '一张图进来，还没推理之前先做啥？'],
  },
  { id: 'caomai', name: '潮麦', title: '潮麦的排班服务面试摘记',
    approach: '潮麦是合成的排班服务，把资质和休息时长作为硬约束，偏好和轮班均衡作为软约束，用分支定界搜索可行排班。',
    params: '潮麦单次求解预算为8秒，滚动排班窗口为14天。',
    failure: '潮麦无可行解时返回冲突约束集合，允许管理员调整软偏好，但不自动放宽资质与休息硬约束。',
    metrics: '潮麦合成样本中可行排班覆盖率为96.2%，班次偏好满足率为83%。',
    boundary: '潮麦样本为6个科室共120名员工，没有跨院区临时调派的测试结论。',
    verify: '潮麦在相同人员与请假输入下对照人工排班，单独检查所有硬约束，偏好满足率不替代合法性检查。',
    seed: '潮麦的排班你能口头讲讲吗，哪些是一定得满足的？',
    followups: ['一回排多久的班，算多长时间就得停？', '真排不出来怎么办，总不能把硬条件扔了吧？', '最后能排出来多少，大家的偏好照顾得咋样？', '这两个比例跟什么比，硬条件也都验了？', '这批数据多少人，跨地方借人也测过没？', '一开始说硬的软的，你再说具体点儿呗。'],
  },
  { id: 'qili', name: '栖砾', title: '栖砾项目——网页抓取调度',
    approach: '栖砾是合成的网页抓取调度器，按域名分配并发预算，URL规范化后去重，每个域名单独排队。',
    params: '栖砾每个域名最多3个并发请求，失败重试最多2次。',
    failure: '栖砾遇到429响应优先遵循Retry-After，再加随机退避，连续限流时降低该域名并发而非全局重试。',
    metrics: '栖砾合成站点集成功抓取率为98.1%，重复URL请求比例降到1.4%。',
    boundary: '栖砾测试仅使用30个受控合成站点，不包含登录页面、反爬验证码或付费内容。',
    verify: '栖砾对比相同URL清单的请求日志，加入重定向与429，检查规范化去重和每域名并发上限。',
    seed: '栖砾那个抓网页的调度怎么防止把一个站打爆？',
    followups: ['同一个站开几个一起抓，失败了再来几次？', '人家回了四二九，你们还硬往上冲啊？', '折腾完成功率和重复抓取各怎么样？', '怎么算重复，有没有拿同一份网址比？', '测的是真要登录的站，还是自己能控制的那种？', '同一个网址写法不一样，最开始怎么认出来？'],
  },
  { id: 'wuxian', name: '雾弦', title: '雾弦项目邮件通知',
    approach: '雾弦是合成的邮件通知服务，以业务事件号和模板版本组成去重键，待发送任务持久化后交给工作进程。',
    params: '雾弦单封邮件最多尝试4次，去重记录保留9天。',
    failure: '雾弦区分永久拒收与临时失败，永久拒收不重试，临时失败指数退避，不能保证外部邮箱绝不重复收信。',
    metrics: '雾弦合成投递集最终接受率为97.6%，P95首次提交耗时为620毫秒。',
    boundary: '雾弦只统计邮件服务商接受请求，不将接受率声称为进入收件箱或用户阅读率。',
    verify: '雾弦固定事件清单并注入工作进程重启与服务商暂时失败，对比去重键日志和服务商接受记录。',
    seed: '雾弦的邮件通知怎么保证任务不凭空没了？',
    followups: ['一封最多发几回，那个防重复的记录放多久？', '地址永远收不了，和暂时发不出，处理一样不？', '最后发进去的比例和等待时间有数字么？', '工作进程中间死一次，这个结果还靠谱么，怎么试的？', '说发成功了，是进收件箱了还是对方服务先接了？', '别发重了的那个标识，是拿哪两样拼的？'],
  },
  { id: 'songbo', name: '松泊', title: '在松泊项目里处理设备数据',
    approach: '松泊是合成的设备遥测服务，按设备编号分区写入时序存储，乱序数据在事件时间窗口内合并，保留原始采集时间。',
    params: '松泊允许迟到75秒，聚合窗口长度为20秒。',
    failure: '松泊超过迟到窗口的数据进入补算队列，不把采集时间改成接收时间，也不直接覆盖已发布统计。',
    metrics: '松泊合成设备流吞吐为每秒18000点，窗口内统计完整率为99.1%。',
    boundary: '松泊结果基于500台合成设备，没有长达数小时断网后一次回传的测试结论。',
    verify: '松泊用有序原始流计算离线真值，再注入乱序与迟到，对比窗口聚合结果并检查补算记录。',
    seed: '松泊处理设备数据，时间顺序乱了咋弄？',
    followups: ['能晚到多长，汇总又是多长一段？', '超过那个时间才来，就给它算成现在的数据吗？', '这套能吃下多少数据，完整性怎么样？', '乱着来算得对不对，拿什么当标准呀？', '多少台设备测的，断几小时再一起发也验证过？', '一条数据到底按哪个时间算，收到的时候么？'],
  },
  { id: 'auburn', name: 'Auburn', title: 'Auburn project audio slicing',
    approach: 'Auburn是合成的音频切片服务，按静音边界切分长音频，切片保留相邻重叠和原始时间偏移，离线批量处理。',
    params: 'Auburn每片目标长度为28秒，相邻片重叠400毫秒。',
    failure: 'Auburn遇到持续无静音片段时按最大时长切片，重叠区转写按时间戳去重，解码失败片段独立报错。',
    metrics: 'Auburn合成音频集平均处理实时率为0.24，跨片边界重复词比例为0.6%。',
    boundary: 'Auburn只测单声道16千赫合成普通话音频，没有多人重叠说话识别结论。',
    verify: 'Auburn使用带参考时间戳的固定合成录音，对比整段和切片输出，单独统计边界漏词和重复词。',
    seed: 'Auburn音频切片那段你做了啥，切完还能对上原来的时间吗？',
    followups: ['每片多长，相邻两片又重多少？', '一直讲话没有停顿，难道一直切不下来？', '跑一段要多久，边界重复有没有数字？', '怎么专门看切口那里丢没丢词、重没重复？', '那多人一起说话，这个结果也能套吗？', '从长录音里拿出来一小段，原来的位置怎么保留？'],
  },
] as const;

export const documents = [
  ...topics.map((t) => ({ id: t.id, title: t.title, project: false,
    roots: [t.body, t.verify],
    text: `## Q001. ${t.question}\n\n${t.body}\n\n### 追问 1：这种方案有什么容易忽略的风险？\n\n${t.risk}\n\n### 追问 2：工程上如何处理这些问题？\n\n${t.fix}\n\n## Q002. 如何验证${t.title}的正确性和取舍？\n\n${t.verify}` })),
  ...projects.map((p, i) => ({ id: p.id, title: p.title, project: true,
    roots: [p.approach, p.metrics],
    // Vary heading placement naturally; project ownership is not always the
    // first token, and two distinct project roots exist in the same document.
    text: `## Q001. ${i % 3 === 0 ? p.name + '项目的实现是怎样的？' : i % 3 === 1 ? '请介绍' + p.name + '项目的实现？' : '在' + p.name + '项目里采用了什么设计？'}\n\n${p.approach}\n\n### 追问 1：配置参数有什么依据？\n\n${p.params}\n\n### 追问 2：异常路径怎么处理？\n\n${p.failure}\n\n## Q002. ${i % 2 ? '能具体说说' + p.name + '项目的验证结果吗？' : p.name + '项目最后效果如何？'}\n\n${p.metrics}\n\n### 追问 1：测试有什么适用边界？\n\n${p.boundary}\n\n### 追问 2：如何验证结论？\n\n${p.verify}` })),
];

export const cases: OralCase[] = [];
function add(group: string, query: string, history: History[], targets: OralCase['targets'], kind: OralCase['kind'] = 'answerable', projectNames: string[] = []) {
  cases.push({ id: `unseen-${String(cases.length + 1).padStart(3, '0')}`, group, query, history: history.map(h => ({ ...h })), targets, kind, projects: projectNames });
}
const q = (text: string): History => ({ kind: 'question', text });
const target = (documentId: string, root: 1 | 2, fact: string) => ({ documentId, root, fact });

for (const t of topics) {
  [t.body, t.id === 'saga' ? t.fix : t.risk, t.verify].forEach((fact, i) =>
    add('oral_standalone', t.questions[i], [], [target(t.id, i === 2 ? 2 : 1, fact)]));
  const history: History[] = [q(t.questions[0]), { kind: 'interviewee', text: t.body }];
  const facts = [t.body, t.risk, t.fix, t.verify, t.body, t.fix];
  if (t.id === 'bloom') facts[4] = t.fix;
  if (t.id === 'hnsw') { facts[4] = t.risk; facts[5] = t.verify; }
  if (t.id === 'wal') facts[5] = t.verify;
  if (t.id === 'saga') facts[4] = t.risk;
  for (let i = 0; i < t.followups.length; i++) {
    add(i < 3 ? 'oral_followup_early' : 'oral_followup_late', t.followups[i], history, [target(t.id, facts[i] === t.verify ? 2 : 1, facts[i])]);
    history.push(q(t.followups[i]), { kind: 'interviewee', text: facts[i] });
  }
}
for (const p of projects) {
  const history: History[] = [q(p.seed), { kind: 'interviewee', text: p.approach }];
  const facts = [p.params, p.failure, p.metrics, p.verify, p.boundary, p.approach];
  p.followups.forEach((query, i) => {
    add(i < 3 ? 'project_followup_early' : 'project_followup_late', query, history, [target(p.id, i >= 2 && i <= 4 ? 2 : 1, facts[i])], 'answerable', [p.id]);
    history.push(q(query), { kind: 'interviewee', text: facts[i] });
  });
}

const switches = [
  [0, 1, '哦说岔了，我问的是墨砂离线批注，两边都改了同一条那咋留？', 'failure'],
  [1, 0, '别接着说批注了，回到岚鹿，网断了以后哪部分得重传？', 'failure'],
  [2, 3, '先打住，棠屿先放一边。潮麦那边排不出班咋办？', 'failure'],
  [3, 2, '我记串了，是棠屿图像那块，一批最多放多少张来着？', 'params'],
  [4, 5, '抓网页那段等会儿，雾弦有永久拒收还要重试吗？', 'failure'],
  [5, 4, '不是邮件，我说栖砾抓站点的时候被限流了咋办？', 'failure'],
  [6, 7, '换到Auburn音频，前后两片是完全不挨着的吗？', 'params'],
  [7, 6, '音频先搁着，说松泊，太晚才收到的数据往哪放？', 'failure'],
  [0, 2, '欸那棠屿做完一秒能跑多少图啊？', 'metrics'],
  [2, 0, '那岚鹿呢，你们最后少传了多少字节？', 'metrics'],
  [1, 3, '要是换成潮麦，单次算不出来最多等多久？', 'params'],
  [3, 1, '那墨砂最多隔多久就去同步一次？', 'params'],
  [4, 6, '栖砾先说到这儿，松泊窗口内数据齐不齐？', 'metrics'],
  [6, 4, '等会我还有个栖砾的问题，一家站同时能抓几个？', 'params'],
  [5, 7, '顺带问Auburn，处理一小时录音大概多快，有测试数字吗？', 'metrics'],
  [7, 5, '好，雾弦呢？你们测到的是接收成功还是阅读成功？', 'boundary'],
] as const;
for (const [before, after, query, key] of switches) {
  const p = projects[after];
  add('project_switch', query, [q(projects[before].seed), q(projects[before].followups[0])], [target(p.id, key === 'metrics' || key === 'boundary' ? 2 : 1, p[key])], 'answerable', [p.id]);
}
const comparisons = [
  [0, 1, '岚鹿跟墨砂这俩，保存上传状态和保存离线改动各是怎么干的？', 'approach'],
  [2, 3, '棠屿和潮麦别混了，攒批的等待和求解的预算分别多少？', 'params'],
  [4, 5, '栖砾、雾弦都要重试，最多次数是不是一样？', 'params'],
  [6, 7, '松泊和Auburn都切窗口，但各自时间参数是啥？', 'params'],
  [0, 2, '我想把岚鹿跟棠屿的实测结果并排讲，各有哪些数字？', 'metrics'],
  [1, 3, '墨砂以及潮麦测的规模，分别到什么程度？', 'boundary'],
  [4, 6, '栖砾跟松泊，成功或完整率各是多少，别串了。', 'metrics'],
  [5, 7, '雾弦和Auburn验证数字的方法，一边用啥，一边用啥？', 'verify'],
] as const;
for (const [a, b, query, key] of comparisons) {
  const ps = [projects[a], projects[b]];
  add('project_comparison', query, [q(projects[a].seed)], ps.map(p => target(p.id, key === 'metrics' || key === 'boundary' || key === 'verify' ? 2 : 1, p[key])), 'answerable', ps.map(p => p.id));
}

const unrelated = [
  '我那盆绿萝叶子黄了，浇水是多了还是少了呀？',
  '鞋子后跟老磨脚，有没有什么缓和的办法？',
  '昨晚剩的米饭今天拿来炒，怎么弄才不粘成一团？',
  '哎我想周末去海边，带什么东西不容易漏啊？',
  '一说话猫就往门口跑，是不是想出门了？',
  '吉他那根弦总有杂音，手要怎么按舒服点？',
  '冬天跑步要先热多久身，直接跑行不行？',
  '给朋友写生日卡片，别太肉麻，怎么开头？',
  '刚摘的草莓要先洗再放冰箱吗？',
  '我坐车容易晕，坐哪个位置能舒服一点？',
  '去露营睡袋买厚点还是薄点，有啥判断方法？',
  '家里灯一闪一闪的，先看灯泡还是开关？',
];
unrelated.forEach((query, i) => {
  add('unrelated_standalone', query, [], [], 'unrelated');
  add('unrelated_after_topic', '好先聊点别的，' + query, [q(topics[i].questions[0]), q(topics[i].followups[0])], [], 'unrelated');
});

const ambiguous = ['这块后来咋兜的底呀？', '最开始为啥非选它？', '还记得调成多少了吗？', '嗯，那一批到底几个？', '所以最后有改善没有？', '你那个结果再说具体点呗。', '还是不行的话，接着呢？', '要重来一次会改哪儿？', '等等，前面说的那个，上限是多少？', '后来是谁拍板这么干的？', '这样不会漏掉点啥吗？', '这招放到实际线上顶得住不？'];
ambiguous.forEach(query => add('ambiguous_without_history', query, [], [], 'ambiguous'));

const missing = [
  '岚鹿当时对象存储一个月花了多少钱？',
  '墨砂具体用了哪个数据库版本，能报完整版本号吗？',
  '棠屿那个模型谁训练的，训练集多少张？',
  '潮麦上线那个月哪天发版的？',
  '栖砾线上机器一共有多少台，几核几G？',
  '雾弦用的是哪家邮件服务商，套餐多少钱？',
  '松泊采集的温度传感器具体是什么牌子型号？',
  'Auburn做的时候团队几个人，你个人负责多少比例？',
  'Snowflake你们线上机器编号是多少号？',
  'HNSW在你实际项目里efSearch最后定成多少来着？',
  'JWT签名的那个线上私钥具体内容是啥？',
  'B+树你们线上表的索引具体占多少GB？',
];
missing.forEach((query, i) => add('missing_fact', query, i < 8 ? [q(projects[i].seed)] : [], [], 'missing_fact', i < 8 ? [projects[i].id] : []));

for (let i = 0; i < 4; i++) {
  add('gap_breaks_reference', ambiguous[i], [q(projects[i].seed), { kind: 'gap', text: '合成测试中的录入中断' }], [], 'ambiguous');
  add('ai_suggestion_not_fact', ambiguous[i + 4], [{ kind: 'suggestion', text: projects[i + 4].approach + projects[i + 4].params }], [], 'ambiguous');
  add('transcript_followup', projects[i].followups[0], [{ kind: 'interviewer', text: projects[i].seed }, { kind: 'interviewee', text: projects[i].approach }], [target(projects[i].id, 1, projects[i].params)], 'answerable', [projects[i].id]);
}
if (cases.length !== 240) throw Error('The unseen corpus must contain exactly 240 frozen cases');
