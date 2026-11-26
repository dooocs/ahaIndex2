-- =====================================================================
-- AmazingIndex · Elon Musk 人生网格 · 阿里云 Supabase 草稿导入
-- 数据源: PR #111 / sql/people/aliyun/drafts/elon-musk-review-2026-11-02.json
-- 适用: 阿里云 Supabase (amazingindex 人物内容主库), 不是官方新闻 Supabase
-- 
-- 只做草稿: 全部新增的 tl_events/tl_event_people/tl_arcs/tl_states、
-- sources/outlets/citations 均为 status='draft'，挂入同一个 open changeset；
-- 已发布人物只修改 draft 和 changeset_id，不碰任何已发布字段。
-- 
-- 不会调用 publish_row / publish_changeset / set_featured_people / 同步任务。
-- 执行前请确认连接到阿里云数据库。整段一次执行；任何错误事务回滚。
-- 本文件为“一次性导入”，成功后再次执行会拒绝而非重复创建数据。
-- 修复 2026-11-02 用户执行报错 23514 (tl_events_sides_check):
-- JSON 字面 null (jsonb 'null') 不是 SQL NULL；非争议事件 sides 必须写 SQL NULL。
-- steps 字段同样规范化；争议事件继续使用包含各方观点的合法 JSON 数组。
-- =====================================================================

BEGIN;

DO $elon_import$
DECLARE
  v_payload jsonb := $elon_payload$
{"person":{"slug":"elon-musk","name":"Elon Musk","name_zh":"埃隆·马斯克","nickname":"Tesla与SpaceX掌舵人","role":"SpaceX、Tesla CEO · xAI创始人","person_group":"掌舵人","tier":null,"fields":["商业航天","电动汽车","人工智能","脑机接口"],"birth_date":"1971-06-28","birth_prec":"day","birth_place":"南非比勒陀利亚","death_date":null,"death_prec":null,"x_handle":"elonmusk","github_handle":null,"avatar_url":null,"former_subjects":[],"added_at":"2026-11-02","updated_at":"2026-11-02T00:00:00Z","featured_rank":2,"take_text":"他把互联网退出换来的资金投入资本密集、失败代价极高的火箭和电动车，2008年的危机、2015年的火箭回收和2020年的载人飞行证明了长期工程投入的力量；但工程成绩也不能免除上市公司披露、社交平台治理和公共权力参与中的责任。看他，不只看改变了什么，也看改变付出了什么代价。","take_updated_at":"2026-11-02","sources":[{"title":"CNN 马斯克生平概要","url":"https://kesq.com/news/national-world/cnn-world/2026/06/17/elon-musk-fast-facts-6/","outlet":"CNN","published_at":"2026-06-17","pub_prec":"day","kind":"report","lang":"en","phase":null,"quote":null,"excerpt":null,"outlet_domain":"kesq.com"},{"title":"Tesla 投资者关系：Elon Musk","url":"https://ir.tesla.com/corporate/elon-musk","outlet":"Tesla","published_at":null,"pub_prec":"day","kind":"official","lang":"en","phase":null,"quote":null,"excerpt":null,"outlet_domain":"ir.tesla.com"}]},"dimensions":[{"key":"role","label":"身份"},{"key":"wealth","label":"财富"},{"key":"family","label":"家庭"}],"arcs":[{"label":"南非成长","start":"1971-06-28","end":"1988-12-01","lane":0,"color":"gray","summary":"少年学习编程；成年后前往北美求学。","role_text":"学生","start_prec":"day","end_prec":"month","entity":null,"sources":[{"title":"CNN 马斯克生平概要","url":"https://kesq.com/news/national-world/cnn-world/2026/06/17/elon-musk-fast-facts-6/","outlet":"CNN","published_at":"2026-06-17","pub_prec":"day","kind":"report","lang":"en","phase":null,"quote":null,"excerpt":null,"outlet_domain":"kesq.com"}]},{"label":"北美求学","start":"1989-01-01","end":"1994-12-01","lane":0,"color":"gray","summary":"女王大学、宾夕法尼亚大学，短暂进入斯坦福后投身创业。","role_text":"学生","start_prec":"year","end_prec":"month","entity":null,"sources":[{"title":"CNN 马斯克生平概要","url":"https://kesq.com/news/national-world/cnn-world/2026/06/17/elon-musk-fast-facts-6/","outlet":"CNN","published_at":"2026-06-17","pub_prec":"day","kind":"report","lang":"en","phase":null,"quote":null,"excerpt":null,"outlet_domain":"kesq.com"},{"title":"斯坦福创业项目：Elon Musk","url":"https://stvp.stanford.edu/people/elon-musk","outlet":"Stanford","published_at":null,"pub_prec":"day","kind":"report","lang":"en","phase":null,"quote":null,"excerpt":null,"outlet_domain":"stvp.stanford.edu"}]},{"label":"Zip2","start":"1995-01-01","end":"1999-03-01","lane":0,"color":"blue","summary":"早期互联网企业服务，最终被康柏收购。","role_text":"联合创始人","start_prec":"year","end_prec":"month","entity":null,"sources":[{"title":"斯坦福创业项目：Elon Musk","url":"https://stvp.stanford.edu/people/elon-musk","outlet":"Stanford","published_at":null,"pub_prec":"day","kind":"report","lang":"en","phase":null,"quote":null,"excerpt":null,"outlet_domain":"stvp.stanford.edu"}]},{"label":"X.com / PayPal","start":"1999-03-01","end":"2002-10-01","lane":2,"color":"violet","summary":"X.com、合并PayPal、CEO变更，2002年10月出售持股。","role_text":"联合创始人 · 股东","start_prec":"month","end_prec":"month","entity":null,"sources":[{"title":"华盛顿邮报：X.com、PayPal、X","url":"https://www.washingtonpost.com/history/2023/07/25/elon-musk-paypal-twitter-x-rebrand/","outlet":"Washington Post","published_at":"2023-07-25","pub_prec":"day","kind":"report","lang":"en","phase":null,"quote":null,"excerpt":null,"outlet_domain":"washingtonpost.com"},{"title":"Tesla 投资者关系：Elon Musk","url":"https://ir.tesla.com/corporate/elon-musk","outlet":"Tesla","published_at":null,"pub_prec":"day","kind":"official","lang":"en","phase":null,"quote":null,"excerpt":null,"outlet_domain":"ir.tesla.com"}]},{"label":"SpaceX","start":"2002-05-01","end":null,"lane":0,"color":"orange","summary":"从Falcon 1到火箭回收、载人飞行、Starlink，2026年IPO。","role_text":"创始人 · CEO","start_prec":"month","end_prec":null,"entity":null,"sources":[{"title":"SpaceX：任务与里程碑","url":"https://www.spacex.com/mission/","outlet":"SpaceX","published_at":null,"pub_prec":"day","kind":"official","lang":"en","phase":null,"quote":null,"excerpt":null,"outlet_domain":"spacex.com"},{"title":"SpaceX：2026年IPO完成公告","url":"https://ir.spacex.com/updates/releases-details/2026/Space-Exploration-Technologies-Corp--Announces-Closing-of-Initial-Public-Offering-Including-Full-Exercise-of-Underwriters-Option-to-Purchase-Additional-Shares-2026-RgoR-Y1Vwh/","outlet":"SpaceX","published_at":"2026-06-15","pub_prec":"day","kind":"official","lang":"en","phase":null,"quote":null,"excerpt":null,"outlet_domain":"ir.spacex.com"}]},{"label":"Tesla","start":"2004-04-01","end":null,"lane":1,"color":"blue","summary":"早期融资、董事长、2008年CEO，走过IPO与Model 3量产难关。","role_text":"早期投资人 → CEO","start_prec":"month","end_prec":null,"entity":null,"sources":[{"title":"Tesla 投资者关系：Elon Musk","url":"https://ir.tesla.com/corporate/elon-musk","outlet":"Tesla","published_at":null,"pub_prec":"day","kind":"official","lang":"en","phase":null,"quote":null,"excerpt":null,"outlet_domain":"ir.tesla.com"},{"title":"Tesla：IPO定价公告","url":"https://ir.tesla.com/press-release/tesla-announces-pricing-initial-public-offering","outlet":"Tesla","published_at":"2010-06-28","pub_prec":"day","kind":"official","lang":"en","phase":null,"quote":null,"excerpt":null,"outlet_domain":"ir.tesla.com"}]},{"label":"OpenAI","start":"2015-12-11","end":"2018-02-01","lane":2,"color":"olive","summary":"参与非营利AI研究机构创立，2018年退出董事会。","role_text":"联合发起人","start_prec":"day","end_prec":"month","entity":null,"sources":[{"title":"OpenAI：Introducing OpenAI","url":"https://openai.com/index/introducing-openai/","outlet":"OpenAI","published_at":"2015-12-11","pub_prec":"day","kind":"official","lang":"en","phase":null,"quote":null,"excerpt":null,"outlet_domain":"openai.com"},{"title":"OpenAI关于与马斯克关系的单方说明","url":"https://openai.com/index/openai-elon-musk/","outlet":"OpenAI","published_at":"2024-03-05","pub_prec":"day","kind":"official","lang":"en","phase":null,"quote":null,"excerpt":null,"outlet_domain":"openai.com"}]},{"label":"X / xAI","start":"2022-10-27","end":null,"lane":2,"color":"red","summary":"2022年收购Twitter并改造成X平台，2023年创办xAI，2025年完成平台与AI业务整合，2026年归属SpaceX控股体系。","role_text":"平台拥有者 · AI创始人","start_prec":"day","end_prec":null,"entity":null,"sources":[{"title":"SEC：Twitter收购完成","url":"https://www.sec.gov/Archives/edgar/data/1418091/000119312522272772/d411753d8k.htm","outlet":"SEC","published_at":"2022-10-27","pub_prec":"day","kind":"official","lang":"en","phase":null,"quote":null,"excerpt":null,"outlet_domain":"sec.gov"},{"title":"Reuters：Twitter更名X","url":"https://finance.yahoo.com/news/bird-flown-musk-twitter-ceo-073131392.html","outlet":"Reuters","published_at":"2023-07-24","pub_prec":"day","kind":"report","lang":"en","phase":null,"quote":null,"excerpt":null,"outlet_domain":"finance.yahoo.com"},{"title":"SpaceX 2026年第三季度SEC文件","url":"https://www.sec.gov/Archives/edgar/data/1181412/000162828026066880/spcx-20260930.htm","outlet":"SEC","published_at":"2026-10-30","pub_prec":"day","kind":"official","lang":"en","phase":null,"quote":null,"excerpt":null,"outlet_domain":"sec.gov"}]}],"states":[{"dimension":"role","label":"南非求学阶段","start":"1971-01-01","end":"1988-01-01","is_estimate":false,"note":null,"start_prec":"year","end_prec":"year","sources":[]},{"dimension":"role","label":"北美留学生","start":"1989-01-01","end":"1994-01-01","is_estimate":false,"note":null,"start_prec":"year","end_prec":"year","sources":[]},{"dimension":"role","label":"互联网创业者","start":"1995-01-01","end":"2001-01-01","is_estimate":false,"note":"Zip2、X.com与PayPal","start_prec":"year","end_prec":"year","sources":[]},{"dimension":"role","label":"SpaceX创始人","start":"2002-01-01","end":"2003-01-01","is_estimate":false,"note":null,"start_prec":"year","end_prec":"year","sources":[]},{"dimension":"role","label":"SpaceX创始人 · Tesla董事长","start":"2004-01-01","end":"2007-01-01","is_estimate":false,"note":null,"start_prec":"year","end_prec":"year","sources":[]},{"dimension":"role","label":"SpaceX与Tesla CEO","start":"2008-01-01","end":"2022-01-01","is_estimate":false,"note":null,"start_prec":"year","end_prec":"year","sources":[]},{"dimension":"role","label":"科技集团经营者","start":"2023-01-01","end":null,"is_estimate":false,"note":"Tesla、SpaceX和xAI/X","start_prec":"year","end_prec":null,"sources":[]},{"dimension":"wealth","label":"互联网创业早期","start":"1995-01-01","end":"1998-01-01","is_estimate":true,"note":"没有可靠的个人净资产序列","start_prec":"year","end_prec":"year","sources":[]},{"dimension":"wealth","label":"Zip2退出获得资本","start":"1999-01-01","end":"2001-01-01","is_estimate":false,"note":"交易额与私人财产不同","start_prec":"year","end_prec":"year","sources":[]},{"dimension":"wealth","label":"PayPal退出后投资实业","start":"2002-01-01","end":"2007-01-01","is_estimate":true,"note":"事业资金主要转向火箭、电动车","start_prec":"year","end_prec":"year","sources":[]},{"dimension":"wealth","label":"资本需求高度紧张","start":"2008-01-01","end":"2009-01-01","is_estimate":true,"note":"仅描述企业融资状况，不等同个人破产","start_prec":"year","end_prec":"year","sources":[]},{"dimension":"wealth","label":"持股价值随公司成长","start":"2010-01-01","end":"2025-01-01","is_estimate":true,"note":"不估计未核实的净资产数字","start_prec":"year","end_prec":"year","sources":[]},{"dimension":"wealth","label":"Tesla与上市SpaceX持股","start":"2026-01-01","end":null,"is_estimate":true,"note":"仅陈述企业IPO，不猜测具体身家","start_prec":"year","end_prec":null,"sources":[]},{"dimension":"family","label":"南非家庭成长","start":"1971-01-01","end":"1988-01-01","is_estimate":false,"note":null,"start_prec":"year","end_prec":"year","sources":[]},{"dimension":"family","label":"移居北美","start":"1989-01-01","end":"1999-01-01","is_estimate":false,"note":null,"start_prec":"year","end_prec":"year","sources":[]},{"dimension":"family","label":"与Justine Wilson的婚姻","start":"2000-01-01","end":"2008-01-01","is_estimate":false,"note":"仅使用公开信息","start_prec":"year","end_prec":"year","sources":[]},{"dimension":"family","label":"与Talulah Riley首次婚姻","start":"2010-01-01","end":"2012-01-01","is_estimate":false,"note":null,"start_prec":"year","end_prec":"year","sources":[]},{"dimension":"family","label":"与Talulah Riley第二次婚姻","start":"2013-01-01","end":"2016-01-01","is_estimate":false,"note":null,"start_prec":"year","end_prec":"year","sources":[]}],"events":[{"date":"1971-06-28","prec":"day","title":"出生于南非比勒陀利亚","valence":"turn","importance":1,"place":"南非比勒陀利亚","then_text":"Elon Reeve Musk出生于南非比勒陀利亚，在南非度过少年时代。","commentary":"出身和后来获得的资源应单独分析。","later_text":null,"sides":null,"short_id":"em000001","is_approx":false,"pinned":false,"steps":null,"my_role":"protagonist","sources":[{"title":"CNN 马斯克生平概要","url":"https://kesq.com/news/national-world/cnn-world/2026/06/17/elon-musk-fast-facts-6/","outlet":"CNN","published_at":"2026-06-17","pub_prec":"day","kind":"report","lang":"en","phase":null,"quote":null,"excerpt":null,"outlet_domain":"kesq.com"}],"people":[],"links":[]},{"date":"1983-01-01","prec":"year","title":"少年时出售游戏Blastar的程序","valence":"up","importance":1,"place":"南非","then_text":"少年时自学编程，制作太空游戏Blastar，并把代码卖给计算机杂志。","commentary":"可视为早期编程经历，不能等同于经营成熟的公司。","later_text":null,"sides":null,"short_id":"em000002","is_approx":false,"pinned":false,"steps":null,"my_role":"protagonist","sources":[{"title":"CNN 马斯克生平概要","url":"https://kesq.com/news/national-world/cnn-world/2026/06/17/elon-musk-fast-facts-6/","outlet":"CNN","published_at":"2026-06-17","pub_prec":"day","kind":"report","lang":"en","phase":null,"quote":null,"excerpt":null,"outlet_domain":"kesq.com"}],"people":[],"links":[]},{"date":"1989-01-01","prec":"year","title":"离开南非，前往加拿大","valence":"turn","importance":3,"place":"加拿大","then_text":"离开南非后移居加拿大，在当地工作并进入女王大学学习。","commentary":"这一步改变了他未来能进入的教育与技术创业网络。","later_text":null,"sides":null,"short_id":"em000003","is_approx":false,"pinned":false,"steps":null,"my_role":"protagonist","sources":[{"title":"CNN 马斯克生平概要","url":"https://kesq.com/news/national-world/cnn-world/2026/06/17/elon-musk-fast-facts-6/","outlet":"CNN","published_at":"2026-06-17","pub_prec":"day","kind":"report","lang":"en","phase":null,"quote":null,"excerpt":null,"outlet_domain":"kesq.com"},{"title":"TIME：马斯克商业经历年表","url":"https://time.com/6170834/elon-musk-business-timeline-twitter/","outlet":"TIME","published_at":"2022-04-27","pub_prec":"day","kind":"report","lang":"en","phase":null,"quote":null,"excerpt":null,"outlet_domain":"time.com"}],"people":[],"links":[]},{"date":"1992-01-01","prec":"year","title":"转入宾夕法尼亚大学","valence":"turn","importance":2,"place":"美国费城","then_text":"由加拿大女王大学转入宾夕法尼亚大学，学习物理和经济相关学科。","commentary":"他后来频繁使用工程与成本分析的语言。","later_text":null,"sides":null,"short_id":"em000004","is_approx":false,"pinned":false,"steps":null,"my_role":"protagonist","sources":[{"title":"Tesla 投资者关系：Elon Musk","url":"https://ir.tesla.com/corporate/elon-musk","outlet":"Tesla","published_at":null,"pub_prec":"day","kind":"official","lang":"en","phase":null,"quote":null,"excerpt":null,"outlet_domain":"ir.tesla.com"},{"title":"斯坦福创业项目：Elon Musk","url":"https://stvp.stanford.edu/people/elon-musk","outlet":"Stanford","published_at":null,"pub_prec":"day","kind":"report","lang":"en","phase":null,"quote":null,"excerpt":null,"outlet_domain":"stvp.stanford.edu"}],"people":[],"links":[]},{"date":"1995-01-01","prec":"year","title":"放弃继续在斯坦福深造的计划","valence":"turn","importance":2,"place":"美国加州","then_text":"短暂开始斯坦福研究生项目后选择创业，赶上互联网行业兴起。","commentary":"应明确没有取得斯坦福研究生学位。","later_text":null,"sides":null,"short_id":"em000005","is_approx":false,"pinned":false,"steps":null,"my_role":"protagonist","sources":[{"title":"斯坦福创业项目：Elon Musk","url":"https://stvp.stanford.edu/people/elon-musk","outlet":"Stanford","published_at":null,"pub_prec":"day","kind":"report","lang":"en","phase":null,"quote":null,"excerpt":null,"outlet_domain":"stvp.stanford.edu"},{"title":"CNN 马斯克生平概要","url":"https://kesq.com/news/national-world/cnn-world/2026/06/17/elon-musk-fast-facts-6/","outlet":"CNN","published_at":"2026-06-17","pub_prec":"day","kind":"report","lang":"en","phase":null,"quote":null,"excerpt":null,"outlet_domain":"kesq.com"}],"people":[],"links":[]},{"date":"1995-01-01","prec":"year","title":"与弟弟Kimbal创办Zip2","valence":"turn","importance":3,"place":"美国加州","then_text":"创办Zip2，为报社、企业提供在线城市指南与企业信息服务。","commentary":"这是从程序员转向经营者的第一阶段。","later_text":null,"sides":null,"short_id":"em000006","is_approx":false,"pinned":false,"steps":null,"my_role":"protagonist","sources":[{"title":"斯坦福创业项目：Elon Musk","url":"https://stvp.stanford.edu/people/elon-musk","outlet":"Stanford","published_at":null,"pub_prec":"day","kind":"report","lang":"en","phase":null,"quote":null,"excerpt":null,"outlet_domain":"stvp.stanford.edu"},{"title":"TIME：马斯克商业经历年表","url":"https://time.com/6170834/elon-musk-business-timeline-twitter/","outlet":"TIME","published_at":"2022-04-27","pub_prec":"day","kind":"report","lang":"en","phase":null,"quote":null,"excerpt":null,"outlet_domain":"time.com"}],"people":[],"links":[]},{"date":"1999-03-01","prec":"month","title":"康柏收购Zip2","valence":"up","importance":3,"place":"美国","then_text":"康柏以超过3亿美元的交易金额收购Zip2，马斯克获得重要创业退出资金。","commentary":"收购总价不等于他个人实际到手金额。","later_text":null,"sides":null,"short_id":"em000007","is_approx":false,"pinned":false,"steps":null,"my_role":"protagonist","sources":[{"title":"斯坦福创业项目：Elon Musk","url":"https://stvp.stanford.edu/people/elon-musk","outlet":"Stanford","published_at":null,"pub_prec":"day","kind":"report","lang":"en","phase":null,"quote":null,"excerpt":null,"outlet_domain":"stvp.stanford.edu"},{"title":"TIME：马斯克商业经历年表","url":"https://time.com/6170834/elon-musk-business-timeline-twitter/","outlet":"TIME","published_at":"2022-04-27","pub_prec":"day","kind":"report","lang":"en","phase":null,"quote":null,"excerpt":null,"outlet_domain":"time.com"}],"people":[],"links":[]},{"date":"1999-03-01","prec":"month","title":"创办在线金融公司X.com","valence":"turn","importance":3,"place":"美国加州","then_text":"将创业收益投入在线金融业务，创建X.com。","commentary":"X是此后反复出现的品牌与产品理想。","later_text":null,"sides":null,"short_id":"em000008","is_approx":false,"pinned":false,"steps":null,"my_role":"protagonist","sources":[{"title":"华盛顿邮报：X.com、PayPal、X","url":"https://www.washingtonpost.com/history/2023/07/25/elon-musk-paypal-twitter-x-rebrand/","outlet":"Washington Post","published_at":"2023-07-25","pub_prec":"day","kind":"report","lang":"en","phase":null,"quote":null,"excerpt":null,"outlet_domain":"washingtonpost.com"},{"title":"CNN 马斯克生平概要","url":"https://kesq.com/news/national-world/cnn-world/2026/06/17/elon-musk-fast-facts-6/","outlet":"CNN","published_at":"2026-06-17","pub_prec":"day","kind":"report","lang":"en","phase":null,"quote":null,"excerpt":null,"outlet_domain":"kesq.com"}],"people":[],"links":[]},{"date":"2000-03-01","prec":"month","title":"X.com与Confinity合并","valence":"turn","importance":2,"place":"美国","then_text":"X.com与经营PayPal支付业务的Confinity合并，团队围绕技术及经营方向发生分歧。","commentary":"PayPal并不是马斯克独自从零创办。","later_text":null,"sides":null,"short_id":"em000009","is_approx":false,"pinned":false,"steps":null,"my_role":"protagonist","sources":[{"title":"华盛顿邮报：X.com、PayPal、X","url":"https://www.washingtonpost.com/history/2023/07/25/elon-musk-paypal-twitter-x-rebrand/","outlet":"Washington Post","published_at":"2023-07-25","pub_prec":"day","kind":"report","lang":"en","phase":null,"quote":null,"excerpt":null,"outlet_domain":"washingtonpost.com"},{"title":"TIME：马斯克商业经历年表","url":"https://time.com/6170834/elon-musk-business-timeline-twitter/","outlet":"TIME","published_at":"2022-04-27","pub_prec":"day","kind":"report","lang":"en","phase":null,"quote":null,"excerpt":null,"outlet_domain":"time.com"}],"people":[],"links":[]},{"date":"2000-09-01","prec":"month","title":"失去合并公司CEO职位","valence":"down","importance":3,"place":"美国","then_text":"在公司管理分歧中被董事会撤换CEO职位，Peter Thiel担任CEO；马斯克仍保留股份。","commentary":"失去管理权并不等于股权归零。","later_text":null,"sides":null,"short_id":"em000010","is_approx":false,"pinned":false,"steps":null,"my_role":"protagonist","sources":[{"title":"华盛顿邮报：X.com、PayPal、X","url":"https://www.washingtonpost.com/history/2023/07/25/elon-musk-paypal-twitter-x-rebrand/","outlet":"Washington Post","published_at":"2023-07-25","pub_prec":"day","kind":"report","lang":"en","phase":null,"quote":null,"excerpt":null,"outlet_domain":"washingtonpost.com"},{"title":"CNN 马斯克生平概要","url":"https://kesq.com/news/national-world/cnn-world/2026/06/17/elon-musk-fast-facts-6/","outlet":"CNN","published_at":"2026-06-17","pub_prec":"day","kind":"report","lang":"en","phase":null,"quote":null,"excerpt":null,"outlet_domain":"kesq.com"}],"people":[],"links":[]},{"date":"2002-05-01","prec":"month","title":"创建SpaceX，转入商业航天","valence":"turn","importance":3,"place":"美国加州","then_text":"创立SpaceX，主张以工程迭代降低轨道运输成本。","commentary":"资本投入和失败成本远高于早期互联网创业。","later_text":null,"sides":null,"short_id":"em000011","is_approx":false,"pinned":false,"steps":null,"my_role":"protagonist","sources":[{"title":"Tesla 投资者关系：Elon Musk","url":"https://ir.tesla.com/corporate/elon-musk","outlet":"Tesla","published_at":null,"pub_prec":"day","kind":"official","lang":"en","phase":null,"quote":null,"excerpt":null,"outlet_domain":"ir.tesla.com"},{"title":"SpaceX：任务与里程碑","url":"https://www.spacex.com/mission/","outlet":"SpaceX","published_at":null,"pub_prec":"day","kind":"official","lang":"en","phase":null,"quote":null,"excerpt":null,"outlet_domain":"spacex.com"}],"people":[],"links":[]},{"date":"2002-10-01","prec":"month","title":"eBay完成收购PayPal","valence":"up","importance":3,"place":"美国","then_text":"eBay以约15亿美元收购PayPal，马斯克作为重要股东获得退出收益。","commentary":"第二次退出为后续大规模产业投入提供了资本。","later_text":null,"sides":null,"short_id":"em000012","is_approx":false,"pinned":false,"steps":null,"my_role":"protagonist","sources":[{"title":"Tesla 投资者关系：Elon Musk","url":"https://ir.tesla.com/corporate/elon-musk","outlet":"Tesla","published_at":null,"pub_prec":"day","kind":"official","lang":"en","phase":null,"quote":null,"excerpt":null,"outlet_domain":"ir.tesla.com"},{"title":"斯坦福创业项目：Elon Musk","url":"https://stvp.stanford.edu/people/elon-musk","outlet":"Stanford","published_at":null,"pub_prec":"day","kind":"report","lang":"en","phase":null,"quote":null,"excerpt":null,"outlet_domain":"stvp.stanford.edu"}],"people":[],"links":[]},{"date":"2004-04-01","prec":"month","title":"进入Tesla早期融资并担任董事长","valence":"turn","importance":3,"place":"美国加州","then_text":"领投Tesla早期融资，进入董事会并成为董事长，逐渐参与产品路线与经营。","commentary":"Tesla在2003年已成立，不能写成马斯克2004年独自创立Tesla。","later_text":null,"sides":null,"short_id":"em000013","is_approx":false,"pinned":false,"steps":null,"my_role":"protagonist","sources":[{"title":"Tesla 投资者关系：Elon Musk","url":"https://ir.tesla.com/corporate/elon-musk","outlet":"Tesla","published_at":null,"pub_prec":"day","kind":"official","lang":"en","phase":null,"quote":null,"excerpt":null,"outlet_domain":"ir.tesla.com"},{"title":"TIME：马斯克商业经历年表","url":"https://time.com/6170834/elon-musk-business-timeline-twitter/","outlet":"TIME","published_at":"2022-04-27","pub_prec":"day","kind":"report","lang":"en","phase":null,"quote":null,"excerpt":null,"outlet_domain":"time.com"}],"people":[],"links":[]},{"date":"2006-07-01","prec":"month","title":"担任SolarCity董事长","valence":"turn","importance":1,"place":"美国","then_text":"担任SolarCity董事长，推动太阳能与电动汽车、储能业务的结合。","commentary":"公司由其表亲创办，马斯克不是唯一创办者。","later_text":null,"sides":null,"short_id":"em000014","is_approx":false,"pinned":false,"steps":null,"my_role":"protagonist","sources":[{"title":"Tesla 投资者关系：Elon Musk","url":"https://ir.tesla.com/corporate/elon-musk","outlet":"Tesla","published_at":null,"pub_prec":"day","kind":"official","lang":"en","phase":null,"quote":null,"excerpt":null,"outlet_domain":"ir.tesla.com"},{"title":"SEC：Tesla 2016年度报告","url":"https://www.sec.gov/Archives/edgar/data/1318605/000156459017003118/tsla-10k_20161231.html","outlet":"SEC","published_at":"2017-03-01","pub_prec":"day","kind":"official","lang":"en","phase":null,"quote":null,"excerpt":null,"outlet_domain":"sec.gov"}],"people":[],"links":[]},{"date":"2008-08-01","prec":"month","title":"Falcon 1前三次发射全部失败","valence":"down","importance":3,"place":"夸贾林环礁","then_text":"火箭前三次发射未能成功入轨，SpaceX面临越来越大的研发与资金压力。","commentary":"近乎耗尽资金的说法主要来自后来当事人回顾。","later_text":null,"sides":null,"short_id":"em000015","is_approx":false,"pinned":false,"steps":null,"my_role":"protagonist","sources":[{"title":"SpaceX：任务与里程碑","url":"https://www.spacex.com/mission/","outlet":"SpaceX","published_at":null,"pub_prec":"day","kind":"official","lang":"en","phase":null,"quote":null,"excerpt":null,"outlet_domain":"spacex.com"},{"title":"CBS：马斯克回顾2008年","url":"https://www.cbsnews.com/news/billionaire-elon-musk-on-2008-the-worst-year-of-my-life/","outlet":"CBS News","published_at":"2014-03-28","pub_prec":"day","kind":"report","lang":"en","phase":null,"quote":null,"excerpt":null,"outlet_domain":"cbsnews.com"}],"people":[],"links":[]},{"date":"2008-09-28","prec":"day","title":"Falcon 1第四次尝试成功入轨","valence":"up","importance":3,"place":"夸贾林环礁","then_text":"SpaceX研发的Falcon 1首次到达轨道，成为私人开发的液体燃料轨道火箭的重要突破。","commentary":"前三次失败是第四次成功不可分割的背景。","later_text":null,"sides":null,"short_id":"em000016","is_approx":false,"pinned":false,"steps":null,"my_role":"protagonist","sources":[{"title":"SpaceX：任务与里程碑","url":"https://www.spacex.com/mission/","outlet":"SpaceX","published_at":null,"pub_prec":"day","kind":"official","lang":"en","phase":null,"quote":null,"excerpt":null,"outlet_domain":"spacex.com"},{"title":"CBS：马斯克回顾2008年","url":"https://www.cbsnews.com/news/billionaire-elon-musk-on-2008-the-worst-year-of-my-life/","outlet":"CBS News","published_at":"2014-03-28","pub_prec":"day","kind":"report","lang":"en","phase":null,"quote":null,"excerpt":null,"outlet_domain":"cbsnews.com"}],"people":[],"links":[]},{"date":"2008-10-01","prec":"month","title":"接任Tesla CEO","valence":"turn","importance":3,"place":"美国","then_text":"在Tesla资金压力和金融危机背景下正式担任首席执行官。","commentary":"从此同时承担SpaceX与Tesla的经营责任。","later_text":null,"sides":null,"short_id":"em000017","is_approx":false,"pinned":false,"steps":null,"my_role":"protagonist","sources":[{"title":"Tesla 投资者关系：Elon Musk","url":"https://ir.tesla.com/corporate/elon-musk","outlet":"Tesla","published_at":null,"pub_prec":"day","kind":"official","lang":"en","phase":null,"quote":null,"excerpt":null,"outlet_domain":"ir.tesla.com"},{"title":"CBS：马斯克回顾2008年","url":"https://www.cbsnews.com/news/billionaire-elon-musk-on-2008-the-worst-year-of-my-life/","outlet":"CBS News","published_at":"2014-03-28","pub_prec":"day","kind":"report","lang":"en","phase":null,"quote":null,"excerpt":null,"outlet_domain":"cbsnews.com"}],"people":[],"links":[]},{"date":"2008-12-01","prec":"month","title":"NASA合同和融资协助渡过危机","valence":"up","importance":3,"place":"美国","then_text":"SpaceX取得NASA商业补给服务合同，Tesla也完成关键融资，两家公司避免了迫在眉睫的困境。","commentary":"公司融资与个人资产须区分，不能夸大为所有债务已解决。","later_text":null,"sides":null,"short_id":"em000018","is_approx":false,"pinned":false,"steps":null,"my_role":"protagonist","sources":[{"title":"SpaceX：任务与里程碑","url":"https://www.spacex.com/mission/","outlet":"SpaceX","published_at":null,"pub_prec":"day","kind":"official","lang":"en","phase":null,"quote":null,"excerpt":null,"outlet_domain":"spacex.com"},{"title":"Space.com：2008年创业危机回顾","url":"https://www.space.com/25355-elon-musk-60-minutes-interview.html","outlet":"Space.com","published_at":"2014-03-31","pub_prec":"day","kind":"report","lang":"en","phase":null,"quote":null,"excerpt":null,"outlet_domain":"space.com"}],"people":[],"links":[]},{"date":"2010-06-29","prec":"day","title":"Tesla在纳斯达克IPO","valence":"up","importance":3,"place":"美国纳斯达克","then_text":"Tesla股票以TSLA代码上市交易，公开发行价每股17美元。","commentary":"上市只是持续制造与融资的新起点。","later_text":null,"sides":null,"short_id":"em000019","is_approx":false,"pinned":false,"steps":null,"my_role":"protagonist","sources":[{"title":"Tesla：IPO定价公告","url":"https://ir.tesla.com/press-release/tesla-announces-pricing-initial-public-offering","outlet":"Tesla","published_at":"2010-06-28","pub_prec":"day","kind":"official","lang":"en","phase":null,"quote":null,"excerpt":null,"outlet_domain":"ir.tesla.com"}],"people":[],"links":[]},{"date":"2012-05-01","prec":"month","title":"Dragon造访国际空间站","valence":"up","importance":3,"place":"国际空间站","then_text":"SpaceX的Dragon成为首艘访问国际空间站的商业航天器。","commentary":"商业航天的技术推进也依赖NASA合作与任务要求。","later_text":null,"sides":null,"short_id":"em000020","is_approx":false,"pinned":false,"steps":null,"my_role":"protagonist","sources":[{"title":"SpaceX：任务与里程碑","url":"https://www.spacex.com/mission/","outlet":"SpaceX","published_at":null,"pub_prec":"day","kind":"official","lang":"en","phase":null,"quote":null,"excerpt":null,"outlet_domain":"spacex.com"}],"people":[],"links":[]},{"date":"2012-06-22","prec":"day","title":"Model S正式开始交付","valence":"up","importance":3,"place":"美国加州","then_text":"Tesla向客户交付Model S电动轿车，从早期跑车走向更大市场。","commentary":"后续能否批量稳定交付比首次演示更关键。","later_text":null,"sides":null,"short_id":"em000021","is_approx":false,"pinned":false,"steps":null,"my_role":"protagonist","sources":[{"title":"Tesla：Model S开始交付","url":"https://ir.tesla.com/press-release/tesla-motors-delivers-worlds-first-premium-electric-sedan","outlet":"Tesla","published_at":"2012-06-22","pub_prec":"day","kind":"official","lang":"en","phase":null,"quote":null,"excerpt":null,"outlet_domain":"ir.tesla.com"}],"people":[],"links":[]},{"date":"2015-12-11","prec":"day","title":"参与共同发起OpenAI","valence":"turn","importance":2,"place":"美国","then_text":"OpenAI作为非营利AI研究机构宣布成立，马斯克与Sam Altman担任联合主席。","commentary":"不能用日后的纠纷替代2015年的历史记录。","later_text":null,"sides":null,"short_id":"em000022","is_approx":false,"pinned":false,"steps":null,"my_role":"protagonist","sources":[{"title":"OpenAI：Introducing OpenAI","url":"https://openai.com/index/introducing-openai/","outlet":"OpenAI","published_at":"2015-12-11","pub_prec":"day","kind":"official","lang":"en","phase":null,"quote":null,"excerpt":null,"outlet_domain":"openai.com"}],"people":[],"links":[]},{"date":"2015-12-21","prec":"day","title":"Falcon 9完成首次轨道发射后陆上回收","valence":"up","importance":3,"place":"美国卡纳维拉尔角","then_text":"SpaceX成功让Falcon 9一级火箭在执行轨道任务后返回着陆。","commentary":"一次成功回收并不等于所有复用成本问题都已经解决。","later_text":null,"sides":null,"short_id":"em000023","is_approx":false,"pinned":false,"steps":null,"my_role":"protagonist","sources":[{"title":"SpaceX：任务与里程碑","url":"https://www.spacex.com/mission/","outlet":"SpaceX","published_at":null,"pub_prec":"day","kind":"official","lang":"en","phase":null,"quote":null,"excerpt":null,"outlet_domain":"spacex.com"}],"people":[],"links":[]},{"date":"2016-01-01","prec":"year","title":"联合创办Neuralink","valence":"turn","importance":1,"place":"美国","then_text":"参与建立研究植入式脑机接口的Neuralink。","commentary":"医疗设备安全与疗效需依赖严谨临床验证。","later_text":null,"sides":null,"short_id":"em000024","is_approx":false,"pinned":false,"steps":null,"my_role":"protagonist","sources":[{"title":"Tesla 投资者关系：Elon Musk","url":"https://ir.tesla.com/corporate/elon-musk","outlet":"Tesla","published_at":null,"pub_prec":"day","kind":"official","lang":"en","phase":null,"quote":null,"excerpt":null,"outlet_domain":"ir.tesla.com"},{"title":"TIME：马斯克商业经历年表","url":"https://time.com/6170834/elon-musk-business-timeline-twitter/","outlet":"TIME","published_at":"2022-04-27","pub_prec":"day","kind":"report","lang":"en","phase":null,"quote":null,"excerpt":null,"outlet_domain":"time.com"}],"people":[],"links":[]},{"date":"2016-11-21","prec":"day","title":"Tesla完成SolarCity收购","valence":"turn","importance":2,"place":"美国","then_text":"Tesla完成收购SolarCity，将太阳能、储能与电动车放进同一组织体系。","commentary":"这项关联交易引发治理和估值争论。","later_text":null,"sides":null,"short_id":"em000025","is_approx":false,"pinned":false,"steps":null,"my_role":"protagonist","sources":[{"title":"SEC：Tesla 2016年度报告","url":"https://www.sec.gov/Archives/edgar/data/1318605/000156459017003118/tsla-10k_20161231.html","outlet":"SEC","published_at":"2017-03-01","pub_prec":"day","kind":"official","lang":"en","phase":null,"quote":null,"excerpt":null,"outlet_domain":"sec.gov"}],"people":[],"links":[]},{"date":"2016-12-01","prec":"month","title":"推动The Boring Company隧道计划","valence":"turn","importance":1,"place":"美国","then_text":"提出并推动以隧道施工降低地下交通成本的基础设施创业项目。","commentary":"其工程成熟度与电动车或轨道火箭并不相同。","later_text":null,"sides":null,"short_id":"em000026","is_approx":false,"pinned":false,"steps":null,"my_role":"protagonist","sources":[{"title":"Tesla 投资者关系：Elon Musk","url":"https://ir.tesla.com/corporate/elon-musk","outlet":"Tesla","published_at":null,"pub_prec":"day","kind":"official","lang":"en","phase":null,"quote":null,"excerpt":null,"outlet_domain":"ir.tesla.com"},{"title":"TIME：马斯克商业经历年表","url":"https://time.com/6170834/elon-musk-business-timeline-twitter/","outlet":"TIME","published_at":"2022-04-27","pub_prec":"day","kind":"report","lang":"en","phase":null,"quote":null,"excerpt":null,"outlet_domain":"time.com"}],"people":[],"links":[]},{"date":"2017-07-01","prec":"month","title":"Model 3首批客户交付","valence":"up","importance":2,"place":"美国","then_text":"Tesla开始交付Model 3，尝试走向大规模电动车制造。","commentary":"从设计一款车到稳定制造数万辆汽车是能力跃迁。","later_text":null,"sides":null,"short_id":"em000027","is_approx":false,"pinned":false,"steps":null,"my_role":"protagonist","sources":[{"title":"Bloomberg：Model 3量产困境","url":"https://news.bloomberglaw.com/daily-labor-report/how-teslas-model-3-became-elon-musks-version-of-hell","outlet":"Bloomberg","published_at":"2018-07-12","pub_prec":"day","kind":"report","lang":"en","phase":null,"quote":null,"excerpt":null,"outlet_domain":"news.bloomberglaw.com"}],"people":[],"links":[]},{"date":"2018-02-01","prec":"month","title":"退出OpenAI董事会","valence":"turn","importance":2,"place":"美国","then_text":"退出OpenAI董事会；后来双方对退出原因和商业模式发展有不同解释。","commentary":"争议内容要明确当事方来源，不能以单方材料下定论。","later_text":null,"sides":null,"short_id":"em000028","is_approx":false,"pinned":false,"steps":null,"my_role":"protagonist","sources":[{"title":"OpenAI关于与马斯克关系的单方说明","url":"https://openai.com/index/openai-elon-musk/","outlet":"OpenAI","published_at":"2024-03-05","pub_prec":"day","kind":"official","lang":"en","phase":null,"quote":null,"excerpt":null,"outlet_domain":"openai.com"}],"people":[],"links":[]},{"date":"2018-02-06","prec":"day","title":"Falcon Heavy完成首次发射","valence":"up","importance":2,"place":"美国肯尼迪航天中心","then_text":"Falcon Heavy成功首飞，验证大型运载火箭的部分设计和发射能力。","commentary":"展示工程能力不代表今后每次任务都同样顺利。","later_text":null,"sides":null,"short_id":"em000029","is_approx":false,"pinned":false,"steps":null,"my_role":"protagonist","sources":[{"title":"SpaceX：任务与里程碑","url":"https://www.spacex.com/mission/","outlet":"SpaceX","published_at":null,"pub_prec":"day","kind":"official","lang":"en","phase":null,"quote":null,"excerpt":null,"outlet_domain":"spacex.com"}],"people":[],"links":[]},{"date":"2018-07-01","prec":"month","title":"Model 3陷入产能地狱","valence":"down","importance":3,"place":"美国弗里蒙特","then_text":"Model 3爬坡遭遇自动化、产线与交付难题，马斯克长时间驻厂工作。","commentary":"原型技术和大规模制造管理是不同的挑战。","later_text":null,"sides":null,"short_id":"em000030","is_approx":false,"pinned":false,"steps":null,"my_role":"protagonist","sources":[{"title":"Bloomberg：Model 3量产困境","url":"https://news.bloomberglaw.com/daily-labor-report/how-teslas-model-3-became-elon-musks-version-of-hell","outlet":"Bloomberg","published_at":"2018-07-12","pub_prec":"day","kind":"report","lang":"en","phase":null,"quote":null,"excerpt":null,"outlet_domain":"news.bloomberglaw.com"}],"people":[],"links":[]},{"date":"2018-09-29","prec":"day","title":"因私有化推文与SEC达成和解","valence":"dispute","importance":3,"place":"美国","then_text":"美国SEC对Tesla私有化相关推文提出指控，双方达成和解；马斯克卸任Tesla董事长，马斯克及Tesla分别支付2000万美元罚款。","commentary":"和解时双方并未承认或否认SEC指控，不能写成刑事定罪。","later_text":null,"sides":[{"who":"美国证券交易委员会","text":"认为相关推文对潜在私有化资金支持作出误导性陈述，指控违反证券法并要求披露与治理整改。"},{"who":"马斯克及Tesla","text":"同意和解和董事会治理条件，但按照SEC公告在和解时并未承认或否认相关指控。"}],"short_id":"em000031","is_approx":false,"pinned":false,"steps":null,"my_role":"protagonist","sources":[{"title":"SEC：马斯克及Tesla达成和解","url":"https://www.sec.gov/newsroom/press-releases/2018-226","outlet":"SEC","published_at":"2018-09-29","pub_prec":"day","kind":"official","lang":"en","phase":null,"quote":null,"excerpt":null,"outlet_domain":"sec.gov"}],"people":[],"links":[]},{"date":"2019-05-23","prec":"day","title":"Starlink发射首批60颗卫星","valence":"up","importance":2,"place":"美国佛罗里达","then_text":"SpaceX发射第一批60颗Starlink卫星，展开宽带卫星网络部署。","commentary":"SpaceX由火箭服务延伸至通信服务。","later_text":null,"sides":null,"short_id":"em000032","is_approx":false,"pinned":false,"steps":null,"my_role":"protagonist","sources":[{"title":"Reuters：首批Starlink卫星发射","url":"https://finance.yahoo.com/news/spacex-launches-first-satellites-musks-031004208.html","outlet":"Reuters","published_at":"2019-05-24","pub_prec":"day","kind":"report","lang":"en","phase":null,"quote":null,"excerpt":null,"outlet_domain":"finance.yahoo.com"}],"people":[],"links":[]},{"date":"2020-05-30","prec":"day","title":"Crew Dragon完成首次载人轨道飞行","valence":"up","importance":3,"place":"美国佛罗里达","then_text":"SpaceX执行Demo-2任务，把NASA宇航员送入轨道并对接国际空间站。","commentary":"这项成就基于长期的测试与NASA安全认证合作。","later_text":null,"sides":null,"short_id":"em000033","is_approx":false,"pinned":false,"steps":null,"my_role":"protagonist","sources":[{"title":"SpaceX：载人龙飞船Demo-2","url":"https://www.spacex.com/launches/demo2","outlet":"SpaceX","published_at":"2020-05-30","pub_prec":"day","kind":"official","lang":"en","phase":null,"quote":null,"excerpt":null,"outlet_domain":"spacex.com"}],"people":[],"links":[]},{"date":"2021-12-13","prec":"day","title":"被TIME评为年度人物","valence":"up","importance":1,"place":"美国","then_text":"TIME选马斯克为2021年度人物，突出其在技术商业和公共话语上的影响。","commentary":"该评选是影响力评价而非道德褒奖。","later_text":null,"sides":null,"short_id":"em000034","is_approx":false,"pinned":false,"steps":null,"my_role":"protagonist","sources":[{"title":"TIME：2021年度人物","url":"https://time.com/6128078/elon-musk-person-of-the-year-washington/","outlet":"TIME","published_at":"2021-12-13","pub_prec":"day","kind":"report","lang":"en","phase":null,"quote":null,"excerpt":null,"outlet_domain":"time.com"}],"people":[],"links":[]},{"date":"2022-10-27","prec":"day","title":"以约440亿美元收购Twitter","valence":"turn","importance":3,"place":"美国","then_text":"完成Twitter私有化交易，启动公司组织和平台规则调整。","commentary":"直接拥有大型社交平台带来新的公共治理责任。","later_text":null,"sides":null,"short_id":"em000035","is_approx":false,"pinned":false,"steps":null,"my_role":"protagonist","sources":[{"title":"SEC：Twitter收购完成","url":"https://www.sec.gov/Archives/edgar/data/1418091/000119312522272772/d411753d8k.htm","outlet":"SEC","published_at":"2022-10-27","pub_prec":"day","kind":"official","lang":"en","phase":null,"quote":null,"excerpt":null,"outlet_domain":"sec.gov"},{"title":"SEC：Twitter收购协议","url":"https://www.sec.gov/Archives/edgar/data/1418091/000119312522117720/d319190dex991.htm","outlet":"SEC","published_at":"2022-04-25","pub_prec":"day","kind":"report","lang":"en","phase":null,"quote":null,"excerpt":null,"outlet_domain":"sec.gov"}],"people":[],"links":[]},{"date":"2022-11-04","prec":"day","title":"Twitter大规模裁员引发平台治理争议","valence":"dispute","importance":3,"place":"美国","then_text":"Twitter收购完成后启动大规模裁员。公司安全与诚信主管公开称全公司约50%的员工受到裁员影响，信任和安全团队约15%的员工受到影响。","commentary":"削减成本可能迅速改善现金流，却也将内容治理、人才流失和平台安全风险推向公众讨论。","later_text":null,"sides":[{"who":"公司经营方","text":"认为平台正承受收入下滑与成本压力，需要迅速调整结构，并主张内容审核仍会继续。"},{"who":"员工和质疑者","text":"担心裁员削弱内容审核、平台安全和组织延续性，并质疑改革程序。"}],"short_id":"emnew20221104","is_approx":false,"pinned":false,"steps":null,"my_role":"protagonist","sources":[{"title":"Reuters：Twitter裁员约50%并说明内容审核安排","url":"https://www.investing.com/news/stock-market-news/twitter-exec-says-50-employees-lost-jobs-following-acquisition-2933532","outlet":"Reuters","published_at":"2022-11-04","pub_prec":"day","kind":"report","lang":"en","phase":null,"quote":null,"excerpt":null,"outlet_domain":"investing.com"}],"people":[],"links":[]},{"date":"2023-04-20","prec":"day","title":"Starship首次完整组合试飞中爆炸","valence":"down","importance":2,"place":"美国得州Starbase","then_text":"Starship与Super Heavy首次组合试飞离开发射台后在空中解体，未完成原定的全部飞行目标。","commentary":"新型火箭研发在公开试验中经历失败，随后需在数据、技术和安全审查中继续改进。","later_text":null,"sides":null,"short_id":"emnew20230420","is_approx":false,"pinned":false,"steps":null,"my_role":"protagonist","sources":[{"title":"Reuters：Starship首次组合试飞爆炸","url":"https://www.investing.com/news/stock-market-news/elon-musks-spacex-set-to-launch-first-test-flight-of-starship-rocket-system-3060289","outlet":"Reuters","published_at":"2023-04-20","pub_prec":"day","kind":"report","lang":"en","phase":null,"quote":null,"excerpt":null,"outlet_domain":"investing.com"}],"people":[],"links":[]},{"date":"2023-07-12","prec":"day","title":"成立xAI，进入新一轮AI竞争","valence":"turn","importance":3,"place":"美国","then_text":"公开宣布成立xAI，开始开发大模型和相关产品。","commentary":"与2015年参与发起OpenAI属于两段不同的AI创业经历。","later_text":null,"sides":null,"short_id":"em000036","is_approx":false,"pinned":false,"steps":null,"my_role":"protagonist","sources":[{"title":"xAI官方网站","url":"https://x.ai/company","outlet":"xAI","published_at":null,"pub_prec":"day","kind":"official","lang":"en","phase":null,"quote":null,"excerpt":null,"outlet_domain":"x.ai"},{"title":"OpenAI关于与马斯克关系的单方说明","url":"https://openai.com/index/openai-elon-musk/","outlet":"OpenAI","published_at":"2024-03-05","pub_prec":"day","kind":"official","lang":"en","phase":null,"quote":null,"excerpt":null,"outlet_domain":"openai.com"}],"people":[],"links":[]},{"date":"2023-07-24","prec":"day","title":"将Twitter品牌更名为X","valence":"turn","importance":2,"place":"美国","then_text":"Twitter逐步使用X名称与标识，马斯克提出综合数字服务平台的设想。","commentary":"改名与商业模式实现之间存在距离。","later_text":null,"sides":null,"short_id":"em000037","is_approx":false,"pinned":false,"steps":null,"my_role":"protagonist","sources":[{"title":"Reuters：Twitter更名X","url":"https://finance.yahoo.com/news/bird-flown-musk-twitter-ceo-073131392.html","outlet":"Reuters","published_at":"2023-07-24","pub_prec":"day","kind":"report","lang":"en","phase":null,"quote":null,"excerpt":null,"outlet_domain":"finance.yahoo.com"}],"people":[],"links":[]},{"date":"2023-11-03","prec":"day","title":"xAI公布Grok","valence":"up","importance":2,"place":"美国","then_text":"xAI介绍Grok模型，着手面向用户提供AI产品。","commentary":"模型发布和长期可靠性应分开评价。","later_text":null,"sides":null,"short_id":"em000038","is_approx":false,"pinned":false,"steps":null,"my_role":"protagonist","sources":[{"title":"xAI：Grok发布","url":"https://x.ai/news/grok","outlet":"xAI","published_at":"2023-11-03","pub_prec":"day","kind":"official","lang":"en","phase":null,"quote":null,"excerpt":null,"outlet_domain":"x.ai"}],"people":[],"links":[]},{"date":"2023-11-30","prec":"day","title":"Cybertruck开始客户交付","valence":"up","importance":2,"place":"美国得州","then_text":"Tesla进行Cybertruck首批交付，电动皮卡进入市场。","commentary":"后续成本、质量和需求仍需验证。","later_text":null,"sides":null,"short_id":"em000039","is_approx":false,"pinned":false,"steps":null,"my_role":"protagonist","sources":[{"title":"Tesla：Cybertruck交车","url":"https://ir.tesla.com/press-release/tesla-announces-details-cybertruck-delivery-event","outlet":"Tesla","published_at":"2023-11-28","pub_prec":"day","kind":"official","lang":"en","phase":null,"quote":null,"excerpt":null,"outlet_domain":"ir.tesla.com"}],"people":[],"links":[]},{"date":"2024-01-28","prec":"day","title":"Neuralink完成首例人体植入","valence":"up","importance":2,"place":"美国","then_text":"马斯克宣布Neuralink完成首次人体脑机接口植入试验。","commentary":"早期人体实验不等于医疗效果经过充分长期验证。","later_text":null,"sides":null,"short_id":"em000040","is_approx":false,"pinned":false,"steps":null,"my_role":"protagonist","sources":[{"title":"Reuters：Neuralink首例人体植入","url":"https://finance.yahoo.com/news/neuralink-implants-brain-chip-first-231000125.html","outlet":"Reuters","published_at":"2024-01-29","pub_prec":"day","kind":"report","lang":"en","phase":null,"quote":null,"excerpt":null,"outlet_domain":"finance.yahoo.com"}],"people":[],"links":[]},{"date":"2024-10-13","prec":"day","title":"星舰助推器首次被发射塔机械臂接住","valence":"up","importance":3,"place":"美国得州Starbase","then_text":"Starship第五次试飞期间，Super Heavy返回发射塔并被机械臂成功捕获。","commentary":"从技术演示到成熟的可复用发射系统还需要更多试验。","later_text":null,"sides":null,"short_id":"em000041","is_approx":false,"pinned":false,"steps":null,"my_role":"protagonist","sources":[{"title":"SpaceX：Starship第五次试飞","url":"https://www.spacex.com/launches/starship-flight-5","outlet":"SpaceX","published_at":"2024-10-13","pub_prec":"day","kind":"official","lang":"en","phase":null,"quote":null,"excerpt":null,"outlet_domain":"spacex.com"}],"people":[],"links":[]},{"date":"2025-01-20","prec":"day","title":"参与美国DOGE政府改革工作","valence":"dispute","importance":3,"place":"美国华盛顿","then_text":"特朗普政府启动DOGE改革安排，马斯克以特别政府雇员及总统顾问身份参与；白宫表示他无独立决策权。","commentary":"节支效果、权限边界及公共服务影响存在不同观点。","later_text":null,"sides":[{"who":"支持改革者","text":"主张压缩浪费支出和简化行政流程，提高政府效率。"},{"who":"质疑者","text":"要求核验节支数字、厘清私人顾问的职权边界以及公共服务受到的影响。"}],"short_id":"em000042","is_approx":false,"pinned":false,"steps":null,"my_role":"protagonist","sources":[{"title":"美国国会研究处：DOGE行政令","url":"https://www.everycrsreport.com/reports/IN12493.html","outlet":"CRS","published_at":"2025-02-06","pub_prec":"day","kind":"report","lang":"en","phase":null,"quote":null,"excerpt":null,"outlet_domain":"everycrsreport.com"},{"title":"Reuters：白宫解释马斯克DOGE职权","url":"https://www.investing.com/news/world-news/white-house-says-musk-is-not-doge-employee-has-no-authority-to-make-decisions-3873053","outlet":"Reuters","published_at":"2025-02-17","pub_prec":"day","kind":"report","lang":"en","phase":null,"quote":null,"excerpt":null,"outlet_domain":"investing.com"}],"people":[],"links":[]},{"date":"2025-03-28","prec":"day","title":"xAI完成收购X相关控股业务","valence":"turn","importance":2,"place":"美国","then_text":"SpaceX后来在SEC文件中披露xAI于2025年3月28日完成收购X控股公司及相关业务。","commentary":"AI和社交内容业务被整合至同一控股体系。","later_text":null,"sides":null,"short_id":"em000043","is_approx":false,"pinned":false,"steps":null,"my_role":"protagonist","sources":[{"title":"SpaceX 2026年第三季度SEC文件","url":"https://www.sec.gov/Archives/edgar/data/1181412/000162828026066880/spcx-20260930.htm","outlet":"SEC","published_at":"2026-10-30","pub_prec":"day","kind":"official","lang":"en","phase":null,"quote":null,"excerpt":null,"outlet_domain":"sec.gov"}],"people":[],"links":[]},{"date":"2025-05-28","prec":"day","title":"结束白宫短期政府职务","valence":"turn","importance":2,"place":"美国华盛顿","then_text":"马斯克退出白宫短期政府工作，重新把时间投入公司经营。","commentary":"在职时的具体节支成果应由独立资料核查。","later_text":null,"sides":null,"short_id":"em000044","is_approx":false,"pinned":false,"steps":null,"my_role":"protagonist","sources":[{"title":"Reuters：马斯克退出政府岗位","url":"https://ca.investing.com/news/economy-news/elon-musk-leaving-trump-administration-white-house-official-confirms-4039023","outlet":"Reuters","published_at":"2025-05-29","pub_prec":"day","kind":"report","lang":"en","phase":null,"quote":null,"excerpt":null,"outlet_domain":"ca.investing.com"}],"people":[],"links":[]},{"date":"2025-06-22","prec":"day","title":"Tesla在奥斯汀开始小规模Robotaxi服务","valence":"up","importance":2,"place":"美国得州奥斯汀","then_text":"Tesla在有限区域启动少量付费Robotaxi试运营，初期配有安全监督安排。","commentary":"局部试运营不等于完全无人驾驶在所有条件下都可用。","later_text":null,"sides":null,"short_id":"em000045","is_approx":false,"pinned":false,"steps":null,"my_role":"protagonist","sources":[{"title":"Reuters：Austin Robotaxi有限试运营","url":"https://m.investing.com/news/stock-market-news/tesla-tiptoes-into-longpromised-robotaxi-service-4104732?ampMode=1","outlet":"Reuters","published_at":"2025-06-23","pub_prec":"day","kind":"report","lang":"en","phase":null,"quote":null,"excerpt":null,"outlet_domain":"m.investing.com"}],"people":[],"links":[]},{"date":"2026-02-02","prec":"day","title":"SpaceX收购X.AI Holdings","valence":"turn","importance":3,"place":"美国","then_text":"SpaceX完成对X.AI Holdings的收购，使其成为全资子公司。","commentary":"AI模型、社交平台与航天通信开始在集团层面更深整合。","later_text":null,"sides":null,"short_id":"em000046","is_approx":false,"pinned":false,"steps":null,"my_role":"protagonist","sources":[{"title":"SpaceX 2026年第三季度SEC文件","url":"https://www.sec.gov/Archives/edgar/data/1181412/000162828026066880/spcx-20260930.htm","outlet":"SEC","published_at":"2026-10-30","pub_prec":"day","kind":"official","lang":"en","phase":null,"quote":null,"excerpt":null,"outlet_domain":"sec.gov"}],"people":[],"links":[]},{"date":"2026-06-12","prec":"day","title":"SpaceX IPO并在纳斯达克交易","valence":"up","importance":3,"place":"美国纳斯达克","then_text":"SpaceX以SPCX代码开始交易，并于6月15日宣布本次首次公开发行完成。","commentary":"上市意味着更严格的公开市场披露责任。","later_text":null,"sides":null,"short_id":"em000047","is_approx":false,"pinned":false,"steps":null,"my_role":"protagonist","sources":[{"title":"SpaceX：2026年IPO完成公告","url":"https://ir.spacex.com/updates/releases-details/2026/Space-Exploration-Technologies-Corp--Announces-Closing-of-Initial-Public-Offering-Including-Full-Exercise-of-Underwriters-Option-to-Purchase-Additional-Shares-2026-RgoR-Y1Vwh/","outlet":"SpaceX","published_at":"2026-06-15","pub_prec":"day","kind":"official","lang":"en","phase":null,"quote":null,"excerpt":null,"outlet_domain":"ir.spacex.com"}],"people":[],"links":[]},{"date":"2026-08-14","prec":"day","title":"SpaceX完成收购Cursor开发商Anysphere","valence":"turn","importance":2,"place":"美国","then_text":"SpaceX向SEC报告完成对Anysphere公司的收购；Cursor是其开发的AI编程工具。","commentary":"集团AI业务扩展到开发者生产力领域。","later_text":null,"sides":null,"short_id":"em000048","is_approx":false,"pinned":false,"steps":null,"my_role":"protagonist","sources":[{"title":"SEC：SpaceX收购Anysphere披露","url":"https://www.sec.gov/Archives/edgar/data/1181412/000162828026056945/spcx-20260814.htm","outlet":"SEC","published_at":"2026-08-14","pub_prec":"day","kind":"official","lang":"en","phase":null,"quote":null,"excerpt":null,"outlet_domain":"sec.gov"}],"people":[],"links":[]}],"achievements":[],"labels":[],"stances":[],"comparisons":[],"wealth":[],"generated_at":"2026-11-02T00:00:00Z"}
$elon_payload$::jsonb;
  v_person jsonb;
  v_cs uuid;
  v_pid uuid;
  v_person_status text;
  v_person_draft jsonb;
  v_person_cs uuid;
  v_patch jsonb;
  v_e jsonb;
  v_a jsonb;
  v_st jsonb;
  v_src jsonb;
  v_target jsonb;
  v_targets jsonb := '[]'::jsonb;
  v_row record;
  v_eid uuid;
  v_aid uuid;
  v_stid uuid;
  v_source_id uuid;
  v_outlet_id uuid;
  v_existing_status text;
  v_existing_cs uuid;
  v_url text;
  v_domain text;
  v_count_events int := 0;
  v_count_reused int := 0;
  v_count_arcs int := 0;
  v_count_states int := 0;
  v_count_sources int := 0;
  v_count_cites int := 0;
BEGIN
  -- ① 权限与库结构检查：官方新闻库不具备这套人物域，防止写错库
  IF to_regclass('public.persons') IS NULL
     OR to_regclass('public.tl_events') IS NULL
     OR to_regclass('public.tl_arcs') IS NULL
     OR to_regclass('public.changesets') IS NULL
     OR to_regclass('public.citations') IS NULL THEN
    RAISE EXCEPTION '目标库缺少阿里云人物内容表：请确认使用的是阿里云 Supabase，不是官方新闻库';
  END IF;
  IF NOT public.can_edit() THEN
    RAISE EXCEPTION '当前数据库连接没有人物编辑权限，请在阿里云 SQL Editor 以管理员执行';
  END IF;
  IF EXISTS (
    SELECT 1 FROM (VALUES ('tl_events','sides'),('tl_events','steps'),('tl_events','pinned'),
                         ('persons','featured_rank')) AS x(t,c)
    WHERE NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema='public' AND table_name=x.t AND column_name=x.c
    )
  ) THEN
    RAISE EXCEPTION '阿里云人物域缺少雷军人生网格所需字段，请先核对人物域版本，勿强行导入';
  END IF;
  IF (v_payload->'person'->>'slug') <> 'elon-musk'
     OR jsonb_array_length(v_payload->'events') <> 50
     OR jsonb_array_length(v_payload->'arcs') <> 8
     OR jsonb_array_length(v_payload->'states') <> 18 THEN
    RAISE EXCEPTION '审核稿版本不一致，拒绝导入';
  END IF;
  -- 数据质量预检：非争议事件不得有双方辩论数组；争议事件至少两方。
  -- JSON 对象里的 null 是 jsonb 'null'，INSERT 时必须转成数据库 SQL NULL。
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_payload->'events') AS item(e)
    WHERE CASE
      WHEN item.e->>'valence' = 'dispute' THEN
        CASE WHEN jsonb_typeof(item.e->'sides') = 'array'
          THEN jsonb_array_length(item.e->'sides') < 2
          ELSE true
        END
      ELSE item.e->'sides' IS NOT NULL
           AND item.e->'sides' <> 'null'::jsonb
           AND item.e->'sides' <> '[]'::jsonb
    END
  ) THEN
    RAISE EXCEPTION '事件 sides 数据无效：争议事件需要至少两方，非争议事件必须为空';
  END IF;

  IF EXISTS (SELECT 1 FROM public.changesets WHERE title = 'AI 草稿｜马斯克人生网格 2026-11-02（PR #111）') THEN
    RAISE EXCEPTION '同名审核稿变更集已存在：请先检查，不要重复执行';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.tl_dimensions WHERE key='role')
     OR NOT EXISTS(SELECT 1 FROM public.tl_dimensions WHERE key='wealth')
     OR NOT EXISTS(SELECT 1 FROM public.tl_dimensions WHERE key='family') THEN
    RAISE EXCEPTION '缺少 role/wealth/family 状态维度，无法按雷军页面展示';
  END IF;

  v_person := v_payload->'person';

  -- ② 复用已有 Elon Musk 人物：已经发布时只能通过 draft 提议修改
  SELECT id, status, draft, changeset_id
    INTO v_pid, v_person_status, v_person_draft, v_person_cs
  FROM public.persons WHERE slug = 'elon-musk' FOR UPDATE;

  IF v_pid IS NOT NULL THEN
    IF v_person_status <> 'published' OR v_person_draft IS NOT NULL OR v_person_cs IS NOT NULL THEN
      RAISE EXCEPTION 'elon-musk 已有未发布修改／非 published 状态，先处理现有草稿，避免覆盖';
    END IF;
    -- 防止已有网格主线或状态与本次草稿并列造成泳道重叠
    IF EXISTS (SELECT 1 FROM public.tl_arcs WHERE person_id=v_pid AND status <> 'archived')
       OR EXISTS (SELECT 1 FROM public.tl_states WHERE person_id=v_pid AND status <> 'archived') THEN
      RAISE EXCEPTION 'elon-musk 已经有主线或状态内容：请先合并现有版本，不能叠加导入';
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.tl_event_people ep JOIN public.tl_events ev ON ev.id=ep.event_id
      WHERE ep.person_id=v_pid AND (ep.status='draft' OR ev.status='draft')
    ) THEN
      RAISE EXCEPTION 'elon-musk 有其他事件草稿，先完成或拒绝，避免两套待发布内容冲突';
    END IF;
  END IF;

  INSERT INTO public.changesets(title, note, origin, author, status)
  VALUES ('AI 草稿｜马斯克人生网格 2026-11-02（PR #111）',
    'PR #111：50件事件、8条人生主线、18段状态；仅草稿，严禁直接发布，审核后再决定首页排位',
    'ai_draft', 'ChatGPT · editorial', 'open')
  RETURNING id INTO v_cs;

  IF v_pid IS NULL THEN
    INSERT INTO public.persons(
      slug, name, name_zh, nickname, person_group, role, fields,
      birth_date, birth_prec, birth_place, x_handle, take_text, take_updated_at,
      status, changeset_id
    ) VALUES (
      'elon-musk', v_person->>'name', v_person->>'name_zh', v_person->>'nickname',
      v_person->>'person_group', v_person->>'role',
      ARRAY(SELECT jsonb_array_elements_text(v_person->'fields')),
      (v_person->>'birth_date')::date, v_person->>'birth_prec',
      v_person->>'birth_place', v_person->>'x_handle', v_person->>'take_text',
      (v_person->>'take_updated_at')::date, 'draft', v_cs
    ) RETURNING id INTO v_pid;
  ELSE
    -- 只在草稿 JSON 写候选内容，保留姓名、头像、X账号等线上字段的现值
    v_patch := jsonb_build_object(
      'name_zh', v_person->'name_zh',
      'nickname', v_person->'nickname',
      'person_group', v_person->'person_group',
      'role', v_person->'role',
      'fields', v_person->'fields',
      'birth_date', v_person->'birth_date',
      'birth_prec', v_person->'birth_prec',
      'birth_place', v_person->'birth_place',
      'take_text', v_person->'take_text',
      'take_updated_at', v_person->'take_updated_at'
    );
    UPDATE public.persons SET draft=v_patch, changeset_id=v_cs WHERE id=v_pid;
  END IF;

  v_targets := v_targets || jsonb_build_array(
    jsonb_build_object('type','person','id',v_pid,'sources',v_person->'sources')
  );

  -- ③ 新增主线（lane 为 0/1/2），草稿不会进入公开人生命运网格
  FOR v_a IN SELECT value FROM jsonb_array_elements(v_payload->'arcs') LOOP
    INSERT INTO public.tl_arcs (
      person_id, label, role_text, color, lane, start_date, start_prec,
      end_date, end_prec, summary, status, changeset_id
    ) VALUES (
      v_pid, v_a->>'label', v_a->>'role_text', v_a->>'color',
      (v_a->>'lane')::smallint, (v_a->>'start')::date,
      v_a->>'start_prec', (v_a->>'end')::date, v_a->>'end_prec',
      v_a->>'summary', 'draft', v_cs
    ) RETURNING id INTO v_aid;
    v_count_arcs := v_count_arcs + 1;
    v_targets := v_targets || jsonb_build_array(
      jsonb_build_object('type','arc','id',v_aid,'sources',v_a->'sources')
    );
  END LOOP;

  -- ④ 新增身份／财富／家庭状态（估值与家庭事实不做额外猜测）
  FOR v_st IN SELECT value FROM jsonb_array_elements(v_payload->'states') LOOP
    INSERT INTO public.tl_states (
      person_id, dimension_key, label, note, start_date, start_prec,
      end_date, end_prec, is_estimate, status, changeset_id
    ) VALUES (
      v_pid, v_st->>'dimension', v_st->>'label', v_st->>'note',
      (v_st->>'start')::date, v_st->>'start_prec',
      (v_st->>'end')::date, v_st->>'end_prec',
      coalesce((v_st->>'is_estimate')::boolean,false),'draft',v_cs
    ) RETURNING id INTO v_stid;
    v_count_states := v_count_states + 1;
    v_targets := v_targets || jsonb_build_array(
      jsonb_build_object('type','state','id',v_stid,'sources',v_st->'sources')
    );
  END LOOP;

  -- ⑤ 写事件与参与人。已有完全同日期+同标题的 published 事件可复用，
  -- 不删除、不改写已发布事件；其他旧事件也保留，请在正式发布前人工核对。
  FOR v_e IN SELECT value FROM jsonb_array_elements(v_payload->'events') LOOP
    v_eid := NULL;
    SELECT ev.id INTO v_eid
      FROM public.tl_events ev
      JOIN public.tl_event_people ep ON ep.event_id=ev.id
     WHERE ep.person_id=v_pid AND ev.event_date=(v_e->>'date')::date
       AND ev.title=v_e->>'title' AND ev.status='published' AND ep.status='published'
     ORDER BY ev.id LIMIT 1;
    IF v_eid IS NOT NULL THEN
      v_count_reused := v_count_reused + 1;
    ELSE
      -- 注意: v_e->'sides' 为 jsonb 值，JSON null 与 SQL NULL 不同。
      -- 这两个 NULLIF 防止违反 tl_events_sides_check / tl_events_steps_check。
      INSERT INTO public.tl_events (
        event_date, date_prec, is_approx, title, valence, importance, place,
        then_text, later_text, commentary, sides, steps, pinned, status, changeset_id
      ) VALUES (
        (v_e->>'date')::date, v_e->>'prec',
        coalesce((v_e->>'is_approx')::boolean,false),
        v_e->>'title', v_e->>'valence', (v_e->>'importance')::smallint,
        v_e->>'place', v_e->>'then_text', v_e->>'later_text',
        v_e->>'commentary', NULLIF(v_e->'sides', 'null'::jsonb), NULLIF(v_e->'steps', 'null'::jsonb),
        coalesce((v_e->>'pinned')::boolean,false), 'draft', v_cs
      ) RETURNING id INTO v_eid;

      INSERT INTO public.tl_event_people (
        event_id, person_id, role, is_primary, status, changeset_id
      ) VALUES (v_eid, v_pid, 'protagonist', true, 'draft', v_cs);
      v_count_events := v_count_events + 1;
    END IF;
    v_targets := v_targets || jsonb_build_array(
      jsonb_build_object('type','event','id',v_eid,'sources',v_e->'sources')
    );
  END LOOP;

  -- ⑥ 来源、媒体与逐项引用。已有已发布来源只读复用，不改内容。
  FOR v_target IN SELECT value FROM jsonb_array_elements(v_targets) LOOP
    FOR v_row IN
      SELECT value AS src, ordinality AS seq
      FROM jsonb_array_elements(coalesce(v_target->'sources','[]'::jsonb))
           WITH ORDINALITY
    LOOP
      v_src := v_row.src;
      v_url := v_src->>'url';
      v_domain := v_src->>'outlet_domain';

      IF v_url IS NULL OR v_url !~ '^https://' OR v_domain IS NULL OR v_domain = '' THEN
        RAISE EXCEPTION '引用缺失 HTTPS URL 或站点域名：%', v_src->>'title';
      END IF;

      SELECT id, status, changeset_id
        INTO v_source_id, v_existing_status, v_existing_cs
      FROM public.sources WHERE canonical_url=v_url;
      IF v_source_id IS NOT NULL THEN
        IF v_existing_status <> 'published' AND v_existing_cs IS DISTINCT FROM v_cs THEN
          RAISE EXCEPTION '来源 % 处于其他变更集草稿状态，不能复用', v_url;
        END IF;
      ELSE
        SELECT id, status, changeset_id
          INTO v_outlet_id, v_existing_status, v_existing_cs
        FROM public.outlets WHERE domain=v_domain;
        IF v_outlet_id IS NOT NULL THEN
          IF v_existing_status <> 'published' AND v_existing_cs IS DISTINCT FROM v_cs THEN
            RAISE EXCEPTION '媒体域名 % 存在其他草稿，不能复用', v_domain;
          END IF;
        ELSE
          INSERT INTO public.outlets (name, domain, kind, status, changeset_id)
          VALUES (
            coalesce(nullif(v_src->>'outlet',''),v_domain),
            v_domain,
            CASE WHEN (v_src->>'kind')='official' THEN 'official' ELSE 'media' END,
            'draft',v_cs
          ) RETURNING id INTO v_outlet_id;
        END IF;

        INSERT INTO public.sources (
          url, canonical_url, outlet_id, title, published_at, pub_prec,
          kind, lang, excerpt, status, changeset_id
        ) VALUES (
          v_url, v_url, v_outlet_id, v_src->>'title',
          (v_src->>'published_at')::date,
          coalesce(nullif(v_src->>'pub_prec',''),'day'),
          coalesce(nullif(v_src->>'kind',''),'report'),
          coalesce(nullif(v_src->>'lang',''),'en'),
          v_src->>'excerpt', 'draft', v_cs
        ) RETURNING id INTO v_source_id;
        v_count_sources := v_count_sources + 1;
      END IF;

      INSERT INTO public.citations (
        source_id, target_type, target_id, quote, phase, sort, status, changeset_id
      ) VALUES (
        v_source_id, v_target->>'type', (v_target->>'id')::uuid,
        v_src->>'quote', v_src->>'phase',
        (v_row.seq-1)::integer, 'draft',v_cs
      ) ON CONFLICT (source_id,target_type,target_id) DO NOTHING;
      IF FOUND THEN v_count_cites := v_count_cites + 1; END IF;
    END LOOP;
  END LOOP;

  -- ⑦ 安全断言：本次人物没有变成已发布，源数据仍在审核状态
  IF (SELECT status FROM public.changesets WHERE id=v_cs) <> 'open'
    OR v_count_events + v_count_reused <> 50
    OR v_count_arcs <> 8 OR v_count_states <> 18
    OR EXISTS (SELECT 1 FROM public.tl_arcs WHERE changeset_id=v_cs AND status<>'draft')
    OR EXISTS (SELECT 1 FROM public.tl_states WHERE changeset_id=v_cs AND status<>'draft')
    OR EXISTS (SELECT 1 FROM public.tl_events WHERE changeset_id=v_cs AND status<>'draft') THEN
    RAISE EXCEPTION '草稿导入安全检查未通过，整笔交易回滚';
  END IF;

  RAISE NOTICE '草稿变更集 = %; 新增事件 %、复用已发布事件 %、主线 %、状态 %、新增来源 %、引用 %；未发布',
    v_cs,v_count_events,v_count_reused,v_count_arcs,v_count_states,v_count_sources,v_count_cites;
END
$elon_import$;

COMMIT;

-- ⑧ 核验摘要（只读）。draft_* 计数与 source reuse 数量会因库中既有数据而不同。
WITH cs AS (
  SELECT id, status, created_at FROM public.changesets
  WHERE title='AI 草稿｜马斯克人生网格 2026-11-02（PR #111）' ORDER BY created_at DESC LIMIT 1
), ep AS (
  SELECT count(*) AS n FROM public.tl_event_people p JOIN cs ON p.changeset_id=cs.id
)
SELECT
  (SELECT id FROM cs) AS changeset_id,
  (SELECT status FROM cs) AS changeset_status,
  (SELECT status FROM public.persons WHERE slug='elon-musk') AS public_person_status,
  (SELECT count(*) FROM public.tl_arcs a JOIN cs ON a.changeset_id=cs.id AND a.status='draft') AS draft_arcs,
  (SELECT count(*) FROM public.tl_states s JOIN cs ON s.changeset_id=cs.id AND s.status='draft') AS draft_states,
  (SELECT n FROM ep) AS draft_event_links,
  (SELECT count(*) FROM public.sources s JOIN cs ON s.changeset_id=cs.id AND s.status='draft') AS draft_sources,
  (SELECT count(*) FROM public.citations c JOIN cs ON c.changeset_id=cs.id AND c.status='draft') AS draft_citations;
-- 需要查看全部草稿内容可另执行：
-- SELECT public.person_editor('elon-musk');
-- 审核通过前不要调用任何发布函数或首页排序函数。
