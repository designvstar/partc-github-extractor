# ScienceDirect Part C · GitHub 摘要提取

在 [ScienceDirect](https://www.sciencedirect.com) 的 *Transportation Research Part C: Emerging Technologies* **检索页**中，展开摘要、提取含 GitHub 的论文，合并写入本地 Markdown。

| 项目 | 说明 |
| --- | --- |
| 脚本文件 | `sciencedirect_partc_github_console.js` |
| 当前版本 | **1.5.12** |
| 运行方式 | [Tampermonkey / 篡改猴](https://www.tampermonkey.net/)（推荐 Edge / Chrome） |
| 仓库 | https://github.com/designvstar/partc-github-extractor |

---

## 1. Edge 必开权限（否则「已启用但未执行」）

油猴菜单若出现蓝条 **「请启用允许用户脚本」**，或 **「此脚本还未被执行」** / **「没有访问此页面的权限」**：

1. 打开 `edge://extensions`
2. **篡改猴** → **详细信息**
3. 打开 **允许用户脚本**
4. **网站访问权限** → **在所有站点上**（不要「单击时」）
5. 关掉 ScienceDirect 标签再重新打开（或 `Ctrl+F5`）

未开「允许用户脚本」时，脚本开关是绿色也**不会执行**。

---

## 2. 安装 / 更新

1. 安装 Tampermonkey  
2. 完成上一节权限  
3. 油猴 → **实用工具** → **从文件安装**，选择本仓库的 `.js`  
   或：新建脚本 → 粘贴全文 → 保存  
4. 确认脚本头为 `@version 1.5.12`  
5. 打开 **检索页**（URL 含 `/search`），右下角应出现面板  

**不会**在论文详情页运行，例如：  
`https://www.sciencedirect.com/science/article/pii/...`

更新：用新文件覆盖油猴脚本内容并保存，然后刷新检索页。

---

## 3. 功能概览

- **仅 `/search` 检索页**生效（`@match` + 运行时校验；排除 `/science/article/`）  
- 扫描结果卡片摘要中的 `github.com/...` 链接  
- **硬翻页**：按 `offset` / `show` 整页跳转，油猴自动再注入并续跑  
- 翻页后先等页面加载、结果稳定，再静置约 **8 秒** 后扫描  
- **单路扫描**：扫描锁 / 续跑锁，避免翻页后重复来回扫  
- 面板：拖动标题栏；右下角或 **+/−/重置** 调窗口宽高；**「—」最小化 / 「▢」还原**  
- Markdown：**合并去重**（保留旧记录 + 文末「本次新增」）  
- **清空面板**：只清界面，不改本地 MD  
- 翻页后若暂时无法写文件：结果暂存浏览器，点 **「立即合并写入」** 恢复权限  

### 关于 `offset`

例如 `show=50&offset=250`：每页 50 条，跳过前 250 条（约第 6 页）。面板只显示当前 offset/show，不作跳转按钮。

---

## 4. 推荐使用流程

1. 打开 Part C 检索页，确认能看到论文列表  
2. **绑定本地 MD**（打开已有文件可合并旧数据）  
3. **扫描本页**，或 **自动翻页扫描**（输入页数）  
4. 若提示权限：点一次 **立即合并写入**  
5. 需要时 **复制表格** / **下载 MD**；不看面板时点标题栏 **「—」** 最小化  

---

## 5. 面板按钮

| 按钮 | 作用 |
| --- | --- |
| — / ▢（标题栏） | 最小化 / 还原面板 |
| +/− / 重置 | 放大、缩小、重置**窗口尺寸**（不改字号） |
| 绑定本地 MD | 打开已有 md 或新建 |
| 立即合并写入 | 合并写回 md；翻页后也可用来恢复文件权限 |
| 下载 MD | 下载到浏览器下载目录 |
| 解绑 | 清除本地文件句柄绑定 |
| 扫描本页 | 展开摘要并提取 GitHub |
| 自动翻页扫描 | 从当前页起连续硬翻页扫描 |
| 继续自动翻页 | 验证码或中断后继续 |
| 复制表格 | 复制为可粘贴到 Excel 的文本 |
| 清空面板 | 只清空面板显示，不改 MD |

---

## 6. Markdown 输出格式

```markdown
# Transportation Research Part C · GitHub 论文汇总

- 最近更新: ...
- 累计条目: N
- 写入模式: 合并去重（保留旧记录）+ 文末追加本次新增

## 全部结果（合并表）

| # | 论文名称 | 论文链接 | GitHub代码链接 |
| --- | --- | --- | --- |
| 1 | ... | https://www.sciencedirect.com/... | https://github.com/... |

## 本次新增（...，+k）

| # | 论文名称 | 论文链接 | GitHub代码链接 |
| --- | --- | --- | --- |
| 1 | ... | ... | ... |
```

---

## 7. 常见问题

| 现象 | 处理 |
| --- | --- |
| 此脚本还未被执行 | 打开 Edge「允许用户脚本」+「在所有站点上」，重开标签 |
| 没有访问此页面的权限 | 同上；点一次油猴图标后再刷新 |
| 论文详情页没有面板 | 正常：脚本只匹配 `/search` |
| 翻页后又提示未绑定 MD | ≥1.5.7：点「立即合并写入」恢复权限 |
| 翻页后扫描来回乱跳 | ≥1.5.11：已加单路扫描锁 |
| Console 里 preload / Adobe | 站点日志，可忽略；过滤 `PartC` 看脚本日志 |

---

## 8. 推送更新到 GitHub

```powershell
Set-Location -LiteralPath "C:\Users\yang'wen'qi\Desktop\script"

git add README.md sciencedirect_partc_github_console.js
git commit -m "Update to v1.5.12: minimize panel, scan locks, search-only match"
git push origin main
```

远程：`https://github.com/designvstar/partc-github-extractor.git`  
不要提交 `__pycache__/`。
