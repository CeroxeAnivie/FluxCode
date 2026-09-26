import { english } from '../locales/en';
const sourceByEnglish = new Map(
  Object.entries(english).map(([source, translated]) => [translated, source]),
);
const classifiedErrors = [
  {
    pattern: /引擎数据目录.*(?:过长|短路径)|目录别名|足够短的目录/i,
    message: '程序目录过长，请退出后将整个程序文件夹移至较短路径。历史数据仍保留在原目录。',
  },
  {
    pattern: /Git.*冲突|Git conflict|merge conflict|rebase conflict|冲突标记|未解决的冲突/i,
    message: 'Git 操作遇到冲突，请检查冲突列表。',
  },
  {
    pattern: /备份.*(?:校验失败|损坏|缺少|格式无效)|backup.*(?:checksum|corrupt|invalid manifest)/i,
    message: '备份校验失败，请选择其他备份并检查数据目录。',
  },
  {
    pattern: /本地界面索引|ui-state-mirror|workspace index/i,
    message: '本地工作空间索引无法读取，请恢复上一份索引或重启后重试。',
  },
  {
    pattern: /disk full|no space left|磁盘空间不足/i,
    message: '磁盘空间不足，请释放空间后重试备份。',
  },
  {
    pattern:
      /\bos error [23]\b|cannot find the (?:file|path)|file not found|path not found|找不到指定的(?:文件|路径)|项目文件不存在/i,
    message: '文件不存在或已移动，请刷新后重试。',
  },
  {
    pattern: /\bos error 32\b|sharing violation|being used by another process|正由另一进程使用/i,
    message: '文件正在被其他程序使用，请关闭相关程序后重试。',
  },
  {
    pattern: /无法使用系统默认应用打开文件|no application is associated|no app is associated/i,
    message: '无法使用系统默认应用打开文件',
  },
  {
    pattern: /(?:HTTP\s*)?429\b|rate limit|too many requests|请求过于频繁/i,
    message: '服务请求受限，请稍后重试。',
  },
  {
    pattern:
      /(?:HTTP\s*)?5\d\d\b|server error|servers? (?:are |is )?(?:currently )?overloaded|服务端错误/i,
    message: '模型服务暂时不可用，请稍后重试。',
  },
  {
    pattern: /conflict|file changed|外部修改|冲突/i,
    message: '文件已被外部修改。你的编辑已保留，请重新读取文件并处理冲突。',
  },
  { pattern: /timeout|timed out|超时/i, message: '操作超时，请检查执行状态后再试。' },
  {
    pattern: /denied|unauthorized|forbidden|401|403|权限|凭据|拒绝访问/i,
    message: '访问被拒绝，请检查凭据或权限。',
  },
  {
    pattern: /network|connect|proxy|网络|连接|代理/i,
    message: '无法连接，请检查服务地址、代理和网络。',
  },
  { pattern: /invalid|无效|格式/i, message: '输入无效，请检查填写的内容。' },
] as const;

export function errorMessage(message: string, language: string): string {
  const clean = message.replace(/^Error:\s*/, '');
  if (Object.hasOwn(english, clean)) return language === 'en' ? english[clean] : clean;
  const translatedSource = sourceByEnglish.get(clean);
  if (translatedSource) return language === 'en' ? clean : translatedSource;
  const key =
    classifiedErrors.find(({ pattern }) => pattern.test(clean))?.message ??
    '操作未完成，请重试；若仍失败，可复制诊断信息排查。';
  return language === 'en' ? english[key] : key;
}
export function redactDiagnostic(message: string): string {
  return message
    .slice(0, 16000)
    .replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/gi, '$1[REDACTED]@')
    .replace(/(^\s*(?:Cookie|Set-Cookie)\s*:\s*).+$/gim, '$1[REDACTED]')
    .replace(/((?:Bearer|Basic)\s+)(?:"[^"]*"|'[^']*'|[^\s"']+)/gi, '$1[REDACTED]')
    .replace(/\bsk-[A-Za-z0-9_-]+/g, '[REDACTED]')
    .replace(
      /([?&](?:api[_-]?key|access[_-]?token|session[_-]?token|client[_-]?secret|token|password)=)[^&#\s]+/gi,
      '$1[REDACTED]',
    )
    .replace(
      /((?:["'])?(?:api[_-]?key|access[_-]?token|session[_-]?token|client[_-]?secret|authorization|password|token|secret)(?:["'])?\s*[=:]\s*)(["'])(?:\\.|(?!\2)[^\\])*\2/gi,
      '$1$2[REDACTED]$2',
    )
    .replace(
      /((?:["'])?(?:api[_-]?key|access[_-]?token|session[_-]?token|client[_-]?secret|authorization|password|token|secret)(?:["'])?\s*[=:]\s*)[^\s,;}&\#"']+/gi,
      '$1[REDACTED]',
    );
}
