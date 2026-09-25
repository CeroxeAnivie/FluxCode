import { expect, it } from 'vitest';
import { nativeDialogText } from './nativeDialog';

it('uses the selected app language for native picker text', () => {
  expect(nativeDialogText('en-US')).toEqual({
    documents: 'Documents',
    openDocument: 'Open document',
    exportDocument: 'Export document',
    openProject: 'Open project',
    addAttachments: 'Add files or images',
  });
  expect(nativeDialogText('zh-CN')).toEqual({
    documents: '文档',
    openDocument: '打开文档',
    exportDocument: '导出文档',
    openProject: '打开项目',
    addAttachments: '添加文件或图片',
  });
  expect(nativeDialogText('EN-gb').openProject).toBe('Open project');
});
