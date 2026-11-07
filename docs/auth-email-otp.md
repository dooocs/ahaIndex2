# 邮箱验证码登录上线配置

前端使用 `signInWithOtp({ email, options: { shouldCreateUser: true } })` 发送邮件，
使用 `verifyOtp({ email, token, type: 'email' })` 验证并保存会话。
首次验证后自动创建账号，已有账号直接登录。旧 `/auth/callback` 保留以兼容已发出的链接。

## 阿里云后台先配置，再发布前端

目标为现有 community 项目 `spb-x6r06737x2zdpg3x`，不迁移项目、不修改账号或业务数据。
现有插件不提供 Auth 模板、SMTP 设置或邮件投递日志接口。
本代码变更不代表这些线上配置已经完成，也不能证明 Gmail 收件成功。

1. 保持 Email Auth、邮箱验证开启，保留现有反滥用、发送和验证频率限制。
2. 将邮件 OTP 长度设为 6 位、有效期设为 600 秒，重发间隔至少 60 秒。
3. 在 RDS 控制台「AI 应用开发 → 项目 → Auth配置 → 邮件配置」中，**同时**更新
   `Confirm signup`（新邮箱）和 `Magic Link`（已有账号）模板。
   主题均可设为「向上研究所登录验证码」，正文使用同目录 `auth-email-otp.html`。
   正文必须包含 `{{ .Token }}`，仅修改主题或前端不能把登录链接变成验证码。
   不把验证码写入主题、日志或分析事件。
   阿里云的模板字段可能要求填写 HTML 模板 URL：将此无秘密的静态模板托管到
   Auth 服务可访问的位置，再填写新账号确认及 Magic Link 对应的模板 URL。
   验证模板 URL 可读取、替换后的邮件确实含 6 位验证码；模板读取失败可能回退到旧模板。
   这些配置保存后可能触发实例重启，应等待项目恢复运行后再做真实验证。
4. 如果配置了 Send Email Hook，确认 hook 实际发送的是验证码；启用 hook 时可能不会使用 SMTP 模板。
5. 核验实际发送服务、发件地址、域名 SPF/DKIM/DMARC 与额度。保留现有域名邮箱的收信配置。
   通过邮件服务商投递记录区分 accepted、delivered、deferred、bounced 和 suppression。
   Auth 接口返回成功不等于 Gmail 已收到邮件。官方 Supabase Cloud 的默认发信限制
   不能直接视为阿里云项目的实际配置。
6. 在邮箱所有者授权下分别对新邮箱、已有账号做真实验证，至少覆盖 Gmail 和一种国内邮箱。
   不将 OTP、登录会话或管理密钥放入 PR/截图。完成后台和收件检查后再合并并 build 发布。

## 回归验收

- 发送失败时停留在邮箱表单，不展示验证码已送达。
- 输入 6 位数字，支持粘贴带空格/全角数字的验证码。
- 错误/过期验证码可以重试，重新发送清空旧输入；发送倒计时不阻止验证。
- 请求期间禁止重复提交、重发和更换邮箱。验证码仅保存在当前页面内存中。
- 冷却时间跨刷新、标签页共享；更换邮箱不重置发送冷却。
- 登录成功后持久化会话并回到原页面；外站 `next` 退回 `/account`。
- 检查 320/375 像素移动端布局及键盘操作。

`npm test`、`npm run astro -- check`、`npm run verify:community` 和
`npm run verify:community:login` 覆盖本地模拟流程。浏览器回归必须拦截所有发信和验证请求，
不占用真实邮件额度；这些模拟检查不能替代真实 SMTP/Gmail 收件验收。

参考：https://supabase.com/docs/guides/auth/auth-email-passwordless

阿里云配置说明：https://help.aliyun.com/zh/rds/apsaradb-rds-for-postgresql/configure-email-authentication-and-templates-for-rds-supabase
