export type ComponentId = 'speech' | 'qwen' | 'rag';
export const componentPresentation = {
  speech: { label: '轻量语音识别', description: '支持中文和英文，资源占用较低。' },
  qwen: { label: '多语言语音识别', description: '支持多种语言和标点，适合配置较高的电脑。' },
  rag: { label: '知识库检索', description: '从导入的资料中查找与问题相关的内容。' },
} as const;
export interface ComponentState {
  revision: number;
  phase:
    | 'checking'
    | 'needed'
    | 'downloading'
    | 'verifying'
    | 'removing'
    | 'ready'
    | 'cancelled'
    | 'error';
  error: string | null;
  removable?: boolean;
  items: {
    id: ComponentId;
    label: string;
    bytes: number;
    received: number;
    removable?: boolean;
    optional?: boolean;
    phase: 'pending' | 'checking' | 'downloading' | 'verifying' | 'removing' | 'ready';
  }[];
}
export type ComponentCall =
  | { op: 'status' | 'cancel' }
  | { op: 'download'; id?: ComponentId }
  | { op: 'remove'; id: ComponentId };

export function hasReadySpeechModel(state: ComponentState) {
  return state.items.some(
    (item) => (item.id === 'speech' || item.id === 'qwen') && item.phase === 'ready',
  );
}
