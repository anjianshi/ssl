import child_process from 'node:child_process'
import { rootLogger } from '../common.js'
import { type SavedCertificate } from '../files/certificates.js'

export interface SSHConnectConfig {
  /** 服务器连接地址 */
  host: string

  /** SSH 端口 */
  port?: number

  /** 登录用户名 */
  username?: string

  /** 登录用的私钥文件 */
  identityFile?: string
}

export interface SSHDeployConfig extends SSHConnectConfig {
  /** 证书文件部署路径 */
  path: string

  /** 证书私钥文件部署路径 */
  keyPath: string

  /** 证书更新后要执行的 ssh 命令（例如重启 Nginx） */
  setupCommand?: string
}

const logger = rootLogger.getChild('deploy').getChild('ssh')

/**
 * 把证书通过 SSH 部署到服务器
 */
export async function deployBySSH(savedCertificate: SavedCertificate, config: SSHDeployConfig) {
  const certificateRes = await scp(savedCertificate.path, config.path, config)
  const certificateKeyRes = await scp(savedCertificate.keyPath, config.keyPath, config)
  if (!certificateRes || !certificateKeyRes) {
    logger.error('文件推送失败')
    return false
  }

  if (config.setupCommand) {
    const commandRes = await sshExecute(config.setupCommand, config)
    if (!commandRes) {
      logger.error('部署命令执行失败')
      return false
    }
  }

  return true
}

export async function scp(localPath: string, remotePath: string, config: SSHConnectConfig) {
  logger.info('SCP 推送文件', { local: localPath, remote: remotePath })

  const { host, port, username, identityFile } = config
  const hostString = username ? username + '@' + host : host

  let commandArguments = ''
  if (identityFile) commandArguments += ' -i ' + identityFile
  if (port !== undefined) commandArguments += ` -p ${port}`

  const command = `scp${commandArguments} "${localPath}" ${hostString}:"${remotePath}"`
  return execute(command)
}

export async function sshExecute(command: string, config: SSHConnectConfig) {
  logger.info('执行部署命令', { command })
  const { host, port, username, identityFile } = config

  let hostString = host
  if (port) hostString += `:${port}`
  if (username) hostString = username + '@' + hostString
  if (identityFile) hostString = '-i ' + identityFile + ' ' + hostString

  return execute(`ssh ${hostString} '${command.replaceAll("'", "\\'")}'`)
}

export async function execute(command: string) {
  return new Promise<boolean>(resolve => {
    const subprocess = child_process.spawn(command, { shell: true })
    const output: string[] = []
    subprocess.stdout.on('data', data => output.push(String(data)))
    subprocess.stderr.on('data', data => output.push(String(data)))
    subprocess.on('close', code => {
      const finalOutput = beautifyOutput(output.join(''))
      if (code === 0) {
        if (finalOutput) logger.debug(finalOutput)
        resolve(true)
      } else {
        logger.error(finalOutput || `命令执行失败，code=${code}`)
        resolve(false)
      }
    })
  })
}

function beautifyOutput(content: string) {
  return content.includes('\n') ? '\n' + content : content
}
