/**
 * 实现腾讯云上的 DNS 操作
 */
import { success, failed, formatSuccess } from '@anjianshi/utils'
import { API as rawAPI, type APIOptions as RawAPIOptions } from '../openapi/tencent-cloud.js'
import { type ChallengeDNSActions } from './challenge-handler.js'

interface DomainCountInfo {
  DomainTotal: number // 符合条件的域名数量
  AllTotal: number // 用户可以查看的所有域名数量
}

interface DomainListItem {
  DomainId: number
  Name: string
  Status: 'ENABLE' | 'PAUSE' | 'SPAM'
  DNSStatus: 'DNSERROR' | ''
}

async function API<T>(options: Omit<RawAPIOptions, 'service' | 'version'>) {
  return rawAPI<T>({ ...options, service: 'dnspod', version: '2021-03-23' })
}

export class TencentCloudDNSActions implements ChallengeDNSActions {
  constructor(
    readonly secretId: string,
    readonly secretKey: string,
    readonly ttl = 600,
  ) {}

  async confirmDomain(domain: string) {
    const domainsRes = await this.getDomains()
    if (!domainsRes.success) return domainsRes

    const matched = domainsRes.data.find(item => domain.endsWith(item.Name))
    if (!matched) return failed('DNS 服务中没有匹配的域名')
    if (matched.Status !== 'ENABLE') return failed('域名在 DNS 服务中未启用')
    if (matched.DNSStatus !== '') return failed('域名未正确绑定 DNS 服务')

    const mainName = matched.Name
    const subName = domain === mainName ? '' : domain.slice(0, -(mainName.length + 1))
    return success({ mainName, subName })
  }

  /** 返回腾讯云 DNS 上可管理的域名列表 */
  protected async getDomains() {
    const res = await API<{ DomainCountInfo: DomainCountInfo; DomainList: DomainListItem[] }>({
      secretId: this.secretId,
      secretKey: this.secretKey,
      action: 'DescribeDomainList',
    })
    return formatSuccess(res, data => data.DomainList)
  }

  // -----------------------------

  async addRecord(mainName: string, challengeSubName: string, value: string) {
    return API({
      secretId: this.secretId,
      secretKey: this.secretKey,
      action: 'CreateRecord',
      data: {
        Domain: mainName,
        RecordType: 'TXT',
        RecordLine: '默认',
        Value: value,
        SubDomain: challengeSubName,
        TTL: this.ttl,
      },
    })
  }

  // -----------------------------

  async deleteRecord(mainName: string, challengeSubName: string, value: string) {
    const recordsRes = await this.getRecords(mainName, challengeSubName)
    if (!recordsRes.success)
      return recordsRes.code === 'ResourceNotFound.NoDataOfRecord' ? null : false

    const matchedRecord = recordsRes.data.RecordList.find(item => item.Value === value)
    if (!matchedRecord) return null

    const deleteRes = await API({
      secretId: this.secretId,
      secretKey: this.secretKey,
      action: 'DeleteRecord',
      data: {
        Domain: mainName,
        RecordId: matchedRecord.RecordId,
      },
    })
    return deleteRes.success
  }

  protected async getRecords(mainName: string, challengeSubName: string) {
    return API<{
      RecordCountInfo: { ListCount: number }
      RecordList: { RecordId: string; Value: string | null }[]
    }>({
      secretId: this.secretId,
      secretKey: this.secretKey,
      action: 'DescribeRecordList',
      data: {
        Domain: mainName,
        Subdomain: challengeSubName,
        RecordType: 'TXT',
      },
      ignoreCodes: ['ResourceNotFound.NoDataOfRecord'],
    })
  }
}
