import { rootLogger, getDomainNames, includeDomain } from '../common.js'
import { type SavedCertificate } from '../files/certificates.js'
import { API } from '../openapi/tencent-cloud.js'

const logger = rootLogger.getChild('deploy').getChild('tencent-cloud')

interface CDNDetail {
  Domain: string // CDN 访问域名
  Cname: string // 对应到腾讯云的 cname 域名
  Https: CDNHTTPSDetail | null
}
interface CDNHTTPSDetail {
  Switch: 'on' | 'off' | null // 是否开启 HTTPS 访问
  CertInfo: CDNCertificateInfo | null
}
interface CDNCertificateInfo {
  CertId: string // 证书 ID
  ExpireTime: string // 过期时间 '2025-02-12 00:25:34'
}

/**
 * 把证书部署到腾讯云 CDN
 */
export async function deployToTenCentCloud(
  savedCertificate: SavedCertificate,
  secretId: string,
  secretKey: string,
) {
  logger.info('上传证书...')
  const uploadRes = await API<{ CertificateId: string }>({
    secretId,
    secretKey,
    service: 'ssl',
    action: 'UploadCertificate',
    version: '2019-12-05',
    data: {
      CertificatePublicKey: savedCertificate.certificate,
      CertificatePrivateKey: savedCertificate.certificateKey,
      Alias: `deploy-${Date.now()}`,
      Repeatable: false,
    },
  })
  if (!uploadRes.success) {
    logger.error('上传证书失败', uploadRes)
    return false
  }
  const certificateId = uploadRes.data.CertificateId
  logger.info('证书已上传', { certificateId })

  logger.info('查询 CDN 列表...')
  const cdnListRes = await API<{ Domains: CDNDetail[] }>({
    secretId,
    secretKey,
    service: 'cdn',
    action: 'DescribeDomainsConfig',
    version: '2018-06-06',
    data: {
      Limit: 1000,
    },
  })
  if (!cdnListRes.success) {
    logger.error('CDN 列表获取失败', cdnListRes)
    return false
  }

  const domainNames = await getDomainNames(savedCertificate.certificate)
  const matchedCdnList = cdnListRes.data.Domains.filter(
    v =>
      includeDomain(domainNames, v.Domain) &&
      v.Https?.Switch === 'on' &&
      v.Https.CertInfo?.CertId !== certificateId,
  )
  if (!matchedCdnList.length) {
    logger.info('没有需要更新的 CDN 域名')
    return true
  }

  const matchedDomains = matchedCdnList.map(v => v.Domain)
  logger.info('待部署 CDN 域名：', matchedDomains)

  const deployRes = await API<{ DeployStatus: 1 | 0 }>({
    secretId,
    secretKey,
    service: 'ssl',
    action: 'DeployCertificateInstance',
    version: '2019-12-05',
    data: {
      CertificateId: certificateId,
      InstanceIdList: matchedDomains,
      ResourceType: 'cdn',
    },
  })
  if (!deployRes.success) {
    logger.error('部署到 CDN 域名失败', deployRes)
    return false
  } else if (deployRes.data.DeployStatus !== 1) {
    logger.error('部署到 CDN 域名失败', deployRes.data)
    return false
  }

  logger.info('部署到 CDN 域名成功')
  return true
}
