import { describe, expect, it } from 'vitest';
import { english } from '../locales/en';
import { errorMessage, redactDiagnostic } from './errors';

describe('actionable errors', () => {
  it('explains long storage paths without hiding the recovery step', () => {
    for (const raw of [
      '无法解析引擎数据目录：引擎数据目录过长，且无法取得 Windows 短路径。',
      '此磁盘未提供足够短的目录别名。',
    ]) {
      expect(errorMessage(raw, 'zh-CN')).toContain('较短路径');
      expect(errorMessage(raw, 'en')).toContain('shorter path');
      expect(errorMessage(raw, 'en')).not.toMatch(/[\u3400-\u9fff]/);
    }
  });

  it('preserves known errors when a form has already translated them', () => {
    const source = '副本需要单独设置密钥。';
    const translated = english[source];
    expect(errorMessage(source, 'en')).toBe(translated);
    expect(errorMessage(translated, 'en')).toBe(translated);
    expect(errorMessage(translated, 'zh-CN')).toBe(source);
  });

  it('distinguishes Git conflicts, damaged backups and provider failures', () => {
    expect(errorMessage('Git 操作遇到冲突，请检查冲突列表', 'en')).toContain('Git operation');
    expect(errorMessage('备份文件校验失败：snapshot.db', 'en')).toContain('Backup verification');
    expect(errorMessage('Disk full', 'zh-CN')).toContain('磁盘空间不足');
    expect(errorMessage('HTTP 429 Too Many Requests', 'en')).toContain('rate limiting');
    expect(errorMessage('HTTP 503 Service Unavailable', 'zh-CN')).toContain('模型服务');
    expect(errorMessage('The file changed on disk', 'en')).toContain('changed externally');
  });

  it('keeps provider overload distinct from a local connection failure', () => {
    const raw =
      'stream disconnected before completion: Our servers are currently overloaded. Please try again later.';
    expect(errorMessage(raw, 'zh-CN')).toBe('模型服务暂时不可用，请稍后重试。');
    expect(errorMessage(raw, 'en')).toBe(english['模型服务暂时不可用，请稍后重试。']);
    expect(errorMessage('stream disconnected: connection reset', 'zh-CN')).toContain('无法连接');
  });

  it('translates Windows file and opener failures without mixing UI languages', () => {
    const failures = [
      ['The system cannot find the file specified. (os error 2)', '文件不存在', 'no longer exists'],
      [
        'The process cannot access the file because it is being used by another process. (os error 32)',
        '正在被其他程序使用',
        'in use by another program',
      ],
      ['系统找不到指定的路径。 (os error 3)', '文件不存在', 'no longer exists'],
      ['拒绝访问。 (os error 5)', '访问被拒绝', 'Access denied'],
      ['无法使用系统默认应用打开文件：应用不可用', '无法使用系统默认应用打开文件', 'default app'],
    ] as const;
    for (const [raw, chinese, english] of failures) {
      expect(errorMessage(raw, 'zh-CN')).toContain(chinese);
      expect(errorMessage(raw, 'en')).toContain(english);
      expect(errorMessage(raw, 'en')).not.toMatch(/[\u3400-\u9fff]/);
      expect(errorMessage(raw, 'zh-CN')).not.toMatch(/[A-Za-z]{3,}/);
    }
  });
});

describe('copied diagnostics', () => {
  it('redacts headers, JSON, TOML, URL credentials and query parameters', () => {
    const diagnostic = [
      'Authorization: Bearer "quoted-header"',
      'Cookie: sid=cookie-secret; second=another-secret',
      '{"api_key":"json-secret\\"tail"}',
      "api_key = 'toml-secret'",
      'password = "password-secret"',
      'https://user:url-secret@example.test/v1?access_token=query-secret&safe=1',
      'client_secret=plain-secret',
    ].join('\n');
    const copied = redactDiagnostic(diagnostic);
    for (const secret of [
      'quoted-header',
      'cookie-secret',
      'another-secret',
      'json-secret',
      'tail',
      'toml-secret',
      'password-secret',
      'url-secret',
      'query-secret',
      'plain-secret',
    ]) {
      expect(copied).not.toContain(secret);
    }
    expect(copied).toContain('safe=1');
  });

  it('bounds copied output even for very long failures', () => {
    expect(redactDiagnostic('x'.repeat(20_000)).length).toBe(16_000);
  });
});
