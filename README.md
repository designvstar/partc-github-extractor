# ScienceDirect Part C · GitHub 摘要提取

文件：`sciencedirect_partc_github_console.js`（v1.5.4）

## 关键：Edge 必须打开「允许用户脚本」

油猴菜单若出现蓝条 **「请启用允许用户脚本」**，或提示 **「此脚本还未被执行」**，按下面做：

1. 点油猴弹出菜单顶部的 **蓝条**，或打开 `edge://extensions`
2. 找到 **篡改猴 / Tampermonkey** → **详细信息**
3. 打开 **允许用户脚本**（Allow user scripts）
4. 确认 **网站访问权限** = **在所有站点上**
5. 回到 ScienceDirect 检索页，**关闭标签再重新打开**（或 Ctrl+F5）

未打开该开关时，脚本开关是绿的也 **不会执行**。

## 安装

1. 安装 [Tampermonkey](https://www.tampermonkey.net/)
2. 完成上一节的 Edge 权限
3. 油猴 → 实用工具 → 从文件安装本 `.js`（或粘贴全文）→ 保存为 **1.5.4**
4. 打开 Part C 检索页，右下角应出现面板

## 功能

- 扫描摘要中的 GitHub 链接；油猴 **硬翻页** 自动续跑
- 面板可拖动、右下角缩放、+/- 调字号
- MD：**合并追加**（先读旧文件再写）；「清空面板」不改 MD 文件

## 面板操作

绑定本地 MD → 扫描本页 / 自动翻页扫描 → 结果写入 md
