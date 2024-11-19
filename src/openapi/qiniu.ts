import { success, failed, stringifyQuery } from '@anjianshi/utils'
import { rootLogger, hmac } from '../common.js'

const logger = rootLogger.getChild('qiniu')

export interface APIOptions {
  accessKey: string
  secretKey: string
  method?: string
  path: string
  query?: Record<string, unknown>
  data?: Record<string, unknown>
}

// https://developer.qiniu.com/fusion/4243/access-to-the
export async function API<T>(options: APIOptions) {
  logger.debug('调用开放接口', JSON.stringify(options))

  const { method: inputMethod, accessKey, secretKey, path, query, data } = options

  const host = 'api.qiniu.com'

  const method = inputMethod?.toUpperCase() ?? 'GET'
  const queryString = stringifyQuery((query ?? {}) as Record<string, string>)
  const body = data ? JSON.stringify(data) : undefined
  const headers: Record<string, string> = {
    'X-Qiniu-Date': new Date()
      .toISOString()
      .replace(/\.\d+/, '')
      .replaceAll('-', '')
      .replaceAll(':', ''),
  }
  if (method !== 'GET') headers['Content-Type'] = 'application/json'
  const accessToken = getAccessToken({
    accessKey,
    secretKey,
    path,
    query: queryString,
  })
  headers.Authorization = `QBox ${accessToken}`

  const url = `https://${host}${path}${queryString ? '?' + queryString : ''}`
  try {
    const request = await fetch(url, { method, headers, body })
    if (request.status === 200) {
      const data = (await request.json()) as T
      logger.debug(`${path} 请求成功`, JSON.stringify(data))
      return success(data)
    } else {
      logger.error({ options, response: (await request.json()) as unknown })
      return failed('七牛云 API 请求失败')
    }
  } catch (error) {
    logger.error('请求失败', { options, error })
    return failed('七牛云 API 请求失败')
  }
}

/**
 * 生成 API accessToken
 * 参考 https://developer.qiniu.com/kodo/6671/historical-document-management-certificate
 */
export function getAccessToken(options: {
  accessKey: string
  secretKey: string
  path: string
  query?: string
}) {
  const { accessKey, secretKey, path, query } = options

  let signingStr = path
  if (query) signingStr += '?' + query
  signingStr += '\n'

  const sign = hmac('sha1', secretKey, signingStr, 'base64')
  const encodedSign = sign.replaceAll('/', '_').replace('+', '-')
  const accessToken = accessKey + ':' + encodedSign
  return accessToken
}
