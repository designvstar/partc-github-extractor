# ScienceDirect Part C · GitHub 摘要提取

在 [ScienceDirect](https://www.sciencedirect.com) 的 *Transportation Research Part C* **检索页**中，展开摘要、提取含 GitHub 的论文，合并写入本地 Markdown。

| 项目 | 说明 |
| --- | --- |
| 主脚本（油猴） | **`sciencedirect_partc_github.user.js`**（必须用 `.user.js` 后缀） |
| 当前版本 | **1.5.13** |
| 运行方式 | [Tampermonkey / 篡改猴](https://www.tampermonkey.net/) |
| 仓库 | https://github.com/designvstar/partc-github-extractor |

---

## 1. Edge 必开权限

1. `edge://extensions` → **篡改猴** → **详细信息**
2. 打开 **允许用户脚本**
3. **网站访问权限** → **在所有站点上**
4. 重开 ScienceDirect 检索页标签

---

## 2. 安装脚本

### 方式 A：从 GitHub Raw / jsDelivr 安装（推荐，可自动更新）

在浏览器打开（任选其一，国内优先 jsDelivr）：

```text
https://cdn.jsdelivr.net/gh/designvstar/partc-github-extractor@main/sciencedirect_partc_github.user.js
```

或：

```text
https://raw.githubusercontent.com/designvstar/partc-github-extractor/main/sciencedirect_partc_github.user.js
```

油猴会弹出安装页 → **安装**。

### 方式 B：本地文件安装

油猴 → **实用工具** → **从文件安装** → 选择仓库里的 `sciencedirect_partc_github.user.js`。

安装后确认 `@version` 为 **1.5.13**，且仅在 URL 含 `/search` 的页面出现面板（不含 `/science/article/` 论文页）。

---

## 3. 绑定仓库自动更新（Tampermonkey）

脚本头部已包含：

```js
// @version      1.5.13
// @updateURL    https://cdn.jsdelivr.net/gh/designvstar/partc-github-extractor@main/sciencedirect_partc_github.user.js
// @downloadURL  https://cdn.jsdelivr.net/gh/designvstar/partc-github-extractor@main/sciencedirect_partc_github.user.js
```

### 油猴界面

1. 打开该脚本 → **设置**
2. 勾选 **检查更新**
3. **更新 URL** 填入上面的 jsDelivr 地址（或 Raw 地址）
4. **保存** → 可点 **检查用户脚本的更新** 测试

> 更新 URL 必须是 **源码直链**，不能是仓库主页或 Release 页。

### 国内访问

`raw.githubusercontent.com` 常不稳定，**推荐 jsDelivr**：

```text
https://cdn.jsdelivr.net/gh/designvstar/partc-github-extractor@main/sciencedirect_partc_github.user.js
```

### 发版流程（维护者）

1. 改代码  
2. **上调** `@version`（如 `1.5.13` → `1.5.14`），版本不变则油猴认为无更新  
3. `git push` 到 `main`（仓库需公开）  
4. 油猴定时拉取；或手动「检查更新」  

jsDelivr 有短缓存，刚 push 后若检测不到，等一两分钟或换 Raw 测一次。

---

## 4. 功能概览

- 仅 `/search` 检索页；排除论文详情页  
- 摘要中提取 GitHub 链接；硬翻页自动续跑  
- 翻页后等结果稳定再静置约 8 秒再扫；单路扫描锁防来回扫  
- 面板：拖动、+/− 改窗口大小、「—」最小化  
- MD 合并去重写入；清空面板不改 MD；翻页后可点「立即合并写入」恢复权限  

`offset` / `show`：分页参数（如 `offset=250&show=50` 表示约第 6 页），面板仅显示状态。

---

## 5. 面板按钮

| 按钮 | 作用 |
| --- | --- |
| — / ▢ | 最小化 / 还原 |
| +/− / 重置 | 调整窗口宽高 |
| 绑定本地 MD | 打开或新建 md |
| 立即合并写入 | 合并写回；也可恢复文件权限 |
| 下载 MD / 解绑 | 下载或解除绑定 |
| 扫描本页 / 自动翻页扫描 / 继续自动翻页 | 扫描与续跑 |
| 复制表格 / 清空面板 | 复制；清空仅界面 |

---

## 6. 推送更新到 GitHub

```powershell
Set-Location -LiteralPath "C:\Users\yang'wen'qi\Desktop\script"

git add README.md sciencedirect_partc_github.user.js
git add -u sciencedirect_partc_github_console.js
git commit -m "Add .user.js with jsDelivr @updateURL for Tampermonkey auto-update (v1.5.13)"
git push origin main
```

若已删除旧的 `sciencedirect_partc_github_console.js`，用 `git add -A` 时注意不要提交 `__pycache__/`。

---

## 7. 常见问题

| 现象 | 处理 |
| --- | --- |
| 黄色警告：没有有效更新链接 | 填写 Raw/jsDelivr 直链并保存 |
| 检查更新失败 | 换 jsDelivr；确认仓库公开、分支为 `main` |
| 推送后不更新 | 必须上调 `@version`；等待 CDN 缓存 |
| 论文页没有面板 | 正常，仅 search 页运行 |
