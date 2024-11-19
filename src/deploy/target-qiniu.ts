import { sleep } from '@anjianshi/utils'
import { rootLogger, getCertificateInfo, includeDomain } from '../common.js'
import { type SavedCertificate } from '../files/certificates.js'
import { API } from '../openapi/qiniu.js'

const logger = rootLogger.getChild('deploy').getChild('qiniu')

interface CertificateInfo {
  certid: string
  name: string // 自定义证书名
  dnsnames: string[] // 证书包含的域名列表 ['*.abc.com', 'abc.com']
  not_after: number // 证书到期时间，秒级时间戳
}

interface DomainInfo {
  name: string // 访问域名 'abc.com'
  cname: string // 七牛云侧对应的 cname 域名 'abc.qiniudns.com'
  protocol: 'http' | 'https' // 是否开启了 HTTPS 访问
}

interface DomainDetail extends DomainInfo {
  https: {
    certId: string
  }
}

/**
 * 把证书部署到七牛云
 * https://developer.qiniu.com/fusion/8593/interface-related-certificate
 *
 */
export async function deployToQiniu(
  savedCertificate: SavedCertificate,
  accessKey: string,
  secretKey: string,
) {
  const info = await getCertificateInfo(savedCertificate.certificate)

  logger.info('获取已上传证书列表...')
  const uploadedRes = await API<{
    certs: CertificateInfo[]
  }>({
    accessKey,
    secretKey,
    path: '/sslcert',
  })
  if (!uploadedRes.success) return logger.error('获取证书列表失败', uploadedRes)
  const uploadedCertificates = uploadedRes.data.certs

  let certificateId: string
  let certificateName: string
  const dnsnames = info.domains.altNames.join(',')
  const notAfter = Math.floor(info.notAfter.valueOf() / 1000)
  const existsCertificate = uploadedCertificates.find(
    v => v.dnsnames.join(',') === dnsnames && v.not_after === notAfter,
  )
  if (existsCertificate) {
    certificateId = existsCertificate.certid
    certificateName = existsCertificate.name
    logger.info('证书已存在，跳过上传', { certificateId })
  } else {
    logger.info('上传证书...')
    certificateName = `deploy-${Date.now()}`
    const uploadRes = await API<{ certID: string }>({
      accessKey,
      secretKey,
      method: 'POST',
      path: '/sslcert',
      data: {
        name: certificateName,
        common_name: info.domains.commonName,
        pri: savedCertificate.certificateKey,
        ca: savedCertificate.certificate,
      },
    })
    if (!uploadRes.success) {
      logger.error('上传证书失败', uploadRes)
      return false
    }
    certificateId = uploadRes.data.certID
    logger.info('证书上传成功', { certificateId })
  }

  logger.info('获取域名列表...')
  const domainsRes = await API<{ domains: DomainInfo[] }>({
    accessKey,
    secretKey,
    path: '/domain',
  })
  if (!domainsRes.success) {
    logger.error('域名列表获取失败', domainsRes)
    return false
  }

  const domainsToDeploy = domainsRes.data.domains.filter(
    v => v.protocol === 'https' && includeDomain(info.domains.altNames, v.name),
  )
  if (!domainsToDeploy.length) {
    logger.info('没有待部署的域名')
    return true
  }

  let allSuccess = true
  for (const domain of domainsToDeploy) {
    logger.info(`获取域名详情：${domain.name}...`)
    const detailRes = await API<DomainDetail>({
      accessKey,
      secretKey,
      path: '/domain/' + domain.name,
    })
    if (!detailRes.success) {
      logger.error(`获取域名详情失败：${domain.name}`, detailRes)
      allSuccess = false
      continue
    }
    const detail = detailRes.data
    if (detail.https.certId === certificateId) {
      logger.info('域名已使用目标证书，跳过')
      continue
    }

    const deployRes = await API({
      accessKey,
      secretKey,
      method: 'PUT',
      path: `/domain/${domain.name}/httpsconf`,
      data: {
        certId: certificateId,
      },
    })
    if (!deployRes.success) {
      logger.error(`域名设置证书失败：${domain.name}`, deployRes)
      allSuccess = false
    } else {
      logger.info(`域名设置成功：${domain.name}`)
    }
  }

  const expiredCertificates = uploadedCertificates.filter(
    v => v.not_after <= Math.ceil(Date.now() / 1000),
  )
  if (expiredCertificates.length) {
    for (const qiniuCertificate of expiredCertificates) {
      logger.info('移除过期证书 ' + qiniuCertificate.name, {
        domainNames: qiniuCertificate.dnsnames,
      })
      const res = await API({
        accessKey,
        secretKey,
        method: 'DELETE',
        path: '/sslcert/' + qiniuCertificate.certid,
      })
      if (!res.success) logger.error('移除证书失败', res)
      else logger.info('移除证书成功')
      await sleep(1000)
    }
  }

  return allSuccess
}
