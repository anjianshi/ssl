/**
 * 实现阿里云解析的域名的 DNS 验证
 */
import { success, failed, getRandomInt, sleep } from '@anjianshi/utils'
import { type Authorization } from 'acme-client'
import type rfc8555 from 'acme-client/types/rfc8555.js'
import { rootLogger } from '../common.js'
import { API as rawAPI, type APIOptions as RawAPIOptions } from '../openapi/aliyun.js'

const logger = rootLogger.getChild('challenge/aliyun')

export class AliyunDNSChallenge {
  constructor(
    readonly secretId: string,
    readonly secretKey: string,
    readonly ttl = 600,
  ) {}

  setup = async (
    authorization: Authorization,
    chanllenge: rfc8555.Challenge,
    keyAuthorization: string,
  ) => {
    // 保证前一次记录添加完成后才添加下一条记录，不然阿里云会报 LastOperationNotFinished 的错
    this.setupQueue = this.setupQueue
      .then(async () => this.setupKernal(authorization, chanllenge, keyAuthorization))
      .then(async () => sleep(500)) // 两次操作间增加 500ms 间隔
    return this.setupQueue
  }
  private setupQueue = Promise.resolve()
  private async setupKernal(
    authorization: Authorization,
    chanllenge: rfc8555.Challenge,
    keyAuthorization: string,
  ) {
    const domain = authorization.identifier.value
    const domainLogger = logger.getChild(domain)
    domainLogger.info('处理 DNS 验证', { authorization, chanllenge, keyAuthorization })

    const matchRes = await this.matchDomain(domain)
    if (!matchRes.success) return domainLogger.error(matchRes.message)
    const { mainName, subName } = matchRes.data

    domainLogger.info('清理原有 DNS 记录')
    await this.clearRecords(mainName, subName)

    domainLogger.info('新增 DNS 记录')
    await API({
      secretId: this.secretId,
      secretKey: this.secretKey,
      action: 'AddDomainRecord',
      params: {
        DomainName: mainName,
        RR: this.getChallengeSubdomain(subName),
        Type: 'TXT',
        Value: keyAuthorization,
        TTL: this.ttl,
      },
    })
  }

  cleanup = async (authorization: Authorization, chanllenge: rfc8555.Challenge) => {
    await sleep(getRandomInt(0, 2000)) // 避免出现“操作过于频繁”的问题

    const domain = authorization.identifier.value
    const domainLogger = logger.getChild(domain)

    const matchRes = await this.matchDomain(domain)
    if (!matchRes.success) return domainLogger.error(matchRes.message)
    const { mainName, subName } = matchRes.data

    domainLogger.info('清理 DNS 验证信息', { domain, chanllenge })
    await this.clearRecords(mainName, subName)
  }

  // --------------------------------------------------

  /** 找到域名列表里与目标域名匹配的域名 */
  protected async matchDomain(domain: string) {
    const listRes = await this.getDomains()
    if (!listRes.success) return listRes

    const matched = listRes.data.find(item => domain.endsWith(item.DomainName))
    if (!matched) return failed('DNS 服务中没有匹配的域名')

    const domainId = matched.DomainId
    const mainName = matched.DomainName
    const subName = domain === mainName ? '' : domain.slice(0, -(mainName.length + 1))
    return success({ domainId, mainName, subName })
  }

  /** 返回阿里云 DNS 上可管理的域名列表 */
  protected async getDomains() {
    if (this.domains) return success(this.domains)

    const res = await API<{ Domains: { TotalCount: number; Domain: DomainListItem[] } }>({
      secretId: this.secretId,
      secretKey: this.secretKey,
      action: 'DescribeDomains',
      params: {
        PageSize: 100,
      },
    })
    if (!res.success) return res

    this.domains = res.data.Domains.Domain
    return success(this.domains)
  }
  protected domains: DomainListItem[] | null = null

  protected async clearRecords(mainName: string, subDomain: string) {
    const result = await this.getRecords(mainName, subDomain)
    if (!result.success) return result

    const records = result.data.DomainRecords.Record.filter(
      v => v.RR === this.getChallengeSubdomain(subDomain),
    )
    if (records.length >= 1) {
      const recordId = records[0]!.RecordId
      await API({
        secretId: this.secretId,
        secretKey: this.secretKey,
        action: 'DeleteDomainRecord',
        params: {
          RecordId: recordId,
        },
      })
    }
  }

  protected async getRecords(mainName: string, subDomain: string) {
    return API<{
      DomainRecords: {
        Record: { RecordId: string; RR: string }[]
      }
    }>({
      secretId: this.secretId,
      secretKey: this.secretKey,
      action: 'DescribeDomainRecords',
      params: {
        DomainName: mainName,
        RRKeyWord: this.getChallengeSubdomain(subDomain),
        TypeKeyWord: 'TXT',
        PageSize: 100,
      },
    })
  }

  getChallengeSubdomain(subDomain: string) {
    return '_acme-challenge' + (subDomain.length ? '.' + subDomain : '')
  }
}

interface DomainListItem {
  DomainId: string
  DomainName: string
}

async function API<T>(options: Omit<RawAPIOptions, 'endpoint' | 'apiVersion'>) {
  const endpoint = 'alidns.cn-hangzhou.aliyuncs.com'
  const apiVersion = '2015-01-09'
  return rawAPI<T>({ ...options, endpoint, apiVersion })
}
