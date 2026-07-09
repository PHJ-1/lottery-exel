// 幸运抽奖助手 - 主逻辑
// 状态：参与者名单、奖项配置、抽奖结果

const state = {
  names: [],        // 参与者姓名数组
  prizes: [         // 奖项配置
    { name: "王者世界周边徽章", count: 1 },
    { name: "王者世界英雄卡", count: 1 },
    { name: "王者世界明信片", count: 1 },
    { name: "Q币", count: 1 },
  ],
  results: {},      // { 奖项名: [中奖者...] }
  pool: [],         // 当前可抽取池（抽后移除，不重复中奖）
  drawing: false,
};

/* ---------- 工具函数 ---------- */
const $ = (id) => document.getElementById(id);

// 安全的事件绑定：元素不存在时静默跳过，避免某些部署下静态文件不同步导致 addEventListener 崩溃
function on(id, type, handler) {
  const el = $(id);
  if (el) el.addEventListener(type, handler);
}

function renderOverview() {
  const totalSlots = state.prizes.reduce((s, p) => s + (p.count || 0), 0);
  if ($("ovNames")) $("ovNames").textContent = state.names.length;
  if ($("ovPrizes")) $("ovPrizes").textContent = state.prizes.length;
  if ($("ovSlots")) $("ovSlots").textContent = totalSlots;
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function base64Encode(obj) {
  // 使用 encodeURIComponent 兼容中文，再 utf8 -> base64
  const json = JSON.stringify(obj);
  const utf8 = unescape(encodeURIComponent(json));
  return btoa(utf8);
}

function base64Decode(str) {
  const utf8 = decodeURIComponent(escape(atob(str)));
  return JSON.parse(utf8);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/* ---------- 步骤一：解析名单 ---------- */
function parsePaste() {
  const text = $("pasteArea").value;
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length) {
    state.names = lines;
    renderNames();
  }
}

function parseFile(file) {
  const reader = new FileReader();
  const col = parseInt($("nameColumn").value, 10);

  if (file.name.toLowerCase().endsWith(".csv")) {
    reader.onload = (e) => {
      const text = e.target.result;
      const rows = text.split(/\r?\n/).map((r) => r.split(/[,\t]/).map((c) => c.trim()));
      const names = rows
        .map((r) => r[col])
        .filter((n) => n && n !== "");
      state.names = names;
      renderNames();
    };
    reader.readAsText(file, "UTF-8");
  } else {
    // Excel
    reader.onload = (e) => {
      const data = new Uint8Array(e.target.result);
      const wb = XLSX.read(data, { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
      const names = rows
        .map((r) => (Array.isArray(r) ? String(r[col] ?? "").trim() : ""))
        .filter((n) => n && n !== "" && !/^Unnamed/.test(n));
      state.names = names;
      renderNames();
    };
    reader.readAsArrayBuffer(file);
  }
}

function renderNames() {
  const preview = $("namePreview");
  if (!state.names.length) {
    preview.hidden = true;
    $("startDrawBtn").disabled = true;
    return;
  }
  preview.hidden = false;
  $("nameCount").textContent = state.names.length;
  $("nameChips").innerHTML = state.names
    .map((n) => `<span class="chip">${escapeHtml(n)}</span>`)
    .join("");
  updateStartBtn();
  renderOverview();
}

/* ---------- 步骤二：奖项配置 ---------- */
function renderPrizes() {
  const list = $("prizeList");
  list.innerHTML = "";
  state.prizes.forEach((p, i) => {
    const div = document.createElement("div");
    div.className = "prize-item";
    div.innerHTML = `
      <input type="text" value="${escapeHtml(p.name)}" data-i="${i}" data-k="name" placeholder="奖项名称" />
      <input type="number" min="1" value="${p.count}" data-i="${i}" data-k="count" />
      <button class="prize-del" data-del="${i}" title="删除">✕</button>
    `;
    list.appendChild(div);
  });
  list.querySelectorAll('input[data-k="name"]').forEach((el) => {
    el.addEventListener("input", (e) => {
      state.prizes[+e.target.dataset.i].name = e.target.value;
    });
  });
  list.querySelectorAll('input[data-k="count"]').forEach((el) => {
    el.addEventListener("input", (e) => {
      const v = parseInt(e.target.value, 10);
      state.prizes[+e.target.dataset.i].count = isNaN(v) || v < 1 ? 1 : v;
      renderOverview(); // 名额变化实时同步顶部「中奖席位」，保持与荣耀奖池一致
    });
  });
  list.querySelectorAll("[data-del]").forEach((el) => {
    el.addEventListener("click", (e) => {
      state.prizes.splice(+e.target.dataset.del, 1);
      renderPrizes();
    });
  });
  renderOverview();
}

/* ---------- 步骤三：抽奖 ---------- */
function updateStartBtn() {
  const hasNames = state.names.length > 0;
  const totalSlots = state.prizes.reduce((s, p) => s + (p.count || 0), 0);
  $("startDrawBtn").disabled = !(hasNames && totalSlots > 0 && !state.drawing);
}

// 纯随机一次性抽取：洗牌后按顺序分配名额，保证不重复中奖
function drawAll() {
  const pool = shuffle(state.names);
  const totalSlots = state.prizes.reduce((s, p) => s + (p.count || 0), 0);
  if (pool.length < totalSlots) {
    alert(`参与人数（${pool.length}）少于奖项总名额（${totalSlots}），请减少名额或补充名单。`);
    return false;
  }
  let cursor = 0;
  state.prizes.forEach((p) => {
    const winners = [];
    for (let i = 0; i < p.count; i++) winners.push(pool[cursor++]);
    state.results[p.name] = winners;
  });
  return true;
}

function renderProgress() {
  const wrap = $("drawProgress");
  const groups = Object.keys(state.results); // 使用实际结果顺序，避免与奖项配置错位
  wrap.innerHTML = groups
    .map((prize) => {
      const winners = state.results[prize] || [];
      const cards = winners
        .map((w) => `<span class="winner-card">🏆 ${escapeHtml(w)}</span>`)
        .join("");
      return `
        <div class="result-group">
          <h4>${escapeHtml(prize)}<span class="muted small">（共 ${winners.length} 名）</span></h4>
          <div class="winners">${cards || '<span class="muted small">暂无名次</span>'}</div>
        </div>`;
    })
    .join("");
}

function finishDraw() {
  state.drawing = false;
  updateStartBtn();
  // 生成分享链接
  const payload = {
    t: "lottery",
    title: "幸运抽奖结果",
    time: new Date().toLocaleString("zh-CN"),
    results: state.results,
  };
  state.lastTitle = payload.title;
  state.lastTime = payload.time;
  const encoded = base64Encode(payload);
  const url = `${location.origin}${location.pathname.replace(/index\.html$/, "")}result.html#${encoded}`;
  $("shareLink").value = url;
  $("openResultBtn").href = `./result.html#${encoded}`;
  saveToHistory(payload, url);
  $("shareModal").hidden = false;
}

// 纯静态（GitHub Pages / 预览）版本：仅保存到本机浏览器
// 结果通过链接分享，不调用服务端接口，避免无后端时的 404 报错
async function saveToHistory(payload, url) {
  const record = {
    title: payload.title || "幸运抽奖结果",
    draw_time: payload.time || "",
    result_url: url,
  };
  try {
    let list = [];
    try { list = JSON.parse(localStorage.getItem("lottery_history") || "[]"); } catch { list = []; }
    if (!list.some((it) => it.result_url === url)) {
      list.unshift({ ...record, created_at: new Date().toLocaleString("zh-CN") });
      if (list.length > 50) list = list.slice(0, 50);
      localStorage.setItem("lottery_history", JSON.stringify(list));
    }
  } catch (e) {}
}

function startDraw() {
  if (!state.names.length) return;
  state.drawing = true;
  state.results = {};
  const ok = drawAll();
  state.drawing = false;
  if (!ok) {
    updateStartBtn();
    return;
  }
  const totalWinners = Object.values(state.results).reduce((s, a) => s + a.length, 0);
  $("reel").textContent = "🎉 抽奖完成";
  $("currentPrize").textContent = `共抽出 ${totalWinners} 位幸运儿，结果如下`;
  renderProgress();
  updateStartBtn();
  finishDraw();
}

function resetDraw() {
  state.drawing = false;
  state.results = {};
  state.pool = [];
  state.queue = [];
  state.lastTitle = "";
  state.lastTime = "";
  $("reel").textContent = "暂未开奖";
  $("currentPrize").textContent = "开奖后中奖名单会展示在这里";
  $("drawProgress").innerHTML = "";
  updateStartBtn();
}

/* ---------- 事件绑定 ---------- */
on("pickBtn", "click", () => $("fileInput").click());
on("fileInput", "change", (e) => {
  if (e.target.files[0]) parseFile(e.target.files[0]);
});
on("parseBtn", "click", parsePaste);
on("clearNames", "click", () => {
  state.names = [];
  $("pasteArea").value = "";
  renderNames();
});

// 拖拽上传
const dz = $("dropZone");
if (dz) {
  dz.addEventListener("dragover", (e) => { e.preventDefault(); dz.classList.add("drag"); });
  dz.addEventListener("dragleave", () => dz.classList.remove("drag"));
  dz.addEventListener("drop", (e) => {
    e.preventDefault();
    dz.classList.remove("drag");
    if (e.dataTransfer.files[0]) parseFile(e.dataTransfer.files[0]);
  });
  dz.addEventListener("click", (e) => {
    if (e.target.id !== "pickBtn") $("fileInput").click();
  });
}

on("addPrizeBtn", "click", () => {
  state.prizes.push({ name: "新奖项", count: 1 });
  renderPrizes();
  updateStartBtn();
});

// 保存当前奖池：将输入框最新值落库到 state，并刷新顶部「中奖席位」保持一致
on("savePrizeBtn", "click", () => {
  renderPrizes();   // 重新读取输入框值并刷新概览
  updateStartBtn();
  renderOverview(); // 确保「中奖席位」与荣耀奖池总名额一致
  const btn = $("savePrizeBtn");
  const old = btn.textContent;
  btn.textContent = "✅ 已保存";
  setTimeout(() => (btn.textContent = old), 1500);
});

on("startDrawBtn", "click", startDraw);
on("resetDrawBtn", "click", resetDraw);
on("closeShareBtn", "click", () => { $("shareModal").hidden = true; });

on("copyLinkBtn", "click", async () => {
  const link = $("shareLink").value;
  try {
    await navigator.clipboard.writeText(link);
    $("copyLinkBtn").textContent = "已复制";
    setTimeout(() => ($("copyLinkBtn").textContent = "复制"), 1500);
  } catch {
    $("shareLink").select();
    document.execCommand("copy");
  }
});

// 初始化
renderPrizes();
renderNames();
updateStartBtn();
renderOverview();
