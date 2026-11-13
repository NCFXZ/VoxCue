// Fixed local storage failure messages for existing error responses. Raw native,
// transport and filesystem errors must never become renderer-facing messages.
export const credentialProblemMessages = {
  VOXCUE_CREDENTIAL_UNAVAILABLE:
    'macOS 凭据操作未完成，登录信息保持原样；已停止重复请求，请重新启动 VoxCue 后重试。',
  VOXCUE_CREDENTIAL_TIMEOUT:
    'macOS 钥匙串授权等待已超时，已停止重复请求。如系统密码框仍显示，请在该框中选择“拒绝”，然后重新启动 VoxCue。',
  VOXCUE_CREDENTIAL_CONFLICT:
    'macOS 钥匙串中存在冲突的 VoxCue 登录条目，已停止操作。请退出 VoxCue，在“钥匙串访问”中检查并恢复原条目后重新启动；不要删除不确定归属的条目。',
  VOXCUE_CREDENTIAL_LOCKED:
    'macOS 登录钥匙串已锁定，已停止操作。请退出 VoxCue，在“钥匙串访问”中手动解锁登录钥匙串后重新启动。VoxCue 不会收集钥匙串密码。',
  VOXCUE_CREDENTIAL_INVALID_DATA: '本地登录资料无法读取，请重新登录；原资料保持不变。',
} as const;
export type CredentialProblemCode = keyof typeof credentialProblemMessages;

function isCredentialProblemCode(value: unknown): value is CredentialProblemCode {
  return typeof value === 'string' && Object.hasOwn(credentialProblemMessages, value);
}

export function credentialProblemCode(error: unknown): CredentialProblemCode | undefined {
  if (!error || typeof error !== 'object') return;
  // Do not invoke arbitrary getters while sanitizing an error.
  const code = Object.getOwnPropertyDescriptor(error, 'code')?.value;
  return isCredentialProblemCode(code) ? code : undefined;
}
