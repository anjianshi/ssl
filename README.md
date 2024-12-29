# 一站式申请、部署 SSL 证书

## 功能

### 申请证书

通过 [Let's Encrypt](https://letsencrypt.org/) 申请免费的 SSL 证书，有效期三个月，支持通配符（wildcard）。  
支持对接 `腾讯云` 和 `阿里云` 的域名解析功能完成 SSL 证书的 DNS 验证（HTTP 验证方式不支持 wildcard 证书，未做支持）。

### 部署证书

支持以下部署方式：

1. 通过 SSH 部署到服务器
2. 通过 API 部署到云服务：
   - 腾讯云
   - 阿里云
   - 七牛云

### 定期更新

可以配置 crontab 定期运行。

---

## 使用方法

1. 新建一个工作目录，用来存放配置文件和申请得到的证书
2. 建立配置文件（`config.json5` 或 `config.json`），包含 DNS 验证配置、部署目标等内容
3. 在工作目录下执行 `npx @anjianshi/ssl@latest`，或在任意位置执行 `npx @anjianshi/ssl@latest --work-directory=工作目录路径`
4. 也可执行 `npx @anjianshi/ssl@latest confirm` 来确认配置文件和工作目录是否正常，但并不执行证书申请和部署

---

## 工作目录文件结构

```yaml
# 日志
logs/

# 已生成的证书
certificates/
  ${first_domain}-${san_hash}/
    fullchain.pem # 证书内容
    privkey.pem # 证书私钥

# 自动创建的 CA 账号的信息（优先使用 config.json 里的 account 配置）
account.json

# 功能配置，例如要签发证书的域名列表
config.json5
```

---

## 配置文件格式

配置文件支持 JSON5 或者标准的 JSON 格式，分别使用 `config.json5` 和 `config.json` 作为文件名。

```typescript
interface Config {
  // 通过 Let's Encrypt 的正式环境还是测试环境来申请证书
  // 为 true 代表走测试环境，此时证书申请成功后，不会执行部署
  // 默认为 false
  staging?: boolean

  // 指定已有 Let's Encrypt 账号的私钥（string），或创建新账号所需的信息（CreateAccountConfig）
  // 若不指定，则会创建一个不指定邮箱的新账号（多次运行只会创建一次）
  account?: string | CreateAccountConfig

  // 预定义的证书验证配置
  // 例如多个域名的 DNS 解析都挂在同一个腾讯云账号下，则可以把此账号的 API 凭证定义在这里，然后在这些域名的证书配置里引用
  challenges?: Record<string, DNSChallengeConfig>

  // 预定义的部署配置
  // 例如多个证书都要部署到同一个服务器上，可以把服务器信息定义在这里，然后在这些证书的部署配置里引用
  targets?: Record<string, TargetPreset>

  // 证书配置
  certificates: CertificateConfig[]
}

interface CreateAccountConfig {
  email?: string
}

interface DNSChallengeConfig {
  provider: 'tencent-cloud' | 'aliyun' // DNS 服务提供商
  secretId: string // 服务商 OpenAPI 的 secretId
  secretKey: string // 服务商 OpenAPI 的 secretKey
  ttl?: number // 域名记录的 ttl（需服务商支持）
}
```

TODO: 待补充

---

## 证书申请步骤

1. 创建 CA 账号，例如 [Let's Encrypt](https://letsencrypt.org/) 的。CA 要基于账号来控制请求频率。
2. 生成用于给 [CSR](https://letsencrypt.org/docs/glossary/#def-CSR) 签名的秘钥。
3. 提供 CSR 信息（证书域名、证书申请者等），配合上一步的秘钥，生成 CSR。
4. 用给定的方式完成域名验证。[各验证方式流程](https://letsencrypt.org/docs/challenge-types/)。
5. 生成证书
