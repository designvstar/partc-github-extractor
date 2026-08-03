# ScienceDirect Part C · GitHub 摘要提取

浏览器脚本：在 [ScienceDirect](https://www.sciencedirect.com) 的 *Transportation Research Part C: Emerging Technologies* 检索结果页中，展开摘要、找出含 GitHub 链接的论文，汇总为表格，并**自动写入本地 Markdown 文件**。

文件：`sciencedirect_partc_github_console.js`

## 功能

- 扫描当前检索页摘要中的 `github.com/...` 链接
- 自动翻页（按 URL 的 `offset` / `show` 递增）
- 面板实时表格：论文名称、论文链接、GitHub 链接
- 绑定本地 `.md` 后，每次扫描自动覆盖保存
- 遇人机验证时暂停，需手动完成后再继续

默认起点示例（可改）：

```
https://www.sciencedirect.com/search?pub=Transportation%20Research%20Part%20C%3A%20Emerging%20Technologies&cid=271729&years=2026&sortBy=relevance&show=50&offset=250
```

## 使用方式

### 方式 A：控制台粘贴（免扩展）

1. 用 **Chrome / Edge** 打开上述检索页（先完成登录 / 验证）
2. 按 `F12` → **Console**
3. 粘贴 `sciencedirect_partc_github_console.js` **全文**，回车
4. 右下角出现面板后操作（见下）

### 方式 B：油猴 / Tampermonkey

1. 安装 [Tampermonkey](https://www.tampermonkey.net/)
2. 在扩展设置里，把 **网站访问权限** 设为「所有网站」（或至少允许 `sciencedirect.com`）  
   若菜单显示「没有访问此页面的权限」，脚本不会运行
3. 仪表盘 → 新建脚本 / 从文件安装 → 导入本 `.js` → 保存
4. 打开 ScienceDirect 检索页并刷新，右下角应出现面板

## 面板操作

| 按钮 | 说明 |
| --- | --- |
| **绑定本地 MD** | 选择/创建本机 `.md`（如 `partc_github_papers.md`）。之后扫描会自动写入 |
| **立即写入 MD** | 手动把当前结果写回已绑定文件 |
| **下载 MD** | 未绑定时，下载到浏览器「下载」目录 |
| **解绑** | 解除本地文件绑定 |
| **扫描本页** | 展开摘要并提取 GitHub |
| **自动翻页扫描** | 从当前页起连续扫描多页 |
| **继续自动翻页** | 验证码打断后从此页继续 |
| **打开 offset=250** | 跳到内置默认起始 URL |
| **复制表格** | 复制为可粘贴到 Excel 的制表符文本 |
| **清空** | 清空结果，并覆盖写入空表（若已绑定） |

## 输出 Markdown 格式

```markdown
# Transportation Research Part C · GitHub 论文汇总

| # | 论文名称 | 论文链接 | GitHub代码链接 |
| --- | --- | --- | --- |
| 1 | ... | https://www.sciencedirect.com/... | https://github.com/... |
```

## 说明与限制

- 网页脚本**不能**在未授权时静默写入任意磁盘路径；须先「绑定本地 MD」（Chrome File System Access API），或改用「下载 MD」。
- 翻页、文件句柄会借助浏览器存储做短暂状态恢复；**论文结果以本地 MD 为准**。
- ScienceDirect 页面结构若改版，选择器可能失效，需更新脚本。
- 请遵守站点使用条款与机构访问规定；本工具仅辅助人工检索整理。

## 版本

当前脚本版本见文件头 `@version`（如 `1.2.0`）。
