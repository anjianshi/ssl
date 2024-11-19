/**
 * 实现腾讯云解析的域名的 DNS 验证
 */
import { success, failed, getRandomInt, sleep } from '@anjianshi/utils'
import { type Authorization } from 'acme-client'
import type rfc8555 from 'acme-client/types/rfc8555.js'
import { rootLogger } from '../common.js'
import { API as rawAPI, type APIOptions as RawAPIOptions } from '../openapi/tencent-cloud.js'

const logger = rootLogger.getChild('challenge/tencent-cloud')

export class TencentCloudDNSChallenge {
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
    // 保证前一次记录添加完成后才添加下一条记录
    this.setupQueue = this.setupQueue
      .then(async () => this.setupKernal(authorization, chanllenge, keyAuthorization))
      .then(async () => sleep(500)) // 两次操作间增加 500ms 间隔
    return this.setupQueue
  }
  private setupQueue = Promise.resolve()
  setupKernal = async (
    authorization: Authorization,
    chanllenge: rfc8555.Challenge,
    keyAuthorization: string,
  ) => {
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
      action: 'CreateRecord',
      data: {
        Domain: mainName,
        RecordType: 'TXT',
        RecordLine: '默认',
        Value: keyAuthorization,
        SubDomain: this.getChallengeSubdomain(subName),
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

    const matched = listRes.data.find(item => domain.endsWith(item.Name))
    if (!matched) return failed('DNS 服务中没有匹配的域名')
    if (matched.Status !== 'ENABLE') return failed('域名在 DNS 服务中未启用')
    if (matched.DNSStatus !== '') return failed('域名未正确绑定 DNS 服务')

    const domainId = matched.DomainId
    const mainName = matched.Name
    const subName = domain === mainName ? '' : domain.slice(0, -(mainName.length + 1))
    return success({ domainId, mainName, subName })
  }

  /** 返回腾讯云 DNS 上可管理的域名列表 */
  protected async getDomains() {
    if (this.domains) return success(this.domains)

    const res = await API<{ DomainCountInfo: DomainCountInfo; DomainList: DomainListItem[] }>({
      secretId: this.secretId,
      secretKey: this.secretKey,
      action: 'DescribeDomainList',
    })
    if (!res.success) return res

    this.domains = res.data.DomainList
    return success(this.domains)
  }
  protected domains: DomainListItem[] | null = null

  protected async clearRecords(mainName: string, subDomain: string) {
    const domainLogger = logger.getChild(subDomain + (subDomain ? '.' : '') + mainName)

    const result = await this.getRecords(mainName, subDomain)
    if (result.success) {
      const count = result.data.RecordCountInfo.ListCount
      if (count >= 1) {
        const recordId = result.data.RecordList[0]!.RecordId
        await API({
          secretId: this.secretId,
          secretKey: this.secretKey,
          action: 'DeleteRecord',
          data: {
            Domain: mainName,
            RecordId: recordId,
          },
        })
      }
    } else if (result.code === 'ResourceNotFound.NoDataOfRecord') {
      domainLogger.info('域名没有 DNS 记录')
    }
  }

  protected async getRecords(mainName: string, subDomain: string) {
    return API<{
      RecordCountInfo: { ListCount: number }
      RecordList: { RecordId: string }[]
    }>({
      secretId: this.secretId,
      secretKey: this.secretKey,
      action: 'DescribeRecordList',
      data: {
        Domain: mainName,
        Subdomain: this.getChallengeSubdomain(subDomain),
        RecordType: 'TXT',
      },
      ignoreCodes: ['ResourceNotFound.NoDataOfRecord'],
    })
  }

  getChallengeSubdomain(subDomain: string) {
    return '_acme-challenge' + (subDomain.length ? '.' + subDomain : '')
  }
}

export interface DomainCountInfo {
  DomainTotal: number // 符合条件的域名数量
  AllTotal: number // 用户可以查看的所有域名数量
}

export interface DomainListItem {
  DomainId: number
  Name: string
  Status: 'ENABLE' | 'PAUSE' | 'SPAM'
  DNSStatus: 'DNSERROR' | ''
}

async function API<T>(options: Omit<RawAPIOptions, 'service' | 'version'>) {
  return rawAPI<T>({ ...options, service: 'dnspod', version: '2021-03-23' })
}
