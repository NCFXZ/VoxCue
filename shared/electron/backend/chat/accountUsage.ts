import type { AccountUsage } from '../../contracts/accountUsage';
import type { CodexUsagePort } from './codexUsage';
import { chatGPTAccountUsage, chatGPTPlan } from './quota';

export interface UsageIdentity {
  account: string;
  email: string;
  chatgptAccountId?: string;
}
/** Quotas always use the currently signed-in chat account; there is no second login. */
export class ChatGPTAccountUsage {
  constructor(
    private dependencies: { runtime: CodexUsagePort; identity(): Promise<UsageIdentity> },
  ) {}
  async read(): Promise<AccountUsage> {
    try {
      const identity = await this.dependencies.identity();
      const account = await this.dependencies.runtime.account();
      if (
        !account ||
        (identity.email && account.email.toLowerCase() !== identity.email.toLowerCase())
      )
        throw Error();
      const limits: any = await this.dependencies.runtime.limits();
      if (limits?.accountId && limits.accountId !== identity.chatgptAccountId) throw Error();
      if ((await this.dependencies.identity()).account !== identity.account) throw Error();
      const result = chatGPTAccountUsage(limits);
      if (result.plan === 'unknown') result.plan = chatGPTPlan(account.planType);
      return result;
    } catch {
      throw new Error('ChatGPT 账户额度暂不可用，请刷新或查看官方用量。');
    }
  }
}
