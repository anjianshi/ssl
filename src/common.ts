import crypto from 'node:crypto'
import path from 'node:path'
import {
  logger,
  initLogger,
  FileHandler,
  type Logger,
} from '@anjianshi/utils/env-node/logging/index.js'
import acme from 'acme-client'

/**
 * ---------------------------
 * 初始化日志
 * ---------------------------
 */
export { logger as rootLogger }
export { Logger }

initLogger()
logger.setLevel('debug')

/** 开启文件日志 */
export function enableFileLogs(workDirectory: string) {
  logger.addHandler(
    new FileHandler({
      dir: path.join(workDirectory, 'logs'),
    }),
  )
}

/**
 * ---------------------------
 * 工具函数
 * ---------------------------
 */

export function sha256(value: string) {
  return crypto.createHash('sha256').update(value).digest('hex')
}

function hmac(algorithm: string, secret: string | Buffer, value: string): Buffer
function hmac(
  algorithm: string,
  secret: string | Buffer,
  value: string,
  digest: 'base64' | 'base64url' | 'hex' | 'binary',
): string
function hmac(
  algorithm: string,
  secret: string | Buffer,
  value: string,
  digest?: 'base64' | 'base64url' | 'hex' | 'binary',
) {
  const hmac = crypto.createHmac(algorithm, secret).update(value)
  return digest ? hmac.digest(digest) : hmac.digest()
}
export { hmac }

export async function getCertificateInfo(certificate: string) {
  return await acme.forge.readCertificateInfo(certificate)
}

/** 传入证书内容，返回证书涵盖的域名列表 */
export async function getDomainNames(certificate: string) {
  return (await acme.forge.readCertificateInfo(certificate)).domains.altNames
}

/** 判断证书是否包含目标域名 */
export function includeDomain(domainNames: string[], domain: string) {
  if (domainNames.includes(domain)) return true

  for (const domainName of domainNames) {
    const patternInner = domainName.replaceAll('.', '\\.').replaceAll('*', '[0-9a-zA-Z-]+?')
    const pattern = new RegExp(`^${patternInner}$`)
    if (pattern.test(domain)) return true
  }
  return false
}

/** 根据域名列表生成通用名称（例如用于文件名） */
export function getCommonNameFromDomainNames(domainNames: string[]) {
  return (domainNames[0] ?? '').replaceAll('*', '_')
}

/** 根据证书内容生成通用名称 */
export async function getCommonName(certificate: string) {
  const domainNames = await getDomainNames(certificate)
  return getCommonNameFromDomainNames(domainNames)
}
