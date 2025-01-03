/**
 * 执行证书申请、更新任务
 */
import acme from 'acme-client'
import _ from 'lodash'
import { type Logger, rootLogger, getCommonNameFromDomainNames } from './common.js'
import { deployCertificate } from './deploy/index.js'
import {
  confirmWorkDirectory,
  getSavedAccount,
  saveAccount,
  getSavedCertificate,
  saveCertificate,
  getConfig,
  type Config,
  type CertificateConfig,
} from './files/index.js'
import { getAcmeClient, createAccount, createCSR, challengeCertificate } from './request/index.js'

const mainLogger = rootLogger.getChild('task')

/**
 * 执行任务
 * inputWorkDirectory: 指定工作目录，未指定则使用当前目录
 * confirmOnly: 若为 true 则只确认工具能否正常运行，不实际申请和部署证书
 */
export async function runTask(inputWorkDirectory?: string, confirmOnly = false) {
  const { resolved: workDirectory, isValid: isValidWorkDirectory } = await confirmWorkDirectory(
    inputWorkDirectory ?? process.cwd(),
  )
  if (!isValidWorkDirectory) {
    mainLogger.error('当前目录找不到 config.json，运行失败：' + workDirectory)
    return
  }
  mainLogger.info('工作目录：' + workDirectory)

  if (!confirmOnly) mainLogger.info('开始申请、更新证书')
  const config = await getConfig(workDirectory)
  if (!config) return
  const accountKey = await initializeAccount(workDirectory, config)
  if (!accountKey) return

  if (confirmOnly) return
  for (const certificateConfig of config.certificates) {
    await maintainCertificate(workDirectory, config.staging, accountKey, certificateConfig)
  }
}

/** 初始化 CA 账号 */
async function initializeAccount(workDirectory: string, config: Config) {
  const { staging } = config

  if (typeof config.account === 'string') {
    mainLogger.info('使用配置文件指定的 CA 账号')
    return config.account
  }

  const savedAccount = await getSavedAccount(workDirectory, staging)
  if (savedAccount) {
    mainLogger.info('使用已存在的 CA 账号')
    return savedAccount
  }

  const res = await createAccount(staging, config.account)
  if (res.success) {
    const { accountKey, accountUrl } = res.data
    await saveAccount(workDirectory, config.staging, accountKey)
    mainLogger.info(`新建 CA 账号${staging ? '(staging)' : ''}`, { accountUrl })
    return accountKey
  } else {
    mainLogger.error(res.message, res.data)
    return null
  }
}

/** 处理单个证书 */
async function maintainCertificate(
  workDirectory: string,
  staging: boolean,
  accountKey: string,
  certificateConfig: CertificateConfig,
) {
  const { domainNames } = certificateConfig.csr

  const commonName = getCommonNameFromDomainNames(domainNames)
  const logger = rootLogger.getChild('task').getChild(commonName)

  // 申请证书
  let savedCertificate = await getSavedCertificate(workDirectory, staging, domainNames)
  if (!savedCertificate || (await confirmShouldRenew(logger, savedCertificate.certificate))) {
    logger.info(`申请证书${staging ? '(staging)' : ''}`, domainNames)

    const { csr, certificateKey } = await createCSR(certificateConfig.csr)
    logger.info('CSR 已生成', _.omit(certificateConfig.csr, 'key'))

    logger.info('开始验证域名')
    const client = getAcmeClient(staging, accountKey)
    const challengeRes = await challengeCertificate(client, csr, certificateConfig.challenge)
    if (!challengeRes.success) {
      logger.error(challengeRes.message, challengeRes.data)
      return null
    }
    const certificate = challengeRes.data
    logger.info('证书申请成功', domainNames)
    savedCertificate = await saveCertificate(
      workDirectory,
      staging,
      domainNames,
      certificate,
      certificateKey,
    )
  }

  // 部署证书
  if (staging) return logger.info('测试环境，跳过部署')
  if (!certificateConfig.targets.length) return logger.info('未指定部署目标，跳过部署')
  for (let i = 0; i < certificateConfig.targets.length; i++) {
    const target = certificateConfig.targets[i]!

    const targetLogger = logger.getChild(`target-${i}`)
    targetLogger.info(`部署证书（${target.type}）...`)

    const result = await deployCertificate(savedCertificate, target)
    if (result) targetLogger.info(`部署完成（${target.type}）`)
    else logger.error(`部署失败（${target.type}）`)
  }
}

/** 确认已有证书是否需要更新 */
async function confirmShouldRenew(logger: Logger, certificate: string) {
  const safeDuration = 30 * 24 * 60 * 60 * 1000 // 不更新有效期大于一个月的证书
  const info = await acme.forge.readCertificateInfo(certificate)
  const expiresTime = info.notAfter
  if (expiresTime.getTime() - Date.now() > safeDuration) {
    logger.info('证书已存在，且有效期大于一个月，无需更新', info)
    return false
  } else {
    return true
  }
}
