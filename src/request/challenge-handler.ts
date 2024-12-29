import { type MaySuccess, sleep } from '@anjianshi/utils'
import { type Authorization } from 'acme-client'
import type rfc8555 from 'acme-client/types/rfc8555.js'
import { rootLogger, type Logger } from '../common.js'
import type { DNSProvider } from './index.js'

/** 某个平台下的 DNS 操作实现  */
export interface ChallengeDNSActions {
  /** 确认指定域名是否可操作，并拆分出主域名和子域名 */
  confirmDomain: (domain: string) => Promise<ConfirmDomainResult>

  /**
   * 添加 DNS TXT 记录
   * mainName: 主域名，通常平台需要用这个值判定要操作那个域名的记录
   * challengeSubName: 记录添加到哪个子域名（这里的子域名已添加 ACME 验证所需的前缀）
   * txtValue: 记录值
   */
  addRecord: (mainName: string, challengeSubName: string, value: string) => Promise<unknown>

  /**
   * 移除 DNS TXT 记录
   * mainName: 主域名
   * challengeSubName: 移除哪个子域名下的记录（这里的子域名已添加 ACME 验证所需的前缀）
   * value: 记录值，只应移除与此值匹配的记录
   *
   * 返回值：成功返回 true，失败返回 false，未找到记录返回 null
   */
  deleteRecord: (
    mainName: string,
    challengeSubName: string,
    value: string,
  ) => Promise<boolean | null>
}

type ConfirmDomainResult = MaySuccess<{ mainName: string; subName: string }>

export class ChallengeHandler {
  readonly logger: Logger

  constructor(
    readonly provider: DNSProvider,
    readonly actions: ChallengeDNSActions,
  ) {
    this.logger = rootLogger.getChild('challenge/' + provider)
  }

  // 所有 DNS 操作放在队列里依次进行，不然像阿里云会报 LastOperationNotFinished 的错。
  // 并在两次操作间添加间隔，以避免因操作太频繁而失败。
  private actionQueue = Promise.resolve()
  protected async queueExecute(action: () => Promise<void>, interval = 500) {
    this.actionQueue = this.actionQueue.then(action).then(async () => sleep(interval))
    return this.actionQueue
  }

  // 缓存域名确认结果（仅记录成功的结果）
  private readonly domainCache = new Map<string, ConfirmDomainResult>()
  /** 确认域名信息 */
  protected async confirmDomain(domain: string) {
    if (this.domainCache.has(domain)) return this.domainCache.get(domain)!
    const res = await this.actions.confirmDomain(domain)
    this.domainCache.set(domain, res)
    return res
  }

  getChallengeSubName(subName: string) {
    return '_acme-challenge' + (subName.length ? '.' + subName : '')
  }

  setup = async (
    authorization: Authorization,
    chanllenge: rfc8555.Challenge,
    keyAuthorization: string,
  ) =>
    this.queueExecute(async () => {
      const domain = authorization.identifier.value
      const domainLogger = this.logger.getChild(domain)
      domainLogger.info('处理 DNS 验证', { authorization, chanllenge, keyAuthorization })

      const confirmRes = await this.confirmDomain(domain)
      if (!confirmRes.success) return domainLogger.error(confirmRes.message)
      const { mainName, subName } = confirmRes.data

      const challengeSubName = this.getChallengeSubName(subName)
      domainLogger.info('添加 DNS 记录', {
        mainName,
        subName: challengeSubName,
        value: keyAuthorization,
      })
      await this.actions.addRecord(mainName, challengeSubName, keyAuthorization)
    })

  cleanup = async (
    authorization: Authorization,
    chanllenge: rfc8555.Challenge,
    keyAuthorization: string,
  ) =>
    this.queueExecute(async () => {
      const domain = authorization.identifier.value
      const domainLogger = this.logger.getChild(domain)
      domainLogger.info('清理 DNS 验证信息', { authorization, chanllenge, keyAuthorization })

      const matchRes = await this.actions.confirmDomain(domain)
      if (!matchRes.success) return domainLogger.error(matchRes.message)
      const { mainName, subName } = matchRes.data

      const challengeSubName = this.getChallengeSubName(subName)
      domainLogger.info('移除 DNS 记录', {
        mainName,
        subName: challengeSubName,
        value: keyAuthorization,
      })
      const result = await this.actions.deleteRecord(mainName, challengeSubName, keyAuthorization)
      if (result === null) domainLogger.warn('未找到要移除的 DNS 记录')
      else if (!result) domainLogger.error('清理 DNS 验证信息失败', { domain, chanllenge })
    })
}
