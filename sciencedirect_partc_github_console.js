// ==UserScript==
// @name         ScienceDirect Part C GitHub Extractor
// @namespace    https://local.partc.github/
// @version      1.2.0
// @description  Extract papers with GitHub links from ScienceDirect Part C; auto-save Markdown to a local file
// @author       local
// @match        https://www.sciencedirect.com/search*
// @match        https://www.sciencedirect.com/*/search*
// @icon         https://www.sciencedirect.com/favicon.ico
// @grant        none
// @run-at       document-idle
// ==/UserScript==

/* 浏览器不能静默写任意路径：先点「绑定本地 MD」，之后每次扫描会自动覆盖写入该文件。 */
(() => {
  const DEFAULT_START =
    "https://www.sciencedirect.com/search?pub=Transportation%20Research%20Part%20C%3A%20Emerging%20Technologies&cid=271729&years=2026&sortBy=relevance&show=50&offset=250";
  const GITHUB_RE =
    /https?:\/\/(?:www\.)?github\.com\/[A-Za-z0-9_.\-]+\/[A-Za-z0-9_.\-]+(?:\/[^\s)\]"'<>]*)?/gi;
  const GITHUB_BARE_RE =
    /(?:^|[\s(\["'])((?:www\.)?github\.com\/[A-Za-z0-9_.\-]+\/[A-Za-z0-9_.\-]+)/gi;
  const STATE_KEY = "sd_partc_github_auto_v1";
  const IDB_NAME = "sd_partc_github_fs";
  const IDB_STORE = "handles";
  const DEFAULT_MD_NAME = "partc_github_papers.md";

  /** @type {{title:string,paperUrl:string,githubUrl:string,pageOffset?:string,snippet?:string,_key?:string}[]} */
  let hits = [];
  /** @type {FileSystemFileHandle|null} */
  let mdHandle = null;
  let mdFileName = "";

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

  function toMarkdown() {
    const now = new Date().toISOString().replace("T", " ").slice(0, 19);
    const lines = [
      "# Transportation Research Part C · GitHub 论文汇总",
      "",
      `- 更新时间: ${now}`,
      `- 来源页 offset: ${currentOffset()}`,
      `- 条目数: ${hits.length}`,
      "",
      "| # | 论文名称 | 论文链接 | GitHub代码链接 |",
      "| --- | --- | --- | --- |",
    ];
    hits.forEach((h, i) => {
      lines.push(
        `| ${i + 1} | ${escapeMdCell(h.title)} | ${escapeMdCell(h.paperUrl)} | ${escapeMdCell(
          h.githubUrl
        )} |`
      );
    });
    lines.push("");
    return lines.join("\n");
  }

  function parseMarkdown(md) {
    const rows = [];
    for (const line of String(md || "").split(/\r?\n/)) {
      if (!/^\|\s*\d+\s*\|/.test(line)) continue;
      const parts = line.split("|").map((x) => x.trim());
      // "", "#", title, paper, github, ""
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
    return rows;
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

  async function writeMarkdownToHandle() {
    if (!mdHandle) return { ok: false, reason: "未绑定" };
    const ok = await ensurePermission(mdHandle, "readwrite");
    if (!ok) return { ok: false, reason: "无写入权限" };
    const writable = await mdHandle.createWritable();
    await writable.write(toMarkdown());
    await writable.close();
    mdFileName = mdHandle.name || DEFAULT_MD_NAME;
    updateBindLabel();
    return { ok: true, name: mdFileName };
  }

  function downloadMarkdownFallback() {
    const blob = new Blob([toMarkdown()], { type: "text/markdown;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = DEFAULT_MD_NAME;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  async function saveHits(opts = {}) {
    renderTable();
    updateBindLabel();
    if (!mdHandle) {
      if (opts.forceDownload) downloadMarkdownFallback();
      return;
    }
    try {
      const res = await writeMarkdownToHandle();
      if (!res.ok && opts.warn) setStatus(`写入 MD 失败：${res.reason}。请重新绑定。`, "warn");
    } catch (e) {
      setStatus(`写入 MD 失败：${e && e.message ? e.message : e}`, "warn");
      if (opts.forceDownload) downloadMarkdownFallback();
    }
  }

  async function bindMarkdownFile() {
    if (!window.showSaveFilePicker) {
      setStatus("当前浏览器不支持直接绑定本地文件，将改为下载 MD。", "warn");
      downloadMarkdownFallback();
      return;
    }
    try {
      mdHandle = await window.showSaveFilePicker({
        suggestedName: DEFAULT_MD_NAME,
        types: [
          {
            description: "Markdown",
            accept: { "text/markdown": [".md"], "text/plain": [".md", ".txt"] },
          },
        ],
      });
      await idbSet("mdHandle", mdHandle);
      // 若文件已有内容则读回，避免覆盖丢数据
      try {
        const ok = await ensurePermission(mdHandle, "readwrite");
        if (ok) {
          const file = await mdHandle.getFile();
          const text = await file.text();
          const existing = parseMarkdown(text);
          if (existing.length) {
            const map = new Map(hits.map((h) => [h._key || hitKey(h), h]));
            for (const r of existing) map.set(r._key, r);
            hits = [...map.values()];
          }
        }
      } catch {}
      await writeMarkdownToHandle();
      setStatus(`已绑定并写入：${mdFileName || DEFAULT_MD_NAME}（之后扫描会自动覆盖保存）`);
      renderTable();
    } catch (e) {
      if (e && e.name === "AbortError") setStatus("已取消绑定。");
      else setStatus(`绑定失败：${e && e.message ? e.message : e}`, "warn");
    }
  }

  async function restoreMarkdownHandle() {
    try {
      const h = await idbGet("mdHandle");
      if (!h) return;
      mdHandle = h;
      mdFileName = h.name || DEFAULT_MD_NAME;
      const ok = await ensurePermission(mdHandle, "readwrite");
      if (!ok) {
        setStatus("本地 MD 权限失效，请再点「绑定本地 MD」。", "warn");
        mdHandle = null;
        return;
      }
      try {
        const file = await mdHandle.getFile();
        const text = await file.text();
        const existing = parseMarkdown(text);
        if (existing.length) hits = existing;
      } catch {}
      updateBindLabel();
      renderTable();
      setStatus(`已恢复本地文件：${mdFileName}`);
    } catch {
      mdHandle = null;
    }
  }

  async function unbindMarkdown() {
    mdHandle = null;
    mdFileName = "";
    await idbDel("mdHandle");
    updateBindLabel();
    setStatus("已解除本地 MD 绑定。之后可用「下载 MD」手动保存。");
  }

  async function scanCurrentPage() {
    if (looksLikeCaptcha()) {
      setStatus("检测到人机验证，请先完成验证再扫描。", "warn");
      return;
    }
    if (!mdHandle) {
      const go = confirm(
        "尚未绑定本地 MD 文件。\n\n点「确定」先绑定（推荐，之后自动写入）；\n点「取消」仅扫描，结束后下载一次 MD。"
      );
      if (go) {
        await bindMarkdownFile();
        if (!mdHandle) return;
      }
    }
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
    await saveHits({ forceDownload: !mdHandle, warn: true });
    const where = mdHandle ? `已写入 ${mdFileName || "本地 MD"}` : "已触发 MD 下载";
    setStatus(`本页完成：${cards.length} 篇，新增 ${added}，累计 ${hits.length}。${where}`);
  }

  async function autoNextPages(n) {
    if (!mdHandle) {
      await bindMarkdownFile();
      if (!mdHandle && !confirm("未绑定 MD，仍继续？翻页后结果依赖已写入的 MD 文件。")) return;
    }
    localStorage.setItem(
      STATE_KEY,
      JSON.stringify({ active: true, remaining: Math.max(0, n - 1) })
    );
    await scanCurrentPage();
    const st = JSON.parse(localStorage.getItem(STATE_KEY) || "{}");
    if (!st.active || st.remaining <= 0) {
      localStorage.removeItem(STATE_KEY);
      setStatus(`自动翻页结束，累计 ${hits.length}`);
      return;
    }
    location.href = urlWithOffset(currentOffset() + currentShow());
  }

  async function resumeAutoIfNeeded() {
    let st;
    try {
      st = JSON.parse(localStorage.getItem(STATE_KEY) || "null");
    } catch {
      st = null;
    }
    if (!st?.active) return;
    await sleep(1000);
    if (looksLikeCaptcha()) {
      setStatus("请完成验证后点「继续自动翻页」。", "warn");
      return;
    }
    await scanCurrentPage();
    st.remaining -= 1;
    if (st.remaining <= 0) {
      localStorage.removeItem(STATE_KEY);
      setStatus(`自动翻页完成，累计 ${hits.length}`);
      return;
    }
    localStorage.setItem(STATE_KEY, JSON.stringify(st));
    location.href = urlWithOffset(currentOffset() + currentShow());
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
    el.textContent = mdHandle
      ? `本地文件: ${mdFileName || mdHandle.name || DEFAULT_MD_NAME}`
      : "本地文件: 未绑定（结果不会自动落盘）";
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

  async function boot() {
    if (document.getElementById("sd-partc-gh-panel")) {
      setStatus("面板已存在，可直接操作。");
      await restoreMarkdownHandle();
      resumeAutoIfNeeded();
      return;
    }
    const css = document.createElement("style");
    css.textContent = `#sd-partc-gh-panel{position:fixed;right:12px;bottom:12px;z-index:2147483646;width:min(520px,96vw);max-height:72vh;overflow:auto;background:#111827;color:#f9fafb;border:1px solid #374151;border-radius:10px;box-shadow:0 10px 40px rgba(0,0,0,.35);font:13px/1.45 system-ui,sans-serif;padding:10px 12px}#sd-partc-gh-panel h3{margin:0 0 8px;font-size:14px}#sd-partc-gh-panel .row{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px}#sd-partc-gh-panel button{background:#2563eb;color:#fff;border:0;border-radius:6px;padding:6px 10px;cursor:pointer;font-size:12px}#sd-partc-gh-panel button.secondary{background:#4b5563}#sd-partc-gh-panel button.danger{background:#b91c1c}#sd-partc-gh-panel #sd-partc-status{margin:4px 0 8px;color:#93c5fd;white-space:pre-wrap}#sd-partc-gh-panel #sd-partc-status.warn{color:#fbbf24}#sd-partc-gh-panel table{width:100%;border-collapse:collapse;font-size:11px}#sd-partc-gh-panel th,#sd-partc-gh-panel td{border-bottom:1px solid #374151;padding:4px 3px;vertical-align:top;text-align:left}#sd-partc-gh-panel a{color:#93c5fd;word-break:break-all}#sd-partc-gh-panel .meta{color:#9ca3af;font-size:11px;margin-bottom:6px}`;
    document.documentElement.appendChild(css);
    const panel = document.createElement("div");
    panel.id = "sd-partc-gh-panel";
    panel.innerHTML = `<h3>Part C · GitHub 摘要提取</h3>
    <div class="meta">offset=<b>${currentOffset()}</b> · show=<b>${currentShow()}</b></div>
    <div class="meta" id="sd-partc-bind-label">本地文件: 未绑定</div>
    <div class="row">
      <button id="sd-partc-bind">绑定本地 MD</button>
      <button id="sd-partc-save" class="secondary">立即写入 MD</button>
      <button id="sd-partc-dl" class="secondary">下载 MD</button>
      <button id="sd-partc-unbind" class="secondary">解绑</button>
    </div>
    <div class="row">
      <button id="sd-partc-scan">扫描本页</button>
      <button id="sd-partc-auto">自动翻页扫描</button>
      <button id="sd-partc-continue" class="secondary">继续自动翻页</button>
      <button id="sd-partc-goto" class="secondary">打开 offset=250</button>
    </div>
    <div class="row">
      <button id="sd-partc-copy" class="secondary">复制表格</button>
      <button id="sd-partc-clear" class="danger">清空</button>
    </div>
    <div id="sd-partc-status">请先「绑定本地 MD」，再扫描；结果会自动写入该文件。</div>
    <div id="sd-partc-table-wrap"></div>`;
    document.documentElement.appendChild(panel);

    panel.querySelector("#sd-partc-bind").onclick = () => bindMarkdownFile();
    panel.querySelector("#sd-partc-save").onclick = async () => {
      if (!mdHandle) await bindMarkdownFile();
      else {
        await saveHits({ warn: true });
        setStatus(`已写入 ${mdFileName || DEFAULT_MD_NAME}（${hits.length} 条）`);
      }
    };
    panel.querySelector("#sd-partc-dl").onclick = () => {
      downloadMarkdownFallback();
      setStatus("已下载 MD 到浏览器下载目录。");
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
    panel.querySelector("#sd-partc-goto").onclick = () => (location.href = DEFAULT_START);
    panel.querySelector("#sd-partc-copy").onclick = copyTable;
    panel.querySelector("#sd-partc-clear").onclick = async () => {
      if (!confirm("清空内存中的结果，并覆盖写入空表到已绑定 MD？")) return;
      hits = [];
      await saveHits({ forceDownload: !mdHandle, warn: true });
      setStatus("已清空。");
    };

    await restoreMarkdownHandle();
    renderTable();
    updateBindLabel();
    resumeAutoIfNeeded();
    console.log("[Part C GitHub] 面板已注入；请绑定本地 MD 以自动保存");
  }

  boot();
})();
