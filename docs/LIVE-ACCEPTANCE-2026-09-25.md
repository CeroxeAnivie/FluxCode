# 真实渠道验收（2026-09-25）

本轮使用用户明确授权的限额 Responses 渠道，通过项目内 Windows debug 程序和实际捆绑引擎验证。测试使用隔离的工作目录，不操作用户项目。不记录访问密钥，测试结束清理 Windows 凭据项；报告不包含渠道地址。所有联网操作使用进程级代理配置。

## 已通过

- 获取模型目录并一键导入全部三项：gpt-5.5、gpt-5.6-luna、gpt-5.6-sol。
- 选择 gpt-5.6-sol，默认推理档位发送真实流式请求。
- 模型实际调用终端，在隔离目录创建 acceptance-proof.txt，内容 FLUX_REAL_TOOL_OK；收到最终回复 FLUX_TOOL_DONE。
- 同一会话使用 low 推理档位，真实回答 17+25=42。
- 重载后保留会话模型与推理档位。
- 点击停止后引擎记录 turn_aborted / interrupted，界面退出运行态。该结果不代表能够证明上游服务停止计费。
- 实际上下文压缩完成；压缩后的续聊最终返回 FLUX_AFTER_COMPACT。

## 中间失败与恢复

首次取消测试在界面重载后未等待历史恢复，未发出新的引擎轮次；调整验收步骤等待历史就绪后，取消成功。此为测试准备时序问题，未记为取消功能通过。

压缩后的首次续聊收到部分输出后，服务端明确返回 `Our servers are currently overloaded. Please try again later.`。程序保留了部分输出并展示失败。显式重试一次后完成续聊，没有开启自动重放。修正了错误分类：这类过载优先显示“模型服务暂时不可用”，不再错误引导用户检查本机网络；中英文回归测试通过。

本轮证据：work/native-provider-1790328572743 中的引擎记录与验收文件；work/real-provider-acceptance.log、work/real-provider-continuation.log、work/real-provider-recovery.log。自动化入口 scripts/native-provider-smoke.mjs 通过进程环境变量接收授权地址和密钥；重跑会产生真实费用，不属于默认单元测试。

## 范围

仅一个用户授权渠道、一个实际推理模型和默认/low 两种选择。模型目录返回三项不等于逐一验证了三种模型；本轮也不声称通过多家渠道、全部推理强度、长连接故障矩阵或服务端计费取消验收。默认档位省略 reasoning.effort 的精确请求体契约由已有本地引擎测试覆盖，本轮不通过截取生产请求来暴露凭证。
