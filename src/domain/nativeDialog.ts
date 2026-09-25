export function nativeDialogText(language: string) {
  return language.trim().toLowerCase().split('-')[0] === 'en'
    ? {
        documents: 'Documents',
        openDocument: 'Open document',
        exportDocument: 'Export document',
        openProject: 'Open project',
        addAttachments: 'Add files or images',
      }
    : {
        documents: '文档',
        openDocument: '打开文档',
        exportDocument: '导出文档',
        openProject: '打开项目',
        addAttachments: '添加文件或图片',
      };
}
