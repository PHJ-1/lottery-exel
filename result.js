// 结果展示页逻辑：从 URL hash 读取 base64 抽奖结果，支持编辑与共享历史记录
(function () {
  const $ = (id) => document.getElementById(id);
  function on(id, type, handler) {
    const el = $(id);
    if (el) el.addEventListener(type, handler);
  }
  const HISTORY_KEY = "lottery_history";

  function base64Decode(str) {
    const utf8 = decodeURIComponent(escape(atob(str)));
    return JSON.parse(utf8);
  }
  function base64Encode(obj) {
    const json = JSON.stringify(obj);
    const utf8 = unescape(encodeURIComponent(json));
    return btoa(utf8);
  }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  let current = null;

  function loadFromHash() {
    const hash = location.hash.replace(/^#/, "");
    if (!hash) return null;
    try {
      return base64Decode(hash);
    } catch (e) {
      return null;
    }
  }

  function renderResult(data) {
    const body = $("resultBody");
    if (!data || !data.results) {
      body.innerHTML = '<p class="muted">未检测到抽奖数据，请返回抽奖台生成结果链接。</p>';
      return;
    }

    current = {
      title: data.title || "社群福利抽奖结果",
      time: data.time || "",
      results: JSON.parse(JSON.stringify(data.results)),
    };

    if (data.title) $("resultTitle").textContent = data.title;
    if (data.time) $("resultTime").textContent = "开奖时间：" + data.time;

    const groups = Object.keys(current.results);
    if (!groups.length) {
      body.innerHTML = '<p class="muted">本次没有中奖记录。</p>';
      showExportBar(false);
      return;
    }
    showExportBar(true);

    body.innerHTML = groups
      .map((prize) => {
        const winners = current.results[prize] || [];
        const cards = winners
          .map((w) => `<span class="winner-card name-gold">🏆 ${escapeHtml(w)}</span>`)
          .join("");
        return `
          <div class="result-group">
            <h4>${escapeHtml(prize)}<span class="muted small">（共 ${winners.length} 名）</span></h4>
            <div class="winners">${cards || '<span class="muted small">暂无名次</span>'}</div>
          </div>`;
      })
      .join("");
  }

  function renderHistory() {
    const wrap = $("historyList");
    let list = [];
    try { list = JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]"); } catch { list = []; }
    if (!Array.isArray(list) || !list.length) {
      wrap.innerHTML = '<p class="muted small">暂无开奖记录，每次在抽奖台开奖后会自动保存到本机浏览器。</p>';
      return;
    }
    wrap.innerHTML = list
      .map((it, i) => {
        const reg = it.created_at || "";
        const dt = it.draw_time || "";
        return `
          <div class="history-item">
            <div class="history-info">
              <strong>${escapeHtml(it.title || "抽奖结果")}</strong>
              <span class="meta">登记：${escapeHtml(reg)}${dt ? " ｜ 开奖：" + escapeHtml(dt) : ""}</span>
            </div>
            <button class="btn ghost" data-open="${i}">查看</button>
          </div>`;
      })
      .join("");
    wrap.querySelectorAll("[data-open]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const item = list[+btn.dataset.open];
        const target = item && (item.result_url || item.url);
        if (target) window.location.href = target;
      });
    });
  }

  function init() {
    const data = loadFromHash();
    if (!data) {
      $("resultBody").innerHTML = '<p class="muted">未检测到抽奖数据，请返回抽奖台生成结果链接。</p>';
    } else {
      renderResult(data);
    }
    renderHistory();
  }

  function showExportBar(show) {
    const bar = $("exportBar");
    if (bar) bar.style.display = show ? "flex" : "none";
  }

  async function captureResultCard() {
    const card = document.querySelector(".container .panel:last-child");
    if (!card) throw new Error("未找到结果卡片");
    const cards = card.querySelectorAll(".winner-card");
    const groups = card.querySelectorAll(".result-group");
    cards.forEach((c) => c.classList.add("export-hl"));
    groups.forEach((g) => g.classList.add("export-hl"));
    try {
      return await html2canvas(card, { scale: 2, backgroundColor: null, useCORS: true });
    } finally {
      cards.forEach((c) => c.classList.remove("export-hl"));
      groups.forEach((g) => g.classList.remove("export-hl"));
    }
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function exportImage() {
    const btn = $("exportImgBtn");
    if (btn) { btn.disabled = true; btn.textContent = "生成中…"; }
    try {
      const canvas = await captureResultCard();
      canvas.toBlob((blob) => {
        const name = (current && current.title ? current.title : "抽奖结果") + ".png";
        downloadBlob(blob, name);
      }, "image/png");
    } catch (e) {
      alert("导出图片失败：" + (e && e.message ? e.message : e));
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = "🖼️ 导出图片"; }
    }
  }

  async function exportPdf() {
    const btn = $("exportPdfBtn");
    if (btn) { btn.disabled = true; btn.textContent = "生成中…"; }
    try {
      const canvas = await captureResultCard();
      const imgData = canvas.toDataURL("image/png");
      const { jsPDF } = window.jspdf;
      const pxW = canvas.width, pxH = canvas.height;
      const pdfW = 595;
      const pdfH = (pxH / pxW) * pdfW;
      const pdf = new jsPDF({ orientation: pdfH > pdfW ? "portrait" : "landscape", unit: "pt", format: [pdfW, pdfH] });
      pdf.addImage(imgData, "PNG", 0, 0, pdfW, pdfH);
      const name = (current && current.title ? current.title : "抽奖结果") + ".pdf";
      pdf.save(name);
    } catch (e) {
      alert("导出 PDF 失败：" + (e && e.message ? e.message : e));
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = "📄 导出 PDF"; }
    }
  }

  on("exportImgBtn", "click", exportImage);
  on("exportPdfBtn", "click", exportPdf);

  init();
  window.addEventListener("hashchange", () => {
    const data = loadFromHash();
    if (data) renderResult(data);
    renderHistory();
  });
})();
