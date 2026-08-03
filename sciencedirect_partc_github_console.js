// ==UserScript==
// @name         ScienceDirect Part C GitHub Extractor
// @namespace    https://local.partc.github/
// @version      1.5.7
// @description  Part C GitHub extractor (Tampermonkey). Requires Edge "Allow user scripts".
// @author       local
// @match        *://www.sciencedirect.com/*
// @match        *://*.sciencedirect.com/*
// @match        https://www.sciencedirect.com/search*
// @grant        window.onurlchange
// @grant        unsafeWindow
// @run-at       document-end
// ==/UserScript==

/**
 * 推荐：用油猴安装本脚本（翻页/刷新后会自动再注入）。
 * MD：写入前先读旧文件 → 合并去重 → 写回完整表，并在文末追加「本次新增」。
 */
(() => {
  "use strict";
  try {
    console.info("[PartC GitHub] script start", location.href, "GM_info=", typeof GM_info);
  } catch (_) {}

  const GITHUB_RE =
    /https?:\/\/(?:www\.)?github\.com\/[A-Za-z0-9_.\-]+\/[A-Za-z0-9_.\-]+(?:\/[^\s)\]"'<>]*)?/gi;
  const GITHUB_BARE_RE =
    /(?:^|[\s(\["'])((?:www\.)?github\.com\/[A-Za-z0-9_.\-]+\/[A-Za-z0-9_.\-]+)/gi;
  const STATE_KEY = "sd_partc_github_auto_v2";
  const HITS_BACKUP_KEY = "sd_partc_hits_backup_v1";
  const MD_BOUND_FLAG = "sd_partc_md_bound_v1";
  const IDB_NAME = "sd_partc_github_fs";
  const IDB_STORE = "handles";
  const DEFAULT_MD_NAME = "partc_github_papers.md";
  const IS_TM = typeof GM_info !== "undefined";

  /** @type {{title:string,paperUrl:string,githubUrl:string,pageOffset?:string,snippet?:string,_key?:string}[]} */
  let hits = [];
  /** @type {FileSystemFileHandle|null} */
  let mdHandle = null;
  let mdFileName = "";
  /** 翻页后权限可能暂时不可用（无用户手势） */
  let mdPermissionOk = false;
  /** 最近一次相对文件的新增条数 */
  let lastAppended = 0;

  if (!/sciencedirect\.com/i.test(location.hostname)) {
    alert("请在 www.sciencedirect.com 检索页运行");
    return;
  }

  const normalizeGithub = (u) => {
    u = String(u || "").trim().replace(/[)\].,;:}>"']+$/g, "");
    if (/^github\.com\//i.test(u)) u = "https://" + u;
    return u;
  };
  const extractGithub = (text) => {
    if (!text) return [];
    const found = [];
    let m;
    GITHUB_RE.lastIndex = 0;
    while ((m = GITHUB_RE.exec(text))) found.push(normalizeGithub(m[0]));
    GITHUB_BARE_RE.lastIndex = 0;
    while ((m = GITHUB_BARE_RE.exec(text))) {
      const raw = m[1];
      found.push(normalizeGithub(raw.startsWith("http") ? raw : "https://" + raw));
    }
    const seen = new Set();
    const out = [];
    for (const u of found) {
      const k = u.toLowerCase().replace(/\/$/, "");
      if (!k.includes("github.com") || seen.has(k)) continue;
      seen.add(k);
      out.push(u);
    }
    return out;
  };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const currentOffset = () => Number(new URL(location.href).searchParams.get("offset") || 0);
  const currentShow = () => Number(new URL(location.href).searchParams.get("show") || 50);
  const urlWithOffset = (offset) => {
    const u = new URL(location.href);
    u.searchParams.set("offset", String(offset));
    if (!u.searchParams.get("show")) u.searchParams.set("show", "50");
    return u.toString();
  };
  const looksLikeCaptcha = () => {
    const low = (
      document.title +
      " " +
      ((document.body && document.body.innerText) || "").slice(0, 3000)
    ).toLowerCase();
    return /captcha|are you a robot|verify you are human|just a moment|checking your browser|access denied/.test(
      low
    );
  };

  const resultCards = () => {
    const byLi = [...document.querySelectorAll("li.ResultItem")];
    if (byLi.length) return byLi;
    const links = [
      ...document.querySelectorAll(
        "a.result-list-title-link, a[href*='/science/article/pii/'], h2 a[href*='/science/article']"
      ),
    ];
    const cards = [];
    const seen = new Set();
    for (const a of links) {
      const card = a.closest("li") || a.closest("article") || a.parentElement;
      if (!card || seen.has(card)) continue;
      seen.add(card);
      cards.push(card);
    }
    return cards;
  };
  const titleLinkOf = (card) =>
    card.querySelector("a.result-list-title-link") ||
    card.querySelector("h2 a[href*='/science/article']") ||
    card.querySelector("a[href*='/science/article/pii/']");

  async function expandAbstract(card) {
    const btn = [...card.querySelectorAll("button, a")].find((el) =>
      /abstract|preview/i.test((el.getAttribute("aria-label") || "") + " " + (el.textContent || ""))
    );
    if (btn) {
      try {
        btn.click();
        await sleep(700);
      } catch {}
    }
  }
  const abstractText = (card) => {
    let best = "";
    for (const n of card.querySelectorAll(
      ".Abstracts, .abstract, [class*='Abstract'], [data-testid='abstract'], .result-item-content"
    )) {
      const t = (n.innerText || "").trim();
      if (t.length > best.length) best = t;
    }
    return best || (card.innerText || "").trim();
  };

  function hitKey(row) {
    return `${row.title.toLowerCase()}|${row.paperUrl.replace(/\/$/, "").toLowerCase()}|${row.githubUrl
      .replace(/\/$/, "")
      .toLowerCase()}`;
  }
  const pushHit = (row) => {
    const key = hitKey(row);
    if (hits.some((h) => h._key === key)) return false;
    row._key = key;
    hits.push(row);
    return true;
  };

  function escapeMdCell(s) {
    return String(s || "")
      .replace(/\|/g, "\\|")
      .replace(/\r?\n/g, " ")
      .trim();
  }

  function parseMarkdown(md) {
    const rows = [];
    for (const line of String(md || "").split(/\r?\n/)) {
      if (!/^\|\s*\d+\s*\|/.test(line)) continue;
      const parts = line.split("|").map((x) => x.trim());
      if (parts.length < 5) continue;
      const title = parts[2];
      const paperUrl = parts[3];
      const githubUrl = parts[4];
      if (!title || !paperUrl || !githubUrl) continue;
      if (title === "论文名称") continue;
      const row = { title, paperUrl, githubUrl };
      row._key = hitKey(row);
      rows.push(row);
    }
    // 去重保序
    const map = new Map();
    for (const r of rows) map.set(r._key, r);
    return [...map.values()];
  }

  function buildMainTable(allHits) {
    const lines = [
      "| # | 论文名称 | 论文链接 | GitHub代码链接 |",
      "| --- | --- | --- | --- |",
    ];
    allHits.forEach((h, i) => {
      lines.push(
        `| ${i + 1} | ${escapeMdCell(h.title)} | ${escapeMdCell(h.paperUrl)} | ${escapeMdCell(
          h.githubUrl
        )} |`
      );
    });
    return lines.join("\n");
  }

  function toMarkdown(allHits, newlyAdded) {
    const now = new Date().toISOString().replace("T", " ").slice(0, 19);
    const lines = [
      "# Transportation Research Part C · GitHub 论文汇总",
      "",
      `- 最近更新: ${now}`,
      `- 来源页 offset: ${currentOffset()}`,
      `- 累计条目: ${allHits.length}`,
      `- 写入模式: 合并去重（保留旧记录）+ 文末追加本次新增`,
      "",
      "## 全部结果（合并表）",
      "",
      buildMainTable(allHits),
      "",
    ];
    if (newlyAdded && newlyAdded.length) {
      lines.push(`## 本次新增（${now}，+${newlyAdded.length}）`, "");
      lines.push(buildMainTable(newlyAdded), "");
    }
    return lines.join("\n");
  }

  function idbOpen() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(IDB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(IDB_STORE)) db.createObjectStore(IDB_STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  async function idbSet(key, value) {
    const db = await idbOpen();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, "readwrite");
      tx.objectStore(IDB_STORE).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }
  async function idbGet(key) {
    const db = await idbOpen();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, "readonly");
      const req = tx.objectStore(IDB_STORE).get(key);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  }
  async function idbDel(key) {
    const db = await idbOpen();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, "readwrite");
      tx.objectStore(IDB_STORE).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async function ensurePermission(handle, mode = "readwrite") {
    if (!handle) return false;
    const q = await handle.queryPermission({ mode });
    if (q === "granted") return true;
    const r = await handle.requestPermission({ mode });
    return r === "granted";
  }

  async function readExistingFromHandle() {
    if (!mdHandle) return [];
    const ok = await ensurePermission(mdHandle, "readwrite");
    if (!ok) return [];
    try {
      const file = await mdHandle.getFile();
      return parseMarkdown(await file.text());
    } catch {
      return [];
    }
  }

  /** 读旧文件 → 与内存 hits 合并 → 写回（旧数据保留；新增在文末有增量区块） */
  async function writeMarkdownMerged() {
    if (!mdHandle) return { ok: false, reason: "未绑定" };
    const ok = await ensurePermission(mdHandle, "readwrite");
    if (!ok) return { ok: false, reason: "无写入权限" };

    const existing = await readExistingFromHandle();
    const map = new Map();
    for (const r of existing) map.set(r._key || hitKey(r), r);
    const newlyAdded = [];
    for (const r of hits) {
      const k = r._key || hitKey(r);
      if (!map.has(k)) newlyAdded.push(r);
      map.set(k, { ...r, _key: k });
    }
    hits = [...map.values()];
    lastAppended = newlyAdded.length;

    // 若内存为空且文件有数据：绝不清空文件
    if (!hits.length && existing.length) {
      hits = existing;
      return { ok: true, name: mdHandle.name, skippedEmpty: true, added: 0 };
    }

    const writable = await mdHandle.createWritable();
    await writable.write(toMarkdown(hits, newlyAdded));
    await writable.close();
    mdFileName = mdHandle.name || DEFAULT_MD_NAME;
    updateBindLabel();
    return { ok: true, name: mdFileName, added: newlyAdded.length, total: hits.length };
  }

  function downloadMarkdownFallback() {
    const blob = new Blob([toMarkdown(hits, hits)], { type: "text/markdown;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = DEFAULT_MD_NAME;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function backupHitsToStorage() {
    try {
      localStorage.setItem(
        HITS_BACKUP_KEY,
        JSON.stringify(
          hits.map((h) => ({
            title: h.title,
            paperUrl: h.paperUrl,
            githubUrl: h.githubUrl,
            pageOffset: h.pageOffset || "",
            snippet: h.snippet || "",
            _key: h._key || hitKey(h),
          }))
        )
      );
    } catch (_) {}
  }

  function loadHitsFromStorage() {
    try {
      const raw = JSON.parse(localStorage.getItem(HITS_BACKUP_KEY) || "[]");
      if (!Array.isArray(raw) || !raw.length) return;
      const map = new Map(hits.map((h) => [h._key || hitKey(h), h]));
      for (const r of raw) {
        if (!r || !r.title || !r.paperUrl || !r.githubUrl) continue;
        const row = {
          title: r.title,
          paperUrl: r.paperUrl,
          githubUrl: r.githubUrl,
          pageOffset: r.pageOffset || "",
          snippet: r.snippet || "",
        };
        row._key = r._key || hitKey(row);
        if (!map.has(row._key)) map.set(row._key, row);
      }
      hits = [...map.values()];
    } catch (_) {}
  }

  function markMdBound() {
    try {
      localStorage.setItem(MD_BOUND_FLAG, "1");
    } catch (_) {}
  }

  function wasMdBound() {
    try {
      return localStorage.getItem(MD_BOUND_FLAG) === "1";
    } catch (_) {
      return false;
    }
  }

  async function saveHits(opts = {}) {
    renderTable();
    updateBindLabel();
    backupHitsToStorage();
    if (!mdHandle) {
      if (opts.forceDownload) downloadMarkdownFallback();
      return;
    }
    // 翻页后可能暂时无权限：先尝试授权，失败则只备份到 localStorage，不弹「未绑定」
    if (!mdPermissionOk) {
      mdPermissionOk = await ensurePermission(mdHandle, "readwrite");
    }
    if (!mdPermissionOk) {
      setStatus(
        `本页结果已暂存（累计 ${hits.length}）。翻页后文件权限需手势恢复：请点一次「立即合并写入」。`,
        "warn"
      );
      return;
    }
    try {
      const res = await writeMarkdownMerged();
      if (!res.ok && opts.warn) setStatus(`写入 MD 失败：${res.reason}。请点「立即合并写入」重试。`, "warn");
      else if (res.skippedEmpty) setStatus("已跳过写入：内存为空，保留本地 MD 旧内容。", "warn");
      else backupHitsToStorage();
    } catch (e) {
      mdPermissionOk = false;
      setStatus(`写入 MD 失败：${e && e.message ? e.message : e}（已暂存，可稍后点「立即合并写入」）`, "warn");
      if (opts.forceDownload) downloadMarkdownFallback();
    }
  }

  /** 油猴沙箱里必须用页面 window 调用 File Picker，否则会 Illegal invocation */
  function pageWindow() {
    try {
      if (typeof unsafeWindow !== "undefined" && unsafeWindow) return unsafeWindow;
    } catch (_) {}
    return window;
  }

  async function bindMarkdownFile() {
    const w = pageWindow();
    const openPicker = w.showOpenFilePicker || window.showOpenFilePicker;
    const savePicker = w.showSaveFilePicker || window.showSaveFilePicker;
    if (!openPicker && !savePicker) {
      setStatus("当前浏览器不支持绑定本地文件，将改为下载 MD。", "warn");
      downloadMarkdownFallback();
      return;
    }
    try {
      const useOpen = confirm(
        "绑定本地 MD：\n\n确定 = 打开已有 md（推荐，会合并追加，不丢旧数据）\n取消 = 新建/另存为"
      );
      const pickerOpts = {
        types: [
          {
            description: "Markdown",
            accept: { "text/markdown": [".md"], "text/plain": [".md", ".txt"] },
          },
        ],
      };
      if (useOpen && openPicker) {
        const [h] = await openPicker.call(w, { ...pickerOpts, multiple: false });
        mdHandle = h;
      } else if (savePicker) {
        mdHandle = await savePicker.call(w, {
          ...pickerOpts,
          suggestedName: DEFAULT_MD_NAME,
        });
      } else {
        throw new Error("无可用的文件选择 API");
      }
      await idbSet("mdHandle", mdHandle);
      markMdBound();
      mdPermissionOk = true;
      mdFileName = mdHandle.name || DEFAULT_MD_NAME;
      const existing = await readExistingFromHandle();
      if (existing.length) {
        const map = new Map(hits.map((h) => [h._key || hitKey(h), h]));
        for (const r of existing) if (!map.has(r._key)) map.set(r._key, r);
        hits = [...map.values()];
      }
      const res = await writeMarkdownMerged();
      backupHitsToStorage();
      setStatus(
        `已绑定：${mdFileName || mdHandle.name}。当前 ${hits.length} 条` +
          (res.added ? `（本次合并写入 +${res.added}）` : "（无新条目）")
      );
      renderTable();
      updateBindLabel();
    } catch (e) {
      if (e && e.name === "AbortError") setStatus("已取消绑定。");
      else setStatus(`绑定失败：${e && e.message ? e.message : e}`, "warn");
    }
  }

  async function restoreMarkdownHandle() {
    try {
      const h = await idbGet("mdHandle");
      if (!h) {
        mdHandle = null;
        mdPermissionOk = false;
        return false;
      }
      // 保留句柄：翻页后即使暂时无权限，也不当作「未绑定」
      mdHandle = h;
      mdFileName = h.name || DEFAULT_MD_NAME;
      markMdBound();
      const ok = await ensurePermission(mdHandle, "readwrite");
      mdPermissionOk = !!ok;
      if (!ok) {
        loadHitsFromStorage();
        updateBindLabel();
        renderTable();
        setStatus(
          `已识别绑定文件：${mdFileName}，但翻页后需点一次「立即合并写入」恢复写入权限。`,
          "warn"
        );
        return "need_permission";
      }
      const existing = await readExistingFromHandle();
      loadHitsFromStorage();
      if (existing.length) {
        const map = new Map(hits.map((x) => [x._key || hitKey(x), x]));
        for (const r of existing) map.set(r._key || hitKey(r), r);
        hits = [...map.values()];
      }
      backupHitsToStorage();
      updateBindLabel();
      renderTable();
      setStatus(`已恢复本地文件：${mdFileName}（${hits.length} 条）`);
      return true;
    } catch (e) {
      loadHitsFromStorage();
      setStatus(`恢复 MD 句柄异常：${e && e.message ? e.message : e}`, "warn");
      return false;
    }
  }

  async function unbindMarkdown() {
    mdHandle = null;
    mdFileName = "";
    mdPermissionOk = false;
    await idbDel("mdHandle");
    try {
      localStorage.removeItem(MD_BOUND_FLAG);
    } catch (_) {}
    updateBindLabel();
    setStatus("已解除本地 MD 绑定。");
  }

  async function waitForResults(timeoutMs = 60000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (looksLikeCaptcha()) return "captcha";
      if (resultCards().length > 0) return "ok";
      await sleep(500);
    }
    return "timeout";
  }

  async function ensureMdReadyForScan() {
    if (!mdHandle) {
      await restoreMarkdownHandle();
    }
    // IndexedDB 里有句柄 / 曾绑定过 → 绝不弹「未绑定」
    if (mdHandle || wasMdBound()) {
      if (mdHandle && !mdPermissionOk) {
        mdPermissionOk = await ensurePermission(mdHandle, "readwrite");
      }
      return true;
    }
    const go = confirm(
      "尚未绑定本地 MD。\n\n确定 = 绑定（打开已有文件可合并追加）\n取消 = 仅扫描，结束时下载"
    );
    if (go) {
      await bindMarkdownFile();
      return !!mdHandle;
    }
    return true; // 允许无 MD 继续扫
  }

  async function scanCurrentPage() {
    const wait = await waitForResults(60000);
    if (wait === "captcha") {
      setStatus("检测到人机验证，请先完成验证再扫描。", "warn");
      return { added: 0, scanned: 0 };
    }
    if (wait === "timeout") {
      setStatus("等待结果列表超时。", "warn");
      return { added: 0, scanned: 0 };
    }
    await ensureMdReadyForScan();

    const cards = resultCards();
    let added = 0;
    for (let i = 0; i < cards.length; i++) {
      const card = cards[i];
      const a = titleLinkOf(card);
      if (!a) continue;
      const title = (a.textContent || "").trim();
      const paperUrl = a.href || "";
      await expandAbstract(card);
      const text = abstractText(card);
      const ghs = extractGithub(text);
      setStatus(`扫描 ${i + 1}/${cards.length} · ${title.slice(0, 55)}`);
      for (const gh of ghs) {
        if (
          pushHit({
            title,
            paperUrl,
            githubUrl: gh,
            pageOffset: String(currentOffset()),
            snippet: text.replace(/\s+/g, " ").slice(0, 220),
          })
        )
          added++;
      }
      await sleep(250);
    }
    await saveHits({ forceDownload: !mdHandle && !wasMdBound(), warn: true });
    backupHitsToStorage();
    const where = mdHandle && mdPermissionOk
      ? `已合并写入 ${mdFileName || "本地 MD"}（本页新命中 ${added}，累计 ${hits.length}，文件新增 ${lastAppended}）`
      : mdHandle
        ? `已暂存累计 ${hits.length} 条（待点「立即合并写入」写回 MD）`
        : "已触发 MD 下载或仅内存";
    setStatus(`本页完成：${cards.length} 篇。${where}`);
    return { added, scanned: cards.length };
  }

  /** 油猴：整页跳转翻页（脚本会自动再注入） */
  async function autoNextPagesHard(n) {
    const maxPages = Math.max(1, Number(n) || 1);
    await ensureMdReadyForScan();
    if (!mdHandle && !wasMdBound()) {
      if (!confirm("未绑定 MD，仍继续自动翻页？")) return;
    }

    await scanCurrentPage();
    backupHitsToStorage();

    if (maxPages <= 1) {
      setStatus(`完成 1 页。累计 ${hits.length} 条。`);
      return;
    }

    localStorage.setItem(
      STATE_KEY,
      JSON.stringify({
        active: true,
        remaining: maxPages - 1,
        show: currentShow(),
        startedAt: Date.now(),
      })
    );
    const next = urlWithOffset(currentOffset() + currentShow());
    setStatus(`油猴硬翻页 → offset=${currentOffset() + currentShow()}（剩余 ${maxPages - 1} 页）…`);
    await sleep(600);
    location.href = next;
  }

  async function resumeAutoIfNeeded() {
    let st;
    try {
      st = JSON.parse(localStorage.getItem(STATE_KEY) || "null");
    } catch {
      st = null;
    }
    if (!st || !st.active) return;

    setStatus(`油猴自动翻页续跑中，剩余 ${st.remaining} 页…`);
    await sleep(1200);
    if (looksLikeCaptcha()) {
      setStatus("请完成人机验证后，再点「继续自动翻页」。", "warn");
      return;
    }

    await scanCurrentPage();
    backupHitsToStorage();
    st.remaining -= 1;
    if (st.remaining <= 0) {
      localStorage.removeItem(STATE_KEY);
      setStatus(`自动翻页完成。累计 ${hits.length} 条。`);
      return;
    }
    localStorage.setItem(STATE_KEY, JSON.stringify(st));
    const next = urlWithOffset(currentOffset() + (st.show || currentShow()));
    setStatus(`继续翻页 → ${next}`);
    await sleep(600);
    location.href = next;
  }

  async function autoNextPages(n) {
    // 仅油猴硬翻页（整页跳转 + 自动再注入），不做软翻页
    if (!IS_TM) {
      alert(
        "自动翻页需要油猴注入。\n请安装 Tampermonkey 并允许访问 sciencedirect.com 后重试。\n控制台粘贴模式请只用「扫描本页」。"
      );
      return;
    }
    await autoNextPagesHard(n);
  }

  function copyTable() {
    const text =
      "论文名称\t论文链接\tGitHub代码链接\n" +
      hits.map((h) => `${h.title}\t${h.paperUrl}\t${h.githubUrl}`).join("\n");
    navigator.clipboard.writeText(text).then(() => setStatus("已复制到剪贴板"));
  }

  const escapeHtml = (s) =>
    String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

  function updateBindLabel() {
    const el = document.getElementById("sd-partc-bind-label");
    if (!el) return;
    if (mdHandle) {
      el.textContent = mdPermissionOk
        ? `本地文件: ${mdFileName || mdHandle.name || DEFAULT_MD_NAME}（可写入）`
        : `本地文件: ${mdFileName || mdHandle.name || DEFAULT_MD_NAME}（待点「立即合并写入」恢复权限）`;
    } else if (wasMdBound()) {
      el.textContent = "本地文件: 曾绑定（恢复中/请点立即合并写入）";
    } else {
      el.textContent = "本地文件: 未绑定";
    }
  }
  function updateModeLabel() {
    const el = document.getElementById("sd-partc-mode");
    if (!el) return;
    el.textContent = IS_TM
      ? "运行模式: 油猴（推荐，翻页自动注入）"
      : "运行模式: 控制台粘贴（多页请改用油猴）";
  }

  function renderTable() {
    const wrap = document.getElementById("sd-partc-table-wrap");
    if (!wrap) return;
    if (!hits.length) {
      wrap.innerHTML = "<div class='meta'>暂无命中</div>";
      return;
    }
    wrap.innerHTML = `<table><thead><tr><th>#</th><th>论文名称</th><th>论文</th><th>GitHub</th></tr></thead><tbody>${hits
      .map(
        (h, i) =>
          `<tr><td>${i + 1}</td><td>${escapeHtml(h.title)}</td><td><a href="${escapeHtml(
            h.paperUrl
          )}" target="_blank">链接</a></td><td><a href="${escapeHtml(
            h.githubUrl
          )}" target="_blank">${escapeHtml(h.githubUrl)}</a></td></tr>`
      )
      .join("")}</tbody></table>`;
  }
  function setStatus(msg, kind) {
    const el = document.getElementById("sd-partc-status");
    if (!el) return;
    el.textContent = msg;
    el.className = kind === "warn" ? "warn" : "";
  }

  const PANEL_POS_KEY = "sd_partc_panel_geom_v2";

  function loadPanelGeom() {
    try {
      return JSON.parse(localStorage.getItem(PANEL_POS_KEY) || "null");
    } catch {
      return null;
    }
  }
  function savePanelGeom(panel) {
    const r = panel.getBoundingClientRect();
    localStorage.setItem(
      PANEL_POS_KEY,
      JSON.stringify({
        left: r.left,
        top: r.top,
        width: r.width,
        height: r.height,
      })
    );
  }

  function applyPanelGeom(panel) {
    const g = loadPanelGeom();
    panel.style.right = "auto";
    panel.style.bottom = "auto";
    panel.style.fontSize = "13px";
    const placeDefault = () => {
      panel.style.left = "auto";
      panel.style.top = "auto";
      panel.style.right = "12px";
      panel.style.bottom = "12px";
      panel.style.width = Math.min(520, window.innerWidth - 24) + "px";
      panel.style.height = Math.min(520, window.innerHeight - 24) + "px";
    };
    if (g && Number.isFinite(g.left) && Number.isFinite(g.top)) {
      const w = Math.max(280, g.width || 420);
      const h = Math.max(200, g.height || 420);
      let left = g.left;
      let top = g.top;
      if (left > window.innerWidth - 60 || top > window.innerHeight - 40 || left < -50 || top < -50) {
        placeDefault();
        return;
      }
      panel.style.left = Math.max(0, left) + "px";
      panel.style.top = Math.max(0, top) + "px";
      panel.style.width = Math.min(w, window.innerWidth - 20) + "px";
      panel.style.height = Math.min(h, window.innerHeight - 20) + "px";
    } else {
      placeDefault();
    }
  }

  function enableDragResize(panel) {
    const head = panel.querySelector("#sd-partc-drag");
    const handle = panel.querySelector("#sd-partc-resize");
    if (!head || !handle) return;

    let dragging = false;
    let resizing = false;
    let sx = 0;
    let sy = 0;
    let sl = 0;
    let st = 0;
    let sw = 0;
    let sh = 0;

    head.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      if (e.target.closest("button")) return;
      dragging = true;
      head.setPointerCapture(e.pointerId);
      const r = panel.getBoundingClientRect();
      panel.style.right = "auto";
      panel.style.bottom = "auto";
      panel.style.left = r.left + "px";
      panel.style.top = r.top + "px";
      sx = e.clientX;
      sy = e.clientY;
      sl = r.left;
      st = r.top;
      e.preventDefault();
    });
    head.addEventListener("pointermove", (e) => {
      if (!dragging) return;
      const nl = sl + (e.clientX - sx);
      const nt = st + (e.clientY - sy);
      const maxL = window.innerWidth - 80;
      const maxT = window.innerHeight - 40;
      panel.style.left = Math.min(maxL, Math.max(0, nl)) + "px";
      panel.style.top = Math.min(maxT, Math.max(0, nt)) + "px";
    });
    const endDrag = (e) => {
      if (!dragging) return;
      dragging = false;
      try {
        head.releasePointerCapture(e.pointerId);
      } catch {}
      savePanelGeom(panel);
    };
    head.addEventListener("pointerup", endDrag);
    head.addEventListener("pointercancel", endDrag);

    handle.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      resizing = true;
      handle.setPointerCapture(e.pointerId);
      const r = panel.getBoundingClientRect();
      panel.style.right = "auto";
      panel.style.bottom = "auto";
      panel.style.left = r.left + "px";
      panel.style.top = r.top + "px";
      sx = e.clientX;
      sy = e.clientY;
      sw = r.width;
      sh = r.height;
      e.preventDefault();
      e.stopPropagation();
    });
    handle.addEventListener("pointermove", (e) => {
      if (!resizing) return;
      const nw = Math.max(280, Math.min(window.innerWidth - 20, sw + (e.clientX - sx)));
      const nh = Math.max(200, Math.min(window.innerHeight - 20, sh + (e.clientY - sy)));
      panel.style.width = nw + "px";
      panel.style.height = nh + "px";
    });
    const endResize = (e) => {
      if (!resizing) return;
      resizing = false;
      try {
        handle.releasePointerCapture(e.pointerId);
      } catch {}
      savePanelGeom(panel);
    };
    handle.addEventListener("pointerup", endResize);
    handle.addEventListener("pointercancel", endResize);

    /** +/− 改变窗口宽高，不缩放文字 */
    const bumpSize = (factor) => {
      const r = panel.getBoundingClientRect();
      panel.style.right = "auto";
      panel.style.bottom = "auto";
      panel.style.left = r.left + "px";
      panel.style.top = r.top + "px";
      const nw = Math.max(280, Math.min(window.innerWidth - 20, Math.round(r.width * factor)));
      const nh = Math.max(200, Math.min(window.innerHeight - 20, Math.round(r.height * factor)));
      panel.style.width = nw + "px";
      panel.style.height = nh + "px";
      const label = panel.querySelector("#sd-partc-size-label");
      if (label) label.textContent = `${nw}×${nh}`;
      savePanelGeom(panel);
    };
    const resetSize = () => {
      const r = panel.getBoundingClientRect();
      panel.style.right = "auto";
      panel.style.bottom = "auto";
      panel.style.left = r.left + "px";
      panel.style.top = r.top + "px";
      const nw = Math.min(520, window.innerWidth - 24);
      const nh = Math.min(520, window.innerHeight - 24);
      panel.style.width = nw + "px";
      panel.style.height = nh + "px";
      const label = panel.querySelector("#sd-partc-size-label");
      if (label) label.textContent = `${nw}×${nh}`;
      savePanelGeom(panel);
    };
    panel.querySelector("#sd-partc-size-out")?.addEventListener("click", () => bumpSize(0.9));
    panel.querySelector("#sd-partc-size-in")?.addEventListener("click", () => bumpSize(1.1));
    panel.querySelector("#sd-partc-size-reset")?.addEventListener("click", resetSize);
    const label = panel.querySelector("#sd-partc-size-label");
    if (label) {
      const r = panel.getBoundingClientRect();
      label.textContent = `${Math.round(r.width)}×${Math.round(r.height)}`;
    }
  }

  async function boot() {
    if (document.getElementById("sd-partc-gh-panel")) {
      // 已挂载则只续跑自动翻页，避免重复创建
      updateModeLabel();
      resumeAutoIfNeeded();
      return;
    }
    const css = document.createElement("style");
    css.textContent = `
      #sd-partc-gh-panel{
        position:fixed; z-index:2147483646;
        width:min(520px,96vw); height:min(520px,72vh);
        min-width:280px; min-height:200px;
        display:flex; flex-direction:column;
        overflow:hidden;
        background:#111827; color:#f9fafb; border:1px solid #374151;
        border-radius:10px; box-shadow:0 10px 40px rgba(0,0,0,.35);
        font:13px/1.45 system-ui,sans-serif;
      }
      #sd-partc-drag{
        cursor:move; user-select:none;
        display:flex; align-items:center; justify-content:space-between; gap:8px;
        padding:8px 10px; background:#0b1220; border-bottom:1px solid #374151;
        flex:0 0 auto;
      }
      #sd-partc-drag h3{margin:0; font-size:1.05em; font-weight:700;}
      #sd-partc-drag .win-btns{display:flex; gap:4px; align-items:center;}
      #sd-partc-drag .win-btns button{
        background:#374151; color:#fff; border:0; border-radius:4px;
        padding:2px 8px; cursor:pointer; font-size:12px; line-height:1.4;
      }
      #sd-partc-body{padding:10px 12px; overflow:auto; flex:1 1 auto;}
      #sd-partc-gh-panel .row{display:flex; flex-wrap:wrap; gap:6px; margin-bottom:8px;}
      #sd-partc-gh-panel button{
        background:#2563eb; color:#fff; border:0; border-radius:6px;
        padding:6px 10px; cursor:pointer; font-size:12px;
      }
      #sd-partc-gh-panel button.secondary{background:#4b5563;}
      #sd-partc-gh-panel button.danger{background:#b91c1c;}
      #sd-partc-gh-panel #sd-partc-status{margin:4px 0 8px; color:#93c5fd; white-space:pre-wrap;}
      #sd-partc-gh-panel #sd-partc-status.warn{color:#fbbf24;}
      #sd-partc-gh-panel table{width:100%; border-collapse:collapse; font-size:0.92em;}
      #sd-partc-gh-panel th,#sd-partc-gh-panel td{
        border-bottom:1px solid #374151; padding:4px 3px; vertical-align:top; text-align:left;
      }
      #sd-partc-gh-panel a{color:#93c5fd; word-break:break-all;}
      #sd-partc-gh-panel .meta{color:#9ca3af; font-size:0.92em; margin-bottom:6px;}
      #sd-partc-resize{
        position:absolute; right:2px; bottom:2px; width:16px; height:16px;
        cursor:nwse-resize; touch-action:none;
        background:linear-gradient(135deg, transparent 50%, #6b7280 50%);
        border-radius:0 0 8px 0;
      }
    `;
    document.documentElement.appendChild(css);
    const panel = document.createElement("div");
    panel.id = "sd-partc-gh-panel";
    panel.innerHTML = `
    <div id="sd-partc-drag">
      <h3>Part C · GitHub 提取</h3>
      <div class="win-btns">
        <button type="button" id="sd-partc-size-out" title="缩小窗口">−</button>
        <span id="sd-partc-size-label" style="color:#9ca3af;font-size:12px;min-width:64px;text-align:center">520×520</span>
        <button type="button" id="sd-partc-size-in" title="放大窗口">+</button>
        <button type="button" id="sd-partc-size-reset" title="重置窗口大小">重置</button>
      </div>
    </div>
    <div id="sd-partc-body">
      <div class="meta">拖动标题栏移动 · 右下角或 +/− 调整窗口大小</div>
      <div class="meta">当前页 offset=<b id="sd-partc-off">${currentOffset()}</b> · show=<b id="sd-partc-show">${currentShow()}</b></div>
      <div class="meta" id="sd-partc-mode"></div>
      <div class="meta" id="sd-partc-bind-label">本地文件: 未绑定</div>
      <div class="row">
        <button id="sd-partc-bind">绑定本地 MD</button>
        <button id="sd-partc-save" class="secondary">立即合并写入</button>
        <button id="sd-partc-dl" class="secondary">下载 MD</button>
        <button id="sd-partc-unbind" class="secondary">解绑</button>
      </div>
      <div class="row">
        <button id="sd-partc-scan">扫描本页</button>
        <button id="sd-partc-auto">自动翻页扫描</button>
        <button id="sd-partc-continue" class="secondary">继续自动翻页</button>
      </div>
      <div class="row">
        <button id="sd-partc-copy" class="secondary">复制表格</button>
        <button id="sd-partc-clear" class="danger">清空面板</button>
      </div>
      <div id="sd-partc-status">油猴硬翻页；清空面板不改动本地 MD。</div>
      <div id="sd-partc-table-wrap"></div>
    </div>
    <div id="sd-partc-resize" title="拖拽调整大小"></div>`;
    document.documentElement.appendChild(panel);
    applyPanelGeom(panel);
    enableDragResize(panel);

    panel.querySelector("#sd-partc-bind").onclick = () => bindMarkdownFile();
    panel.querySelector("#sd-partc-save").onclick = async () => {
      if (!mdHandle) {
        await restoreMarkdownHandle();
      }
      if (!mdHandle) {
        await bindMarkdownFile();
        return;
      }
      // 用户点击 = 有效手势，可恢复 File System 权限
      mdPermissionOk = await ensurePermission(mdHandle, "readwrite");
      if (!mdPermissionOk) {
        setStatus("权限仍未授予。请再点「绑定本地 MD」重新选择同一文件。", "warn");
        return;
      }
      loadHitsFromStorage();
      await saveHits({ warn: true });
      setStatus(`已合并写入（累计 ${hits.length}，本次文件新增 ${lastAppended}）`);
      updateBindLabel();
    };
    panel.querySelector("#sd-partc-dl").onclick = () => {
      downloadMarkdownFallback();
      setStatus("已下载 MD。");
    };
    panel.querySelector("#sd-partc-unbind").onclick = () => unbindMarkdown();
    panel.querySelector("#sd-partc-scan").onclick = () => scanCurrentPage();
    panel.querySelector("#sd-partc-auto").onclick = () => {
      const n = Number(prompt("从当前页起扫描几页？", "5") || "0");
      if (n > 0) autoNextPages(n);
    };
    panel.querySelector("#sd-partc-continue").onclick = () => {
      const n = Number(prompt("从当前页起再扫几页？", "3") || "0");
      if (n > 0) autoNextPages(n);
    };
    panel.querySelector("#sd-partc-copy").onclick = copyTable;
    panel.querySelector("#sd-partc-clear").onclick = () => {
      if (
        !confirm(
          "仅清空面板里的表格显示。\n\n不会删除、不会改写本地 MD 文件。\n下次「合并写入」仍会先读 MD 再合并。"
        )
      )
        return;
      hits = [];
      renderTable();
      setStatus("已清空面板显示。本地 MD 未改动。");
    };

    updateModeLabel();
    loadHitsFromStorage();
    await restoreMarkdownHandle();
    renderTable();
    updateBindLabel();
    resumeAutoIfNeeded();
    console.info("[PartC GitHub] panel mounted", { IS_TM, version: "1.5.7" });
  }

  function start() {
    boot().catch((e) => {
      console.error("[PartC GitHub] boot failed", e);
      try {
        alert("Part C 脚本启动失败: " + (e && e.message ? e.message : e));
      } catch (_) {}
    });
  }

  // 多时机尝试，避免页面晚加载导致“已启用未执行”
  function scheduleStart() {
    start();
    setTimeout(start, 1500);
    setTimeout(start, 4000);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", scheduleStart, { once: true });
  } else {
    scheduleStart();
  }

  // SPA 改 URL 时重新挂载（油猴 window.onurlchange）
  try {
    if (typeof window.onurlchange !== "undefined") {
      window.addEventListener("urlchange", () => {
        console.info("[PartC GitHub] urlchange", location.href);
        scheduleStart();
      });
    }
  } catch (_) {}
})();
