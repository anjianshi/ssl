/**
 * 实现阿里云上的 DNS 操作
 */
import { success, failed, formatSuccess } from '@anjianshi/utils'
import { API as rawAPI, type APIOptions as RawAPIOptions } from '../openapi/aliyun.js'
import { type ChallengeDNSActions } from './challenge-handler.js'

interface DomainListItem {
  DomainId: string
  DomainName: string
}

async function API<T>(options: Omit<RawAPIOptions, 'endpoint' | 'apiVersion'>) {
  const endpoint = 'alidns.cn-hangzhou.aliyuncs.com'
  const apiVersion = '2015-01-09'
  return rawAPI<T>({ ...options, endpoint, apiVersion })
}

export class AliyunDNSActions implements ChallengeDNSActions {
  constructor(
    readonly secretId: string,
    readonly secretKey: string,
    readonly ttl = 600,
  ) {}

  async confirmDomain(domain: string) {
    const domainsRes = await this.getDomains()
    if (!domainsRes.success) return domainsRes

    const matched = domainsRes.data.find(item => domain.endsWith(item.DomainName))
    if (!matched) return failed('DNS 服务中没有匹配的域名')

    const mainName = matched.DomainName
    const subName = domain === mainName ? '' : domain.slice(0, -(mainName.length + 1))
    return success({ mainName, subName })
  }

  /** 返回阿里云 DNS 上可管理的域名列表 */
  protected async getDomains() {
    const res = await API<{ Domains: { TotalCount: number; Domain: DomainListItem[] } }>({
      secretId: this.secretId,
      secretKey: this.secretKey,
      action: 'DescribeDomains',
      params: {
        PageSize: 100,
      },
    })
    return formatSuccess(res, data => data.Domains.Domain)
  }

  // -------------------

  async addRecord(mainName: string, challengeSubName: string, value: string) {
    return API({
      secretId: this.secretId,
      secretKey: this.secretKey,
      action: 'AddDomainRecord',
      params: {
        DomainName: mainName,
        RR: challengeSubName,
        Type: 'TXT',
        Value: value,
        TTL: this.ttl,
      },
    })
  }

  // -------------------

  async deleteRecord(mainName: string, challengeSubName: string, value: string) {
    const recordsRes = await this.getRecords(mainName, challengeSubName)
    if (!recordsRes.success) return false

    const matchedRecord = recordsRes.data.DomainRecords.Record.find(
      v => v.RR === challengeSubName && v.Value === value,
    )
    if (!matchedRecord) return null

    const deleteRes = await API({
      secretId: this.secretId,
      secretKey: this.secretKey,
      action: 'DeleteDomainRecord',
      params: {
        RecordId: matchedRecord.RecordId,
      },
    })
    return deleteRes.success
  }

  protected async getRecords(mainName: string, challengeSubName: string) {
    return API<{
      DomainRecords: {
        Record: { RecordId: string; RR: string; Value: string }[]
      }
    }>({
      secretId: this.secretId,
      secretKey: this.secretKey,
      action: 'DescribeDomainRecords',
      params: {
        DomainName: mainName,
        RRKeyWord: challengeSubName,
        TypeKeyWord: 'TXT',
        PageSize: 100,
      },
    })
  }
}
