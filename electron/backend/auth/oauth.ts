import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';
export const issuer = 'https://auth.openai.com';
export const authorizeEndpoint = `${issuer}/api/accounts/authorize`;
export const tokenEndpoint = `${issuer}/api/accounts/oauth/token`;
export const resource = 'https://api.openai.com/v1';
export const scopes =
  'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct';
export interface Transaction {
  state: string;
  nonce: string;
  verifier: string;
  redirectUri: string;
  clientId: string;
  subject?: string;
  hostId: string;
  email?: string;
}
export function createTransaction(
  redirectUri: string,
  hostId: string,
  clientId = 'dynamic_agent_client',
  subject?: string,
  email?: string,
): Transaction {
  return {
    redirectUri,
    hostId,
    clientId,
    subject,
    email,
    state: randomBytes(32).toString('base64url'),
    nonce: randomBytes(32).toString('base64url'),
    verifier: randomBytes(48).toString('base64url'),
  };
}
export function authorizationURL(transaction: Transaction) {
  const params = new URLSearchParams({
    client_id: transaction.clientId,
    ext_agent_host_id: transaction.hostId,
    response_type: 'code',
    redirect_uri: transaction.redirectUri,
    scope: scopes,
    resource,
    state: transaction.state,
    nonce: transaction.nonce,
    code_challenge_method: 'S256',
    code_challenge: createHash('sha256').update(transaction.verifier).digest('base64url'),
  });
  if (transaction.clientId === 'dynamic_agent_client')
    params.set('agent_name_hint', 'AI Interview Copilot');
  else if (transaction.email) params.set('login_hint', transaction.email);
  return `${authorizeEndpoint}?${params}`;
}
export function validateCallback(url: URL, transaction: Transaction) {
  for (const key of ['state', 'code', 'client_id', 'error']) {
    if (url.searchParams.getAll(key).length > 1)
      throw new Error('登录回调包含重复参数，请重新登录。');
  }
  const returned = url.searchParams.get('state') || '';
  const expected = Buffer.from(transaction.state);
  const received = Buffer.from(returned);
  if (received.length !== expected.length || !timingSafeEqual(received, expected))
    throw new Error('登录回调校验失败，请重新登录。');
  if (url.searchParams.has('error')) throw new Error('未完成 ChatGPT 授权，请重试。');
  const clientId =
    url.searchParams.get('client_id') ||
    (transaction.clientId !== 'dynamic_agent_client' ? transaction.clientId : '');
  if (!/^oaiapp_[A-Za-z0-9_-]+$/.test(clientId)) throw new Error('登录注册未完成，请重新登录。');
  if (transaction.clientId !== 'dynamic_agent_client' && transaction.clientId !== clientId)
    throw new Error('登录注册信息不匹配，请重试。');
  const code = url.searchParams.get('code');
  if (!code || code.length > 8192) throw new Error('未收到有效授权码，请重新登录。');
  return { code, clientId };
}
const jwks = createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`), {
  timeoutDuration: 10000,
});
export async function verifyIdentity(
  idToken: string,
  clientId: string,
  nonce: string,
  key: JWTVerifyGetKey = jwks,
) {
  const { payload } = await jwtVerify(idToken, key, {
    issuer,
    audience: clientId,
    requiredClaims: ['sub', 'exp', 'iat', 'nonce'],
    algorithms: ['RS256', 'ES256'],
    clockTolerance: 5,
  });
  if (payload.nonce !== nonce || !payload.sub || payload.exp! * 1000 <= Date.now())
    throw new Error('登录身份校验失败，请重新登录。');
  return {
    subject: payload.sub,
    name: typeof payload.name === 'string' ? payload.name : 'ChatGPT 用户',
    email: typeof payload.email === 'string' ? payload.email : '',
    expiresAt: payload.exp! * 1000,
  };
}
