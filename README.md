# 一站式 SSL 申请、部署解决方案

## 功能

### 申请证书

通过 [Let's Encrypt](https://letsencrypt.org/) 申请免费的 SSL 证书，有效期三个月，支持通配符（wildcard）。  
支持对接 `腾讯云` 和 `阿里云` 的域名解析功能完成 SSL 证书的 DNS 验证（HTTP 验证方式不支持 wildcard 证书，未做支持）。

### 部署证书

1. 通过 SSH 部署到服务器
2. 通过 API 部署到云服务：
   - 腾讯云
   - 阿里云
   - 七牛云

### 定期更新

可以配置 crontab 定期运行。

---

## 证书申请步骤

1. 创建 CA 账号，例如 [Let's Encrypt](https://letsencrypt.org/) 的。CA 要基于账号来控制请求频率。
2. 生成用于给 [CSR](https://letsencrypt.org/docs/glossary/#def-CSR) 签名的秘钥。
3. 提供 CSR 信息（证书域名、证书申请者等），配合上一步的秘钥，生成 CSR。
4. 用给定的方式完成域名验证。[各验证方式流程](https://letsencrypt.org/docs/challenge-types/)。
5. 生成证书

---

## var/ 目录文件结构

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
config.json
```
