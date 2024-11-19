import { sleep } from '@anjianshi/utils'
import { rootLogger, getCertificateInfo, includeDomain } from '../common.js'
import { type SavedCertificate } from '../files/certificates.js'
import { API } from '../openapi/aliyun.js'

const logger = rootLogger.getChild('deploy').getChild('aliyun')

interface AliyunResourceInfo {
  Id: number // 云产品资源 ID
  Domain: string // CDN 访问域名，如 cdn.abc.com
  EnableHttps: 1 | 0 // 是否开启了 HTTPS 访问
  CertName: string // 当前绑定的证书的证书名
  CertId: number // 当前绑定的 HTTPS 证书 ID
  CertStartTime: string // 当前绑定的证书的生效时间 '1730787995000'
  CertEndTime: string // 当前绑定的证书的过期时间 '1730787995000'
  GmtCreate: string // 资源创建时间
  GmtModified: string // 资源最近修改时间
  Status: 'online' | 'offline' // 云产品资源状态
  UserId: number // 用户 ID
  CloudName: 'aliyun'
  CloudProduct: 'CDN'
}

interface AliyunCertificateInfo {
  // 阿里云相关信息
  CertificateId: number
  InstanceId: string // 证书实例名 'cas-upload-gm56k5'
  ResourceGroupId: string
  Name: string // 证书名称
  Status: AliyunCertificateStatus
  Expired: boolean // 是否已过期
  Upload: boolean // 是否是用户自行上传的证书

  // 证书自身信息
  Issuer: string // 证书签发机构 "Let's Encrypt"
  CommonName: string // 证书 common name，'abc.com'
  Sans: string // 证书域名列表 '*.abc.com,abc.com'
  StartDate: string // 证书生效时间 '2024-11-12'
  EndDate: string // 过期时间 '2025-02-10'
  Country: string
  Province: string
  City: string
  OrgName: string
  Fingerprint: string
  SerialNo: string
  Sha2: string
}
enum AliyunCertificateStatus {
  待申请 = 'PAYED',
  审核中 = 'CHECKING',
  审核失败 = 'CHECKED_FAIL',
  已签发 = 'ISSUED',
  即将过期 = 'WILLEXPIRED',
  已过期 = 'EXPIRED',
  未激活 = 'NOTACTIVATED',
  吊销完成 = 'REVOKED',
}

/**
 * 把证书部署到阿里云 CDN
 * https://help.aliyun.com/zh/ssl-certificate/developer-reference/api-cas-2020-04-07-overview?spm=a2c4g.11186623.help-menu-28533.d_4_3_0.212d4cd8nB9BmZ
 */
export async function deployToAliyun(
  savedCertificate: SavedCertificate,
  secretId: string,
  secretKey: string,
) {
  const info = await getCertificateInfo(savedCertificate.certificate)

  logger.info('获取已上传证书列表...')
  const uploadedRes = await API<{
    TotalCount: number
    CertificateOrderList: AliyunCertificateInfo[]
  }>({
    secretId,
    secretKey,
    endpoint: 'cas.aliyuncs.com',
    apiVersion: '2020-04-07',
    action: 'ListUserCertificateOrder',
    params: {
      OrderType: 'UPLOAD',
      ShowSize: 500,
    },
  })
  if (!uploadedRes.success) return logger.error('获取证书列表失败', uploadedRes)
  const uploadedCertificates = uploadedRes.data.CertificateOrderList

  let certificateId: number
  let certificateName: string
  const sans = info.domains.altNames.join(',')
  const endDate = info.notAfter.toISOString().split('T')[0]!
  const existsCertificate = uploadedCertificates.find(v => v.Sans === sans && v.EndDate === endDate)
  if (existsCertificate) {
    certificateId = existsCertificate.CertificateId
    certificateName = existsCertificate.Name
    logger.info('证书已存在，跳过上传', { certificateId })
  } else {
    logger.info('上传证书...')
    certificateName = `deploy-${Date.now()}`
    const uploadRes = await API<{ CertId: number }>({
      secretId,
      secretKey,
      endpoint: 'cas.aliyuncs.com',
      apiVersion: '2020-04-07',
      action: 'UploadUserCertificate',
      params: {
        Name: certificateName,
        Cert: savedCertificate.certificate,
        Key: savedCertificate.certificateKey,
      },
    })
    if (!uploadRes.success) {
      logger.error('上传证书失败', uploadRes)
      return false
    }
    certificateId = uploadRes.data.CertId
    logger.info('证书上传成功', { certificateId })
  }

  logger.info('查询 CDN 列表...')
  const resourcesRes = await API<{ Data: AliyunResourceInfo[] }>({
    secretId,
    secretKey,
    endpoint: 'cas.aliyuncs.com',
    apiVersion: '2020-04-07',
    action: 'ListCloudResources',
    params: {
      CloudName: 'aliyun',
      CloudProduct: 'CDN',
      ShowSize: 500,
    },
  })
  if (!resourcesRes.success) {
    logger.error('CDN 列表获取失败', resourcesRes)
    return false
  }

  const domainNames = info.domains.altNames
  const matchedResources = resourcesRes.data.Data.filter(
    v => v.EnableHttps && includeDomain(domainNames, v.Domain) && v.CertId !== certificateId,
  )
  if (!matchedResources.length) {
    logger.info('没有待部署的 CDN 域名')
    return true
  }

  const matchedDomains = matchedResources.map(v => v.Domain)
  logger.info('待部署 CDN 域名：', matchedDomains)
  let allSuccess = true
  for (const domain of matchedDomains) {
    logger.info(`正在部署：`, domain)
    const deployRes = await API<{ RequestId: string }>({
      secretId,
      secretKey,
      endpoint: 'cdn.aliyuncs.com',
      apiVersion: '2018-05-10',
      action: 'SetCdnDomainSSLCertificate',
      params: {
        DomainName: domain,
        SSLProtocol: 'on',
        CertType: 'cas',
        CertId: certificateId,
        CertName: certificateName,
      },
    })
    if (!deployRes.success) {
      logger.error('部署 CDN 证书失败', deployRes)
      allSuccess = false
    }
  }

  const expiredCertificates = uploadedCertificates.filter(v => v.Expired)
  if (expiredCertificates.length) {
    for (const aliyunCertificate of expiredCertificates) {
      logger.info('移除过期证书 ' + aliyunCertificate.Name, { domainNames: aliyunCertificate.Sans })
      const res = await API({
        secretId,
        secretKey,
        endpoint: 'cas.aliyuncs.com',
        apiVersion: '2020-04-07',
        action: 'DeleteUserCertificate',
        params: {
          CertId: aliyunCertificate.CertificateId,
        },
      })
      if (!res.success) logger.error('移除证书失败', res)
      else logger.info('移除证书成功')
      await sleep(1000)
    }
  }

  return allSuccess
}
