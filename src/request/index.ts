/**
 * 申请证书
 */
import { success, failed } from '@anjianshi/utils'
import acme from 'acme-client'
import { rootLogger } from '../common.js'
import { AliyunDNSChallenge } from './challenge-aliyun.js'
import { TencentCloudDNSChallenge } from './challenge-tencent-cloud.js'

// -----------------------------------
// 类型定义
// -----------------------------------

/** 创建新 CA 账号的参数 */
export interface CreateAccountConfig {
  email?: string
}

/** 支持的 DNS 服务提供商 */
export type DNSProvider = 'tencent-cloud' | 'aliyun'

/** DNS 验证配置 */
export interface DNSChallengeConfig {
  /** DNS 服务提供商 */
  provider: DNSProvider

  /** 服务商 OpenAPI 的 secretId */
  secretId: string

  /** 服务商 OpenAPI 的 secretKey */
  secretKey: string

  /** 域名记录的 ttl（需服务商支持） */
  ttl?: number
}

/**
 * CSR 配置
 * 已过时的属性（如 commonName 和 organization）未做支持
 */
export interface CSRConfig {
  /** 域名列表，即 SAN（Subject Alternative Name），详见 <https://letsencrypt.org/docs/glossary/#def-SAN> */
  domainNames: string[]

  /** 2 位国家代号，如 CN */
  country?: string

  /** 省、州名称  */
  province?: string

  /** 城市名 */
  city?: string

  /** 组织名 */
  organization?: string

  /** 电子邮箱 */
  email?: string

  /**
   * CSR 签名私钥
   * - 不传值：创建一个 2048 bits 长度的私钥
   * - 传入 number：创建指定 bits 长度的私钥
   */
  key?: number | string
}

// -----------------------------------
// 初始化环境
// -----------------------------------

const acmeLogger = rootLogger.getChild('acme')
acme.setLogger(message => acmeLogger.debug(message))

// -----------------------------------
// 创建 CSR
// -----------------------------------

export async function createCSR(config: CSRConfig) {
  const [certificateKey, csr] = await acme.crypto.createCsr({
    altNames: config.domainNames,
    country: config.country,
    state: config.province,
    locality: config.city,
    organization: config.organization,
    emailAddress: config.email,
    ...(typeof config.key === 'number' ? { keySize: config.key } : { keyPem: config.key }),
  })
  return { csr: csr.toString(), certificateKey: certificateKey.toString() }
}

// -----------------------------------
// 初始化 ACME Client 和 CA 账号
// -----------------------------------

/**
 * 用指定 accountKey 初始化 ACME Client
 * 注意：这里不会验证 accountKey 是否有效
 */
export function getAcmeClient(staging: boolean, accountKey: string) {
  const directoryUrl = staging
    ? acme.directory.letsencrypt.staging
    : acme.directory.letsencrypt.production
  return new acme.Client({ directoryUrl, accountKey })
}

/**
 * 创建新 CA 账号并返回用其初始化的 ACME Client
 */
export async function createAccount(staging: boolean, config?: CreateAccountConfig) {
  const accountKey = (await acme.crypto.createPrivateKey()).toString()
  const client = getAcmeClient(staging, accountKey)
  try {
    await client.createAccount({
      termsOfServiceAgreed: true,
      contact: config?.email ? [`mailto:${config.email}`] : [],
    })
  } catch (e) {
    return failed('创建 CA 账号失败', undefined, e as Error)
  }
  const accountUrl = client.getAccountUrl()
  return success({ client, accountKey, accountUrl })
}

// -----------------------------------
// 申请证书
// -----------------------------------

export async function challengeCertificate(
  client: acme.Client,
  csr: string,
  config: DNSChallengeConfig,
) {
  const ChallengeClass =
    config.provider === 'tencent-cloud' ? TencentCloudDNSChallenge : AliyunDNSChallenge
  const challengeHandler = new ChallengeClass(config.secretId, config.secretKey, config.ttl)
  try {
    const certificate = await client.auto({
      csr,
      challengePriority: ['dns-01'],
      challengeCreateFn: challengeHandler.setup,
      challengeRemoveFn: challengeHandler.cleanup,
    })
    return success(certificate)
  } catch (e) {
    return failed('域名验证失败', undefined, e as Error)
  }
}
